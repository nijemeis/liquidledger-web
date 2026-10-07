import { describe, expect, it } from "vitest";
import { excisePerUnit, exciseForQty, exciseFormula, returnBasis, type RateRow } from "@/lib/domain/excise";
import { calcInvoice } from "@/lib/domain/sales";
import { computeBoxes, determineRegime, NL_VAT_RETURN, VAT } from "@/lib/domain/vat";
import { calcPurchase, suggestTreatment } from "@/lib/domain/purchases";
import { splitGross, CATEGORY_BY_KEY } from "@/lib/domain/categories";
import { receiptLines } from "@/lib/domain/receipts";

// Illustrative NL rates from the handoff (cents per basis unit).
const rate = (category: string, basis: string, rateCents: number) =>
  [category, { country: "NL", category, basis, rateCents, validFrom: new Date("2026-01-01") } as unknown as RateRow] as const;
const RATES = new Map<string, RateRow>([
  rate("BEER", "HL_PER_ABV", 910),
  rate("WINE", "HL_PRODUCT", 9800),
  rate("FORTIFIED", "HL_PRODUCT", 18200),
  rate("SPIRITS", "HL_PURE_ALCOHOL", 199100),
  rate("WATER", "NONE", 0),
  rate("SOFT", "NONE", 0),
]);

const rioja = { id: "rioja", name: "Rioja", sku: "WN-1021", category: "WINE", volumeMl: 750, abvBp: 1350, platoTenths: null, depositCents: 0 } as const;
const glen = { id: "glen", name: "Glen Arrow 12", sku: "SP-3012", category: "SPIRITS", volumeMl: 700, abvBp: 4000, platoTenths: null, depositCents: 0 } as const;
const tripel = { id: "tripel", name: "Tripel", sku: "BR-2003", category: "BEER", volumeMl: 330, abvBp: 850, platoTenths: 185, depositCents: 10 } as const;
const water = { id: "water", name: "Water", sku: "NA-5001", category: "WATER", volumeMl: 500, abvBp: 0, platoTenths: null, depositCents: 15 } as const;

describe("excise", () => {
  it("matches the prototype's per-line amounts", () => {
    // "60 btl × 0.75 L × €0.98" = €44.10
    expect(exciseForQty(rioja, RATES.get("WINE"), 60)).toBe(4410);
    // "12 btl × 0.280 L alc. × €19.91" = €66.90
    expect(exciseForQty(glen, RATES.get("SPIRITS"), 12)).toBe(6690);
    // beer: 0.33 L × 8.5% × €0.091 per bottle
    expect(excisePerUnit(tripel, RATES.get("BEER"))).toBeCloseTo(25.5255, 4);
    expect(exciseForQty(water, RATES.get("WATER"), 100)).toBe(0);
  });
  it("renders formulas like the design", () => {
    expect(exciseFormula(rioja, RATES.get("WINE"), 60)).toBe("60 btl × 0.75 L × €0.98");
    expect(exciseFormula(glen, RATES.get("SPIRITS"), 12)).toBe("12 btl × 0.280 L alc. × €19.91");
    expect(returnBasis(rioja, RATES.get("WINE")!, 3600).text).toBe("27.00 hl × €98.00");
  });
});

describe("sales tax engine", () => {
  it("domestic: excise per bottle, VAT over price + excise + deposit, 9% on soft drinks", () => {
    const r = calcInvoice({
      country: "NL",
      regime: "DOMESTIC",
      rates: RATES,
      lines: [
        { product: rioja, qtyUnits: 60, unitPriceCents: 980 },
        { product: water, qtyUnits: 24, unitPriceCents: 95 },
      ],
    });
    expect(r.lines[0]).toMatchObject({ netCents: 58800, exciseCents: 4410, vatRateBp: 2100, vatCode: VAT.SALES_HIGH });
    expect(r.lines[0]!.vatCents).toBe(Math.round((58800 + 4410) * 0.21));
    expect(r.lines[1]).toMatchObject({ netCents: 2280, exciseCents: 0, depositCents: 360, vatRateBp: 900, vatCode: VAT.SALES_LOW });
    expect(r.totalCents).toBe(r.netCents + r.exciseCents + r.depositCents + r.vatCents);
  });
  it("EU B2B: no excise, no VAT, ICP code", () => {
    const r = calcInvoice({ country: "NL", regime: "EU_B2B", rates: RATES, lines: [{ product: glen, qtyUnits: 12, unitPriceCents: 3400 }] });
    expect(r).toMatchObject({ exciseCents: 0, vatCents: 0, totalCents: 40800 });
    expect(r.lines[0]!.vatCode).toBe(VAT.ICP);
  });
  it("export: no excise, 0% VAT, EXPORT code", () => {
    const r = calcInvoice({ country: "NL", regime: "EXPORT", rates: RATES, lines: [{ product: glen, qtyUnits: 6, unitPriceCents: 2600 }] });
    expect(r.lines[0]).toMatchObject({ exciseCents: 0, vatCents: 0, vatCode: VAT.EXPORT });
  });
  it("determines the regime from the customer", () => {
    expect(determineRegime("NL", { country: "NL" }).regime).toBe("DOMESTIC");
    expect(determineRegime("NL", { country: "SE", vatNumber: "SE556677889901" }).regime).toBe("EU_B2B");
    expect(determineRegime("NL", { country: "BE" })).toEqual({ regime: "DOMESTIC", warning: "eu_b2c" });
    expect(determineRegime("NL", { country: "NG" }).regime).toBe("EXPORT");
    expect(determineRegime("NL", { country: "NL", taxRegimeOverride: "EXPORT" }).regime).toBe("EXPORT");
  });
});

