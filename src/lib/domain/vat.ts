import type { ProductCategory, TaxRegime } from "./types";

// VAT rules (DOMAIN_AND_DATA.md §6). Returns are modelled as configuration:
// VAT codes on journal lines are mapped to the boxes of each country's form.

export const EU = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

export const isEU = (country: string) => EU.has(country.toUpperCase());

/**
 * Regime per invoice from the customer's country and VAT status.
 * EU B2C (distance sales / OSS) is out of scope for v1 and reported as a warning.
 */
export function determineRegime(
  adminCountry: string,
  customer: { country: string; vatNumber?: string | null; taxRegimeOverride?: TaxRegime | null },
): { regime: TaxRegime; warning?: "eu_b2c" } {
  if (customer.taxRegimeOverride) return { regime: customer.taxRegimeOverride };
  const c = customer.country.toUpperCase();
  if (c === adminCountry.toUpperCase()) return { regime: "DOMESTIC" };
  if (isEU(c)) return customer.vatNumber ? { regime: "EU_B2B" } : { regime: "DOMESTIC", warning: "eu_b2c" };
  return { regime: "EXPORT" };
}

/** Domestic VAT rate per product category (basis points). NL: alcoholic 21%, non-alcoholic 9%. */
export const DOMESTIC_RATE: Record<string, Record<ProductCategory, number>> = {
  NL: { WINE: 2100, BEER: 2100, SPIRITS: 2100, FORTIFIED: 2100, WATER: 900, SOFT: 900 },
  BE: { WINE: 2100, BEER: 2100, SPIRITS: 2100, FORTIFIED: 2100, WATER: 600, SOFT: 600 },
  DE: { WINE: 1900, BEER: 1900, SPIRITS: 1900, FORTIFIED: 1900, WATER: 1900, SOFT: 1900 },
  FR: { WINE: 2000, BEER: 2000, SPIRITS: 2000, FORTIFIED: 2000, WATER: 550, SOFT: 550 },
  IT: { WINE: 2200, BEER: 2200, SPIRITS: 2200, FORTIFIED: 2200, WATER: 2200, SOFT: 2200 },
  ES: { WINE: 2100, BEER: 2100, SPIRITS: 2100, FORTIFIED: 2100, WATER: 1000, SOFT: 1000 },
  PL: { WINE: 2300, BEER: 2300, SPIRITS: 2300, FORTIFIED: 2300, WATER: 800, SOFT: 2300 },
};

export const STANDARD_RATE: Record<string, number> = { NL: 2100, BE: 2100, DE: 1900, FR: 2000, IT: 2200, ES: 2100, PL: 2300 };

/** VAT codes stored on journal lines. */
export const VAT = {
  SALES_HIGH: "S_HIGH", // domestic standard rate
  SALES_LOW: "S_LOW", // domestic reduced rate
  SALES_ZERO: "S_ZERO", // domestic 0% / exempt
  EXPORT: "EXPORT", // outside the EU
  ICP: "ICP", // intra-community supply
  IMPORT: "IMPORT", // import VAT (reverse-charged, Art. 23 permit)
  EU_ACQ: "EU_ACQ", // intra-community acquisition of goods
  EU_SERVICES: "EU_SRV", // services from EU suppliers (reverse charge)
  INPUT: "INPUT", // deductible input VAT
} as const;

export type VatCode = (typeof VAT)[keyof typeof VAT];

export function salesVatCode(regime: TaxRegime, rateBp: number, country: string): VatCode {
  if (regime === "EXPORT") return VAT.EXPORT;
  if (regime === "EU_B2B") return VAT.ICP;
  if (rateBp === 0) return VAT.SALES_ZERO;
  return rateBp >= (STANDARD_RATE[country] ?? 2100) ? VAT.SALES_HIGH : VAT.SALES_LOW;
}

// ── Return layouts ───────────────────────────────────────────────────────────

