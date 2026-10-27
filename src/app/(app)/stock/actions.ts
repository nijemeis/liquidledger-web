"use server";
import { z } from "zod";
import type { WarehouseKind } from "@prisma/client";
import { appAction, auditApp } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { PostingError } from "@/lib/domain/ledger";
import { bookOpeningStock, countStock, stockLevels, takeSample, transferStock, unitsIn } from "@/lib/domain/stock";
import { seesFinancials } from "@/lib/permissions";
import { parseMoney } from "@/lib/format";
import type { Tx } from "@/lib/db";

const id = z.string().min(1).max(40);
const qty = z.coerce.number().int().min(1).max(10_000_000);

async function load(tx: Tx, administrationId: string, productId: string, warehouseIds: string[]) {
  const [product, warehouses] = await Promise.all([
    tx.product.findFirst({ where: { id: productId, administrationId } }),
    tx.warehouse.findMany({ where: { id: { in: warehouseIds }, administrationId, archivedAt: null } }),
  ]);
  return { product, wh: (wid: string) => warehouses.find((w) => w.id === wid) ?? null };
}

const MoveInput = z.object({ productId: id, fromWarehouseId: id, toWarehouseId: id, qty, note: z.string().trim().max(200).optional() });

/** Move bottles between locations. Bonded/in transit → duty paid is a release for consumption. */
export async function moveStock(input: z.input<typeof MoveInput>) {
  return appAction("stock", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const p = MoveInput.safeParse(input);
    if (!p.success) throw new PostingError(p.error.issues.some((i) => i.path[0] === "qty") ? t("stock.err.qty") : t("stock.err.product"));
    const d = p.data;
    const A = ctx.administration.id;
    if (d.fromWarehouseId === d.toWarehouseId) throw new PostingError(t("stock.err.same"));
    const { product, wh } = await load(tx, A, d.productId, [d.fromWarehouseId, d.toWarehouseId]);
    const from = wh(d.fromWarehouseId);
    const to = wh(d.toWarehouseId);
    if (!product) throw new PostingError(t("stock.err.product"));
    if (!from || !to) throw new PostingError(t("stock.err.warehouse"));
    if (from.kind === "DUTY_PAID" && to.kind !== "DUTY_PAID") throw new PostingError(t("stock.err.backToBond"));
    const have = unitsIn(await stockLevels(tx, A), product.id, from.id);
    if (have < d.qty) throw new PostingError(t("stock.err.notEnough", { product: product.name, wh: from.name, have: fmt.int(have), qty: fmt.int(d.qty) }));

    const res = await transferStock(tx, {
      administrationId: A,
      productId: product.id,
      fromWarehouseId: from.id,
      toWarehouseId: to.id,
      qty: d.qty,
      country: ctx.administration.country,
      createdById: ctx.userId,
      note: d.note || null,
    });
    await auditApp(
      ctx,
      res.release ? "stock.release" : "stock.transfer",
      `${res.release ? "Released" : "Moved"} ${d.qty} × ${product.name} from ${from.name} to ${to.name}${res.exciseCents ? ` · excise €${(res.exciseCents / 100).toFixed(2)} payable` : ""}`,
      { targetType: "stock_movement", targetId: res.movement.id, after: { qty: d.qty, from: from.name, to: to.name, exciseCents: res.exciseCents } },
      tx,
    );
    const vars = { qty: fmt.int(d.qty), product: product.name, from: from.name, to: to.name, amount: fmt.money(res.exciseCents) };
    const message = res.release
      ? res.exciseCents && seesFinancials(ctx.role)
        ? t("stock.toast.movedExcise", vars)
        : t("stock.toast.movedRelease", vars)
      : t("stock.toast.moved", vars);
    return { message };
  });
}

const SampleInput = z.object({ productId: id, warehouseId: id, qty, note: z.string().trim().max(200).optional() });

/** Bottles taken as samples; from bond they still owe excise. */
export async function sampleStock(input: z.input<typeof SampleInput>) {
  return appAction("stock", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const p = SampleInput.safeParse(input);
    if (!p.success) throw new PostingError(p.error.issues.some((i) => i.path[0] === "qty") ? t("stock.err.qty") : t("stock.err.product"));
    const d = p.data;
    const A = ctx.administration.id;
    const { product, wh } = await load(tx, A, d.productId, [d.warehouseId]);
    const w = wh(d.warehouseId);
    if (!product) throw new PostingError(t("stock.err.product"));
    if (!w) throw new PostingError(t("stock.err.warehouse"));
    const have = unitsIn(await stockLevels(tx, A), product.id, w.id);
    if (have < d.qty) throw new PostingError(t("stock.err.notEnough", { product: product.name, wh: w.name, have: fmt.int(have), qty: fmt.int(d.qty) }));
    const res = await takeSample(tx, { administrationId: A, productId: product.id, warehouseId: w.id, qty: d.qty, country: ctx.administration.country, createdById: ctx.userId, note: d.note || null });
    await auditApp(
      ctx,
      "stock.sample",
      `Samples: ${d.qty} × ${product.name} from ${w.name}${res.exciseCents ? ` · excise €${(res.exciseCents / 100).toFixed(2)} owed` : ""}`,
      { targetType: "stock_movement", targetId: res.movement.id, after: { qty: d.qty, warehouse: w.name, exciseCents: res.exciseCents } },
      tx,
    );
    const vars = { qty: fmt.int(d.qty), product: product.name, wh: w.name, amount: fmt.money(res.exciseCents) };
    const message = res.exciseCents
      ? seesFinancials(ctx.role)
        ? t("stock.toast.sampleExcise", vars)
        : t("stock.toast.sampleExciseNoMoney", vars)
      : t("stock.toast.sample", vars);
    return { message };
  });
}