describe("VAT return", () => {
  it("adds up due VAT, input VAT and the amount to pay", () => {
    const boxes = computeBoxes(NL_VAT_RETURN, {
      base: { S_HIGH: 100000, EXPORT: 5000, ICP: 7000, EU_ACQ: 20000 },
      vat: { S_HIGH: 21000, EU_ACQ: 4200, INPUT: 6000 },
    });
    const box = (b: string) => boxes.rows.find((r) => r.box === b)!;
    expect(box("1a")).toMatchObject({ baseCents: 100000, vatCents: 21000 });
    expect(box("3a").baseCents).toBe(5000);
    expect(box("3b").baseCents).toBe(7000);
    expect(box("4b")).toMatchObject({ baseCents: 20000, vatCents: 4200 });
    expect(box("5a").vatCents).toBe(25200);
    expect(box("5b").vatCents).toBe(6000);
    expect(box("5g").vatCents).toBe(19200);
  });
});

describe("purchases", () => {
  it("converts foreign currency and only charges VAT on domestic purchases", () => {
    const r = calcPurchase({ fxRate: 1.155, treatment: "IMPORT", lines: [{ description: "Glen", accountCode: "3020", qty: 1920, unitPriceSrcCents: 1680, vatRateBp: 2100 }] });
    expect(r.lines[0]).toMatchObject({ amountSrcCents: 3225600, amountCents: Math.round(3225600 * 1.155), vatCents: 0 });
    const d = calcPurchase({ fxRate: 1, treatment: "DOMESTIC", lines: [{ description: "Storage", accountCode: "4400", qty: 1, unitPriceSrcCents: 152893, vatRateBp: 2100 }] });
    expect(d.vatCents).toBe(32108);
  });
  it("suggests the VAT treatment from the supplier country", () => {
    expect(suggestTreatment("NL", "NL", true)).toBe("DOMESTIC");
    expect(suggestTreatment("NL", "FR", true)).toBe("EU_ACQUISITION");
    expect(suggestTreatment("NL", "IE", false)).toBe("EU_SERVICES");
    expect(suggestTreatment("NL", "MX", true)).toBe("IMPORT");
  });
});

describe("receipts", () => {
  it("splits reclaimable VAT out of the gross amount", () => {
    expect(splitGross(12100, CATEGORY_BY_KEY.office!)).toEqual({ net: 10000, vat: 2100 });
    expect(splitGross(14250, CATEGORY_BY_KEY.meals!)).toEqual({ net: 14250, vat: 0 });
  });
  it("produces balanced journal lines for each payment method", () => {
    for (const paidBy of ["CARD", "BANK", "OWN"] as const) {
      const lines = receiptLines({ amountCents: 8647, categoryKey: "office", paidBy });
      const dr = lines.reduce((a, l) => a + l.debit, 0);
      const cr = lines.reduce((a, l) => a + l.credit, 0);
      expect(dr).toBe(cr);
      expect(lines.at(-1)!.account).toBe({ CARD: "1110", BANK: "1000", OWN: "1650" }[paidBy]);
    }
    const rc = receiptLines({ amountCents: 7139, categoryKey: "software", paidBy: "CARD", vatOverride: "EU_SERVICES" });
    expect(rc.reduce((a, l) => a + l.debit - l.credit, 0)).toBe(0);
    expect(rc.find((l) => l.vatCode === VAT.EU_SERVICES)?.vatBase).toBe(7139);
  });
});