export interface BoxDef {
  box: string;
  label: { en: string; nl: string };
  section?: { en: string; nl: string };
  base?: VatCode[]; // turnover = sum of base amounts with these codes
  vat?: VatCode[]; // VAT = sum of VAT amounts with these codes
  kind?: "due" | "input" | "total";
}

/** NL "Aangifte omzetbelasting" boxes 1a–5g. */
export const NL_VAT_RETURN: BoxDef[] = [
  { box: "1a", section: { en: "Domestic supplies", nl: "Prestaties binnenland" }, label: { en: "Supplies taxed at the standard rate", nl: "Leveringen/diensten belast met hoog tarief" }, base: [VAT.SALES_HIGH], vat: [VAT.SALES_HIGH] },
  { box: "1b", label: { en: "Supplies taxed at the reduced rate", nl: "Leveringen/diensten belast met laag tarief" }, base: [VAT.SALES_LOW], vat: [VAT.SALES_LOW] },
  { box: "1e", label: { en: "Supplies at 0% or not taxed", nl: "Leveringen/diensten belast met 0% of niet bij u belast" }, base: [VAT.SALES_ZERO] },
  { box: "3a", section: { en: "Supplies abroad", nl: "Prestaties naar of in het buitenland" }, label: { en: "Supplies to countries outside the EU", nl: "Leveringen naar landen buiten de EU" }, base: [VAT.EXPORT] },
  { box: "3b", label: { en: "Supplies to EU countries (ICP)", nl: "Leveringen naar of diensten in landen binnen de EU" }, base: [VAT.ICP] },
  { box: "4a", section: { en: "Supplies to you from abroad", nl: "Prestaties vanuit het buitenland aan u verricht" }, label: { en: "Goods & services from outside the EU", nl: "Leveringen/diensten uit landen buiten de EU" }, base: [VAT.IMPORT], vat: [VAT.IMPORT] },
  { box: "4b", label: { en: "Acquisitions from EU countries", nl: "Leveringen/diensten uit landen binnen de EU" }, base: [VAT.EU_ACQ, VAT.EU_SERVICES], vat: [VAT.EU_ACQ, VAT.EU_SERVICES] },
  { box: "5a", section: { en: "Totals", nl: "Voorbelasting en totaal" }, label: { en: "VAT due (subtotal)", nl: "Verschuldigde omzetbelasting" }, kind: "due" },
  { box: "5b", label: { en: "Input VAT to reclaim", nl: "Voorbelasting" }, vat: [VAT.INPUT], kind: "input" },
  { box: "5g", label: { en: "To pay (or reclaim)", nl: "Totaal te betalen of terug te vragen" }, kind: "total" },
];

export function vatReturnLayout(country: string): BoxDef[] {
  // TODO(tax pack): BE grids, FR CA3, DE UStVA, IT LIPE, ES Modelo 303, PL JPK_V7.
  void country;
  return NL_VAT_RETURN;
}

export interface VatTotals {
  base: Partial<Record<VatCode, number>>;
  vat: Partial<Record<VatCode, number>>;
}

export function computeBoxes(layout: BoxDef[], totals: VatTotals) {
  const sum = (codes: VatCode[] | undefined, src: Partial<Record<VatCode, number>>) =>
    (codes ?? []).reduce((a, c) => a + (src[c] ?? 0), 0);
  let due = 0;
  let input = 0;
  const rows = layout.map((b) => {
    if (b.kind === "due" || b.kind === "total") return { ...b, baseCents: null as number | null, vatCents: 0 };
    const baseCents = b.base ? sum(b.base, totals.base) : null;
    const vatCents = b.vat ? sum(b.vat, totals.vat) : null;
    if (b.kind === "input") input += vatCents ?? 0;
    else due += vatCents ?? 0;
    return { ...b, baseCents, vatCents };
  });
  for (const r of rows) {
    if (r.kind === "due") r.vatCents = due;
    if (r.kind === "total") r.vatCents = due - input;
  }
  return { rows, dueCents: due, inputCents: input, payableCents: due - input };
}