const CountInput = z.object({ productId: id, warehouseId: id, counted: z.coerce.number().int().min(0).max(10_000_000), note: z.string().trim().max(200).optional() });

/** Book the difference between the counted and the recorded number of bottles. */
export async function countStockAction(input: z.input<typeof CountInput>) {
  return appAction("stock", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const p = CountInput.safeParse(input);
    if (!p.success) throw new PostingError(p.error.issues.some((i) => i.path[0] === "counted") ? t("stock.err.counted") : t("stock.err.product"));
    const d = p.data;
    const A = ctx.administration.id;
    const { product, wh } = await load(tx, A, d.productId, [d.warehouseId]);
    const w = wh(d.warehouseId);
    if (!product) throw new PostingError(t("stock.err.product"));
    if (!w) throw new PostingError(t("stock.err.warehouse"));
    const res = await countStock(tx, { administrationId: A, productId: product.id, warehouseId: w.id, counted: d.counted, createdById: ctx.userId, note: d.note || undefined });
    const vars = { product: product.name, wh: w.name, n: fmt.int(res.diff), value: fmt.money(Math.abs(res.diff) * product.costCents) };
    if (!res.diff) return { message: t("stock.toast.countSame", vars) };
    await auditApp(ctx, "stock.count", `Stock count ${product.name} in ${w.name}: counted ${d.counted}, difference ${res.diff > 0 ? "+" : ""}${res.diff}`, { targetType: "product", targetId: product.id, after: { counted: d.counted, diff: res.diff, warehouse: w.name } }, tx);
    const money = seesFinancials(ctx.role);
    const key = res.diff > 0 ? (money ? "countPlus" : "countPlusNoMoney") : money ? "countMinus" : "countMinusNoMoney";
    return { message: t(`stock.toast.${key}`, vars) };
  });
}

const KINDS = ["BONDED", "DUTY_PAID", "IN_TRANSIT"] as const satisfies readonly WarehouseKind[];
const WarehouseInput = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(KINDS),
  city: z.string().trim().max(60).optional(),
  exciseWarehouseNo: z.string().trim().max(40).optional(),
});

export async function addWarehouse(input: z.input<typeof WarehouseInput>) {
  return appAction("stock", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const p = WarehouseInput.safeParse(input);
    if (!p.success) throw new PostingError(t("stock.err.name"));
    const d = p.data;
    const A = ctx.administration.id;
    const exists = await tx.warehouse.findFirst({ where: { administrationId: A, archivedAt: null, name: { equals: d.name, mode: "insensitive" } } });
    if (exists) throw new PostingError(t("stock.err.duplicate", { name: d.name }));
    const w = await tx.warehouse.create({
      data: { administrationId: A, name: d.name, kind: d.kind, city: d.city || null, exciseWarehouseNo: d.exciseWarehouseNo || null },
    });
    await auditApp(ctx, "stock.warehouse.create", `Added warehouse ${w.name} (${w.kind})`, { targetType: "warehouse", targetId: w.id, after: { name: w.name, kind: w.kind, city: w.city, exciseWarehouseNo: w.exciseWarehouseNo } }, tx);
    return { message: t("stock.toast.warehouse", { name: w.name, kind: t(`stock.kindLong.${w.kind}`) }), id: w.id };
  });
}

const WarehouseEdit = WarehouseInput.extend({ id: z.string().min(1) });

/** Edit a warehouse; its kind can only change while no stock has moved through it. */
export async function updateWarehouse(input: z.input<typeof WarehouseEdit>) {
  return appAction("stock", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const p = WarehouseEdit.safeParse(input);
    if (!p.success) throw new PostingError(t("stock.err.name"));
    const d = p.data;
    const A = ctx.administration.id;
    const w = await tx.warehouse.findFirst({ where: { id: d.id, administrationId: A, archivedAt: null } });
    if (!w) throw new PostingError(t("stock.err.warehouse"));
    const dup = await tx.warehouse.findFirst({ where: { administrationId: A, archivedAt: null, id: { not: w.id }, name: { equals: d.name, mode: "insensitive" } } });
    if (dup) throw new PostingError(t("stock.err.duplicate", { name: d.name }));
    if (d.kind !== w.kind) {
      const moves = await tx.stockMovement.count({ where: { administrationId: A, OR: [{ fromWarehouseId: w.id }, { toWarehouseId: w.id }] } });
      if (moves) throw new PostingError(t("stock.err.kindUsed"));
    }
    const after = { name: d.name, kind: d.kind, city: d.city || null, exciseWarehouseNo: d.exciseWarehouseNo || null };
    await tx.warehouse.update({ where: { id: w.id }, data: after });
    await auditApp(ctx, "stock.warehouse.update", `Updated warehouse ${after.name}`, { targetType: "warehouse", targetId: w.id, before: { name: w.name, kind: w.kind, city: w.city, exciseWarehouseNo: w.exciseWarehouseNo }, after }, tx);
    return { message: t("stock.toast.warehouseSaved", { name: after.name }) };
  });
}

