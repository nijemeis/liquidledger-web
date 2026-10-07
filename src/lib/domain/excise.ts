import type { ExciseBasis, ExciseRate, Product, ProductCategory, Tx } from "./types";

// Excise per unit, from volume, alcohol % and category (DOMAIN_AND_DATA.md §5).
// Rates come from the versioned `excise_rates` table: never hard-code them.

export type RateRow = Pick<ExciseRate, "country" | "category" | "basis" | "rateCents" | "validFrom">;
export type ExciseProduct = Pick<Product, "category" | "volumeMl" | "abvBp" | "platoTenths">;

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

/** Rates in force on `date` for a country, one per category. */
export async function ratesOn(tx: Tx, country: string, date: Date): Promise<Map<ProductCategory, RateRow>> {
  const rows = await tx.exciseRate.findMany({
    where: { country, validFrom: { lte: date } },
    orderBy: { validFrom: "desc" },
  });
  const map = new Map<ProductCategory, RateRow>();
  for (const r of rows) if (!map.has(r.category)) map.set(r.category, r);
  return map;
}

export const BASIS_FOR: Record<ProductCategory, ExciseBasis> = {
  BEER: "HL_PER_ABV",
  WINE: "HL_PRODUCT",
  FORTIFIED: "HL_PRODUCT",
  SPIRITS: "HL_PURE_ALCOHOL",
  WATER: "NONE",
  SOFT: "NONE",
};
