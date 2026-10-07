"use server";
import { z } from "zod";
import type { WarehouseKind } from "@prisma/client";
import { appAction, auditApp } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { PostingError } from "@/lib/domain/ledger";
import { countStock, stockLevels, takeSample, transferStock, unitsIn } from "@/lib/domain/stock";
import { seesFinancials } from "@/lib/permissions";
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
