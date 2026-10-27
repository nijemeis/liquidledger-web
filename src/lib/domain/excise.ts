import type { ExciseBasis, ExciseRate, Product, ProductCategory, Tx } from "./types";

// Excise per unit, from volume, alcohol % and category (DOMAIN_AND_DATA.md §5).
// Rates come from the versioned `excise_rates` table: never hard-code them.

export type RateBand = Pick<ExciseRate, "abvMinBp" | "abvMaxBp" | "platoMinTenths" | "platoMaxTenths" | "sparkling">;
export type RateRow = Pick<ExciseRate, "country" | "category" | "basis" | "rateCents" | "validFrom"> & Partial<RateBand>;
export type ExciseProduct = Pick<Product, "category" | "volumeMl" | "abvBp" | "platoTenths"> & { sparkling?: boolean };

// ── Bands ────────────────────────────────────────────────────────────────────
// A category can have several rates in force at once, each for a band: an
// alcohol range, a Plato range and/or still vs sparkling (e.g. NL wine up to
// and above 8.5%, still and sparkling; intermediate products up to and above
// 15%; beer by Plato band). Lower bounds are exclusive, upper bounds inclusive.

/** Does the product fall in this rate's band? A product without a Plato value never matches a Plato band. */
export function inBand(r: Partial<RateBand>, p: ExciseProduct): boolean {
  if (r.abvMinBp != null && !(p.abvBp > r.abvMinBp)) return false;
  if (r.abvMaxBp != null && !(p.abvBp <= r.abvMaxBp)) return false;
  if (r.platoMinTenths != null || r.platoMaxTenths != null) {
    if (p.platoTenths == null) return false;
    if (r.platoMinTenths != null && !(p.platoTenths > r.platoMinTenths)) return false;
    if (r.platoMaxTenths != null && !(p.platoTenths <= r.platoMaxTenths)) return false;
  }
  if (r.sparkling != null && r.sparkling !== Boolean(p.sparkling)) return false;
  return true;
}

const conditions = (r: Partial<RateBand>) =>
  [r.abvMinBp, r.abvMaxBp, r.platoMinTenths, r.platoMaxTenths, r.sparkling].filter((v) => v !== null && v !== undefined).length;

/** The rate that applies to a product: the most specific band of its category it falls in. */
export function rateFor<R extends RateRow>(rates: readonly R[], p: ExciseProduct): R | undefined {
  let best: R | undefined;
  for (const r of rates) {
    if (r.category !== p.category || !inBand(r, p)) continue;
    if (!best || conditions(r) > conditions(best)) best = r;
  }
  return best;
}

/** Two bands overlap when some product could fall in both. */
export function bandsOverlap(a: Partial<RateBand>, b: Partial<RateBand>): boolean {
  const range = (min?: number | null, max?: number | null) => [min ?? -Infinity, max ?? Infinity] as const;
  const overlaps = (x: readonly [number, number], y: readonly [number, number]) => x[0] < y[1] && y[0] < x[1];
  if (!overlaps(range(a.abvMinBp, a.abvMaxBp), range(b.abvMinBp, b.abvMaxBp))) return false;
  if (!overlaps(range(a.platoMinTenths, a.platoMaxTenths), range(b.platoMinTenths, b.platoMaxTenths))) return false;
  if (a.sparkling != null && b.sparkling != null && a.sparkling !== b.sparkling) return false;
  return true;
}