/** Delete a warehouse that was never used; archive an empty one with history. */
export async function removeWarehouse(id: string) {
  return appAction("stock", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const A = ctx.administration.id;
    const w = await tx.warehouse.findFirst({ where: { id, administrationId: A, archivedAt: null } });
    if (!w) throw new PostingError(t("stock.err.warehouse"));
    const levels = await stockLevels(tx, A);
    let units = 0;
    for (const m of levels.values()) units += m.get(w.id) ?? 0;
    if (units) throw new PostingError(t("stock.err.notEmpty", { name: w.name, n: fmt.int(units) }));
    const [moves, sales, purchases] = await Promise.all([
      tx.stockMovement.count({ where: { administrationId: A, OR: [{ fromWarehouseId: w.id }, { toWarehouseId: w.id }] } }),
      tx.salesInvoice.count({ where: { administrationId: A, warehouseId: w.id } }),
      tx.purchaseInvoice.count({ where: { administrationId: A, warehouseId: w.id } }),
    ]);
    if (!moves && !sales && !purchases) {
      await tx.warehouse.delete({ where: { id: w.id } });
      await auditApp(ctx, "stock.warehouse.delete", `Deleted unused warehouse ${w.name}`, { targetType: "warehouse", targetId: w.id, before: { name: w.name, kind: w.kind } }, tx);
      return { message: t("stock.toast.warehouseDeleted", { name: w.name }) };
    }
    await tx.warehouse.update({ where: { id: w.id }, data: { archivedAt: new Date() } });
    await auditApp(ctx, "stock.warehouse.archive", `Archived warehouse ${w.name}`, { targetType: "warehouse", targetId: w.id }, tx);
    return { message: t("stock.toast.warehouseArchived", { name: w.name }) };
  });
}

const OpeningInput = z.object({
  warehouseId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["equity", "account", "none"]),
  account: z.string().trim().max(6).optional().default(""),
  lines: z
    .array(z.object({ productId: z.string().min(1), qty: z.coerce.number().int().min(1).max(10_000_000), unitCost: z.string().max(20) }))
    .min(1)
    .max(2000),
});

/** Opening stock for a warehouse (moving over from another system). */
export async function addOpeningStock(input: z.input<typeof OpeningInput>) {
  return appAction(
    "stock",
    async (ctx, tx) => {
      const { t, fmt } = await getI18n(ctx.locale);
      const p = OpeningInput.safeParse(input);
      if (!p.success) throw new PostingError(t("stock.opening.err.input"));
      const d = p.data;
      const A = ctx.administration.id;
      const lines = d.lines.map((l) => {
        const cents = parseMoney(l.unitCost || "0");
        if (cents === null || cents < 0) throw new PostingError(t("stock.opening.err.cost"));
        return { productId: l.productId, qty: l.qty, unitCostCents: cents };
      });
      if (new Set(lines.map((l) => l.productId)).size !== lines.length) throw new PostingError(t("stock.opening.err.duplicate"));
      if (d.mode === "account") {
        const acc = await tx.ledgerAccount.findFirst({ where: { administrationId: A, code: d.account, active: true } });
        if (!acc || ["3000", "3010", "3020"].includes(acc.code)) throw new PostingError(t("stock.opening.err.account"));
      }
      const res = await bookOpeningStock(tx, {
        administrationId: A,
        warehouseId: d.warehouseId,
        date: new Date(`${d.date}T00:00:00Z`),
        country: ctx.administration.country,
        lines,
        counter: d.mode === "account" ? { mode: "account", account: d.account } : { mode: d.mode },
        createdById: ctx.userId,
      });
      await auditApp(
        ctx,
        "stock.opening",
        `Opening stock in ${res.warehouse.name} on ${d.date}: ${res.units} units, value ${fmt.money(res.value)}${res.excise ? `, prepaid excise ${fmt.money(res.excise)}` : ""}, booked ${d.mode === "account" ? `against ${d.account}` : d.mode === "equity" ? "against equity" : "not (quantities only)"}`,
        { targetType: "warehouse", targetId: res.warehouse.id, after: { date: d.date, lines: lines.length, units: res.units, valueCents: res.value, exciseCents: res.excise, mode: d.mode, account: d.account || null } },
        tx,
      );
      const money = seesFinancials(ctx.role);
      return {
        message: t(money ? "stock.opening.toast" : "stock.opening.toastNoMoney", {
          n: fmt.int(res.units),
          wh: res.warehouse.name,
          value: fmt.money(res.value + res.excise),
        }),
      };
    },
    { timeout: 120_000 },
  );
}
