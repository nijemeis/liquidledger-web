"use server";
import { z } from "zod";
import { appAction, auditApp } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { PostingError } from "@/lib/domain/ledger";
import { parseMoney } from "@/lib/format";


const Input = z.object({
  id: z.string().optional().nullable(),
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  producer: z.string().trim().max(120).optional().nullable(),
  region: z.string().trim().max(120).optional().nullable(),
  originCountry: z.string().trim().max(2).optional().nullable(),
  category: z.enum(["WINE", "BEER", "SPIRITS", "FORTIFIED", "WATER", "SOFT"]),
  volumeL: z.string(),
  abv: z.string(),
  plato: z.string().optional().nullable(),
  vintage: z.string().trim().max(40).optional().nullable(),
  unitsPerCase: z.coerce.number().int().min(1).max(10_000),
  casesPerPallet: z.string().optional().nullable(),
  ean: z.string().trim().max(20).optional().nullable(),
  cnCode: z.string().trim().max(20).optional().nullable(),
  emcsCode: z.string().trim().max(40).optional().nullable(),
  deposit: z.string().optional().nullable(),
  reorderLevel: z.string().optional().nullable(),
  cost: z.string().optional().nullable(),
  prices: z.record(z.string(), z.string()),
});

const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
const num = (s: string | null | undefined) => {
  if (!s || !s.trim()) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export async function saveProduct(raw: z.infer<typeof Input>) {
  const input = Input.parse(raw);
  return appAction<{ id: string }>("stock", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const A = ctx.administration.id;
    const bad: string[] = [];
    const vol = num(input.volumeL);
    const abv = num(input.abv) ?? 0;
    const plato = num(input.plato);
    const pallet = num(input.casesPerPallet);
    const reorder = num(input.reorderLevel);
    const deposit = input.deposit?.trim() ? parseMoney(input.deposit) : 0;
    const cost = input.cost?.trim() ? parseMoney(input.cost) : null;
    if (vol === null || Number.isNaN(vol) || vol <= 0 || vol > 1000) bad.push(t("products.fVolume"));
    if (Number.isNaN(abv) || abv < 0 || abv > 100) bad.push(t("products.fAbv"));
    if (Number.isNaN(plato as number)) bad.push(t("products.fPlato"));
    if (Number.isNaN(pallet as number)) bad.push(t("products.fCasesPerPallet"));
    if (Number.isNaN(reorder as number)) bad.push(t("products.fReorder"));
    if (deposit === null || deposit < 0) bad.push(t("products.fDeposit"));
    if (input.cost?.trim() && (cost === null || cost < 0)) bad.push(t("products.fCost"));
    const prices: [string, number][] = [];
    for (const [list, v] of Object.entries(input.prices)) {
      if (!v.trim()) continue;
      const c = parseMoney(v);
      if (c === null || c < 0) bad.push(`${t("products.fPrices")} · ${list}`);
      else prices.push([list, c]);
    }
    if (bad.length) throw new PostingError(t("products.invalid", { fields: bad.join(", ") }));

    const sku = input.sku.toUpperCase();
    const clash = await tx.product.findFirst({ where: { administrationId: A, sku, ...(input.id ? { id: { not: input.id } } : {}) } });
    if (clash) throw new PostingError(t("products.skuTaken", { sku }));

    const data = {
      sku,
      name: input.name,
      producer: clean(input.producer),
      region: clean(input.region),
      originCountry: clean(input.originCountry)?.toUpperCase() ?? null,
      category: input.category,
      volumeMl: Math.round(vol! * 1000),
      abvBp: Math.round(abv * 100),
      platoTenths: input.category === "BEER" && plato !== null ? Math.round(plato * 10) : null,
      vintage: clean(input.vintage),
      unitsPerCase: input.unitsPerCase,
      casesPerPallet: pallet === null ? null : Math.round(pallet),
      ean: clean(input.ean),
      cnCode: clean(input.cnCode),
      emcsCode: clean(input.emcsCode),
      depositCents: deposit ?? 0,
      reorderLevel: reorder === null ? null : Math.round(reorder),
    };
    const before = input.id ? await tx.product.findFirst({ where: { id: input.id, administrationId: A }, include: { prices: true } }) : null;
    if (input.id && !before) throw new PostingError("Product not found.");
    const product = before
      ? await tx.product.update({ where: { id: before.id }, data })
      : await tx.product.create({ data: { ...data, administrationId: A, costCents: cost ?? 0 } });

    // Prices are versioned: a change adds a row; the latest row per list is current.
    for (const [list, cents] of prices) {
      const current = before?.prices.filter((p) => p.list === list).sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
      if (current?.unitPriceCents === cents) continue;
      await tx.productPrice.create({ data: { administrationId: A, productId: product.id, list, unitPriceCents: cents } });
    }
    await auditApp(ctx, before ? "product.update" : "product.create", `${before ? "Updated" : "Added"} product ${product.sku} ${product.name}`, { targetType: "product", targetId: product.id }, tx);
    return { message: t(before ? "products.saved" : "products.created", { name: product.name }), id: product.id };
  });
}

export async function duplicateProduct(id: string) {
  return appAction<{ id: string }>("stock", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const A = ctx.administration.id;
    const p = await tx.product.findFirst({ where: { id, administrationId: A }, include: { prices: true } });
    if (!p) throw new PostingError("Product not found.");
    let sku = `${p.sku}-COPY`;
    for (let i = 2; await tx.product.findFirst({ where: { administrationId: A, sku } }); i++) sku = `${p.sku}-COPY${i}`;
    const { id: _id, createdAt: _c, archivedAt: _a, prices, ...rest } = p;
    void _id;
    void _c;
    void _a;
    const latest = new Map<string, number>();
    for (const pr of [...prices].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime())) latest.set(pr.list, pr.unitPriceCents);
    const copy = await tx.product.create({
      data: { ...rest, sku, name: `${p.name} (copy)`, prices: { create: [...latest].map(([list, unitPriceCents]) => ({ administrationId: A, list, unitPriceCents })) } },
    });
    await auditApp(ctx, "product.create", `Duplicated ${p.sku} as ${sku}`, { targetType: "product", targetId: copy.id }, tx);
    return { message: t("products.duplicated", { sku }), id: copy.id };
  });
}

export async function setProductArchived(id: string, archived: boolean) {
  return appAction("stock", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const p = await tx.product.findFirst({ where: { id, administrationId: ctx.administration.id } });
    if (!p) throw new PostingError("Product not found.");
    await tx.product.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await auditApp(ctx, archived ? "product.archive" : "product.restore", `${archived ? "Archived" : "Restored"} product ${p.sku}`, { targetType: "product", targetId: id }, tx);
    return { message: t(archived ? "products.archivedMsg" : "products.restoredMsg", { name: p.name }) };
  });
}