/** "> 8.5% · sparkling", "> 7–11 °P", or "" for a rate without conditions. */
export function bandLabel(r: Partial<RateBand>, words: { sparkling: string; still: string } = { sparkling: "sparkling", still: "still" }): string {
  const pct = (bp: number) => `${(bp / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;
  const pl = (t: number) => `${(t / 10).toLocaleString("en-GB", { maximumFractionDigits: 1 })} °P`;
  const span = (min: number | null | undefined, max: number | null | undefined, f: (n: number) => string) =>
    min != null && max != null ? `> ${f(min)} – ${f(max)}` : min != null ? `> ${f(min)}` : max != null ? `≤ ${f(max)}` : "";
  return [span(r.abvMinBp, r.abvMaxBp, pct), span(r.platoMinTenths, r.platoMaxTenths, pl), r.sparkling == null ? "" : r.sparkling ? words.sparkling : words.still]
    .filter(Boolean)
    .join(" · ");
}

/** Excise per unit in (fractional) cents. Round only at line level. */
export function excisePerUnit(p: ExciseProduct, rate: Pick<RateRow, "basis" | "rateCents"> | null | undefined): number {
  if (!rate || rate.basis === "NONE") return 0;
  const hl = p.volumeMl / 100_000;
  switch (rate.basis) {
    case "HL_PRODUCT":
      return hl * rate.rateCents;
    case "HL_PER_ABV":
      return hl * (p.abvBp / 100) * rate.rateCents;
    case "HL_PER_PLATO":
      return hl * ((p.platoTenths ?? 0) / 10) * rate.rateCents;
    case "HL_PURE_ALCOHOL":
      return hl * (p.abvBp / 10_000) * rate.rateCents;
  }
}

export function exciseForQty(p: ExciseProduct, rate: Pick<RateRow, "basis" | "rateCents"> | null | undefined, qty: number): number {
  return Math.round(excisePerUnit(p, rate) * qty);
}

const eur = (cents: number, d = 2) => "€" + (cents / 100).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const litres = (ml: number) => String(ml / 1000);

/** Short formula shown under an invoice line, e.g. "60 btl × 0.75 L × €0.98". */
export function exciseFormula(p: ExciseProduct, rate: Pick<RateRow, "basis" | "rateCents"> | null | undefined, qty?: number): string {
  const n = qty !== undefined ? `${qty.toLocaleString("en-GB")} btl × ` : "";
  if (!rate || rate.basis === "NONE") return "no alcohol excise";
  switch (rate.basis) {
    case "HL_PRODUCT":
      return `${n}${litres(p.volumeMl)} L × ${eur(rate.rateCents / 100)}`;
    case "HL_PER_ABV":
      return `${n}${litres(p.volumeMl)} L × ${p.abvBp / 100}% × ${eur(rate.rateCents / 100, 3)}`;
    case "HL_PER_PLATO":
      return `${n}${litres(p.volumeMl)} L × ${(p.platoTenths ?? 0) / 10} °P × ${eur(rate.rateCents / 100, 3)}`;
    case "HL_PURE_ALCOHOL":
      return `${n}${((p.volumeMl / 1000) * (p.abvBp / 10_000)).toFixed(3)} L alc. × ${eur(rate.rateCents / 100)}`;
  }
}

/** Basis text for the excise return, e.g. "27.00 hl × €98.00". */
export function returnBasis(p: ExciseProduct, rate: Pick<RateRow, "basis" | "rateCents">, units: number): { hl: number; text: string } {
  const hl = (units * p.volumeMl) / 100_000;
  switch (rate.basis) {
    case "HL_PER_ABV":
      return { hl, text: `${hl.toFixed(2)} hl × ${p.abvBp / 100}% × ${eur(rate.rateCents)}` };
    case "HL_PER_PLATO":
      return { hl, text: `${hl.toFixed(2)} hl × ${(p.platoTenths ?? 0) / 10} °P × ${eur(rate.rateCents)}` };
    case "HL_PURE_ALCOHOL":
      return { hl, text: `${((hl * p.abvBp) / 10_000).toFixed(3)} hl alcohol × ${eur(rate.rateCents)}` };
    case "HL_PRODUCT":
      return { hl, text: `${hl.toFixed(2)} hl × ${eur(rate.rateCents)}` };
    default:
      return { hl, text: "—" };
  }
}

/**
 * Rates in force on `date` for a country. Per category, the latest version on
 * or before `date` applies as a whole (all its bands); pick one with rateFor().
 */
export async function ratesOn(tx: Tx, country: string, date: Date): Promise<ExciseRate[]> {
  const rows = await tx.exciseRate.findMany({
    where: { country, validFrom: { lte: date } },
    orderBy: { validFrom: "desc" },
  });
  return inForce(rows);
}

/** From rows on or before a date (any order): the latest version per category, all of its bands. */
export function inForce<R extends RateRow>(rows: readonly R[]): R[] {
  const latest = new Map<ProductCategory, number>();
  for (const r of rows) latest.set(r.category, Math.max(latest.get(r.category) ?? -Infinity, r.validFrom.getTime()));
  return rows.filter((r) => r.validFrom.getTime() === latest.get(r.category));
}

export const BASIS_FOR: Record<ProductCategory, ExciseBasis> = {
  BEER: "HL_PER_ABV",
  WINE: "HL_PRODUCT",
  FORTIFIED: "HL_PRODUCT",
  SPIRITS: "HL_PURE_ALCOHOL",
  WATER: "NONE",
  SOFT: "NONE",
};
