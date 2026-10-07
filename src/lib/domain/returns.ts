import type { TaxReturnType } from "@prisma/client";
import type { Tx } from "./types";
import { ACC } from "./chart";
import { ratesOn, returnBasis } from "./excise";
import { computeBoxes, vatReturnLayout, type VatCode, type VatTotals } from "./vat";

// ── Periods ──────────────────────────────────────────────────────────────────

export interface Period {
  start: Date; // inclusive, UTC midnight
  end: Date; // inclusive, UTC midnight
  key: string; // "2026-Q3" | "2026-09"
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

export function quarterOf(d: Date): Period {
  const q = Math.floor(d.getUTCMonth() / 3);
  const y = d.getUTCFullYear();
  return { start: utc(y, q * 3, 1), end: utc(y, q * 3 + 3, 0), key: `${y}-Q${q + 1}` };
}

export function monthOf(d: Date): Period {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { start: utc(y, m, 1), end: utc(y, m + 1, 0), key: `${y}-${String(m + 1).padStart(2, "0")}` };
}

export function parsePeriod(key: string | undefined | null): Period | null {
  if (!key) return null;
  const q = key.match(/^(\d{4})-Q([1-4])$/);
  if (q) return quarterOf(utc(Number(q[1]), (Number(q[2]) - 1) * 3, 1));
  const m = key.match(/^(\d{4})-(\d{2})$/);
  if (m) return monthOf(utc(Number(m[1]), Number(m[2]) - 1, 1));
  return null;
}

/** The last fully elapsed period, i.e. the one being filed now. */
export function previousPeriod(today: Date, monthly: boolean): Period {
  if (monthly) return monthOf(utc(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return quarterOf(utc(today.getUTCFullYear(), today.getUTCMonth() - 3, 1));
}

/** NL: VAT and excise are due by the end of the month after the period. */
export function dueDateFor(p: Period): Date {
  return utc(p.end.getUTCFullYear(), p.end.getUTCMonth() + 2, 0);
}

// ── VAT ─────────────────────────────────────────────────────────────────────

export async function vatTotals(tx: Tx, administrationId: string, p: Period): Promise<VatTotals> {
  const lines = await tx.journalLine.findMany({
    where: { administrationId, vatCode: { not: null }, entry: { date: { gte: p.start, lte: p.end } } },
    select: { accountCode: true, vatCode: true, vatBaseCents: true, debitCents: true, creditCents: true },
  });
  const totals: VatTotals = { base: {}, vat: {} };
  for (const l of lines) {
    const code = l.vatCode as VatCode;
    if (l.vatBaseCents) totals.base[code] = (totals.base[code] ?? 0) + l.vatBaseCents;
    if (l.accountCode === ACC.vatPayable) totals.vat[code] = (totals.vat[code] ?? 0) + l.creditCents - l.debitCents;
    if (l.accountCode === ACC.vatReclaim) totals.vat[code] = (totals.vat[code] ?? 0) + l.debitCents - l.creditCents;
  }
  return totals;
}

export async function vatReturn(tx: Tx, administrationId: string, p: Period) {
  const admin = await tx.administration.findUniqueOrThrow({ where: { id: administrationId } });
  const totals = await vatTotals(tx, administrationId, p);
  const boxes = computeBoxes(vatReturnLayout(admin.country), totals);
  const icp = await icpListing(tx, administrationId, p);
  const filed = await tx.taxReturn.findUnique({ where: { administrationId_type_periodStart: { administrationId, type: "VAT", periodStart: p.start } } });
  return { period: p, due: dueDateFor(p), ...boxes, icp, filed };
}

export async function icpListing(tx: Tx, administrationId: string, p: Period) {
  const rows = await tx.journalLine.groupBy({
    by: ["relationId"],
    where: { administrationId, vatCode: "ICP", relationId: { not: null }, entry: { date: { gte: p.start, lte: p.end } } },
    _sum: { vatBaseCents: true },
  });
  const rels = await tx.relation.findMany({ where: { id: { in: rows.map((r) => r.relationId!) } } });
  return rows
    .map((r) => {
      const rel = rels.find((x) => x.id === r.relationId);
      return { relationId: r.relationId!, name: rel?.name ?? "?", vatNumber: rel?.vatNumber ?? "—", viesValid: rel?.viesValid ?? null, amountCents: r._sum.vatBaseCents ?? 0 };
    })
    .filter((r) => r.amountCents !== 0)
    .sort((a, b) => b.amountCents - a.amountCents);
}

// ── Excise ──────────────────────────────────────────────────────────────────

export async function exciseReturn(tx: Tx, administrationId: string, p: Period) {
  const admin = await tx.administration.findUniqueOrThrow({ where: { id: administrationId } });
  const end = new Date(p.end.getTime() + 86400_000 - 1);
  const moves = await tx.stockMovement.findMany({
    where: { administrationId, exciseReleased: true, at: { gte: p.start, lte: end } },
  });
  const suspended = await tx.stockMovement.findMany({
    where: { administrationId, reason: "SALE", exciseReleased: false, at: { gte: p.start, lte: end }, documentType: "sales_invoice" },
    select: { qty: true, documentId: true },
  });
  const euInvoices = await tx.salesInvoice.findMany({
    where: { administrationId, id: { in: suspended.map((s) => s.documentId!).filter(Boolean) }, taxRegime: { in: ["EU_B2B", "EXPORT"] } },
    select: { id: true },
  });
  const euIds = new Set(euInvoices.map((i) => i.id));
  const shippedSuspended = suspended.filter((s) => s.documentId && euIds.has(s.documentId)).reduce((a, s) => a + s.qty, 0);

  const products = await tx.product.findMany({ where: { id: { in: [...new Set(moves.map((m) => m.productId))] } } });
  const rates = await ratesOn(tx, admin.country, p.end);
  const per = new Map<string, { units: number; cents: number }>();
  for (const m of moves) {
    const cur = per.get(m.productId) ?? { units: 0, cents: 0 };
    cur.units += m.qty;
    cur.cents += m.exciseCents;
    per.set(m.productId, cur);
  }
  const rows = [...per]
    .map(([pid, v]) => {
      const product = products.find((x) => x.id === pid)!;
      const rate = rates.get(product.category);
      const basis = rate ? returnBasis(product, rate, v.units) : { hl: (v.units * product.volumeMl) / 100_000, text: "—" };
      return { productId: pid, name: product.name, sku: product.sku, category: product.category, units: v.units, hl: basis.hl, basis: basis.text, exciseCents: v.cents };
    })
    .sort((a, b) => b.exciseCents - a.exciseCents);
  const filed = await tx.taxReturn.findUnique({ where: { administrationId_type_periodStart: { administrationId, type: "EXCISE", periodStart: p.start } } });
  return {
    period: p,
    due: dueDateFor(p),
    rows,
    totalCents: rows.reduce((a, r) => a + r.exciseCents, 0),
    releasedUnits: rows.reduce((a, r) => a + r.units, 0),
    shippedSuspendedUnits: shippedSuspended,
    licence: admin.exciseLicenceNo,
    filed,
  };
}

/**
 * Record a return as filed. Liquid Ledger doesn't submit to the authorities
 * itself yet (Digipoort / EMCS integrations are a later milestone): the user
 * files the figures in the official portal and records the reference here.
 */
export async function markFiled(
  tx: Tx,
  input: { administrationId: string; type: TaxReturnType; period: Period; boxes: object; totalCents: number; reference: string; userId: string },
) {
  return tx.taxReturn.upsert({
    where: { administrationId_type_periodStart: { administrationId: input.administrationId, type: input.type, periodStart: input.period.start } },
    create: {
      administrationId: input.administrationId,
      type: input.type,
      periodStart: input.period.start,
      periodEnd: input.period.end,
      boxes: input.boxes,
      totalCents: input.totalCents,
      status: "FILED",
      filedRef: input.reference,
      filedAt: new Date(),
      filedById: input.userId,
    },
    update: { boxes: input.boxes, totalCents: input.totalCents, status: "FILED", filedRef: input.reference, filedAt: new Date(), filedById: input.userId },
  });
}
