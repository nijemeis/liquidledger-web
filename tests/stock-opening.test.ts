import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withSystem, withTenant } from "@/lib/db";
import { createClientWithAdministration } from "@/lib/domain/setup";
import { balances } from "@/lib/domain/ledger";
import { bookOpeningStock, stockLevels, unitsIn } from "@/lib/domain/stock";

// Opening stock when moving to Liquid Ledger: units and value per warehouse,
// booked against equity, moved from another account, or not booked at all.

let A = "";
let bonded = "";
let dutyPaid = "";
let wine = "";
const COUNTRY = "ZZ"; // test-only excise rates, so real rate rows are untouched

beforeAll(async () => {
  const a = await withSystem((tx) => createClientWithAdministration(tx, { name: "Stock BV", country: "NL", plan: "BUSINESS", trial: true }));
  A = a.administration.id;
  await prisma.exciseRate.create({ data: { country: COUNTRY, category: "WINE", basis: "HL_PRODUCT", rateCents: 10000, validFrom: new Date("2020-01-01T00:00:00Z"), createdBy: "test" } });
  await withTenant(A, async (tx) => {
    bonded = (await tx.warehouse.create({ data: { administrationId: A, name: "Bond", kind: "BONDED" } })).id;
    dutyPaid = (await tx.warehouse.create({ data: { administrationId: A, name: "Shop", kind: "DUTY_PAID" } })).id;
    wine = (await tx.product.create({ data: { administrationId: A, sku: "W1", name: "Pisco Quebranta", category: "WINE", volumeMl: 750, abvBp: 1300, unitsPerCase: 6, costCents: 500 } })).id;
    await tx.ledgerAccount.create({ data: { administrationId: A, code: "1101", nameNl: "Voorraad handelsgoederen", nameEn: "Voorraad handelsgoederen", type: "ASSET" } });
  });
});

afterAll(async () => {
  await prisma.exciseRate.deleteMany({ where: { country: COUNTRY } });
  await withSystem(async (tx) => {
    for (const m of ["journalLine", "journalEntry", "stockMovement", "product", "warehouse", "ledgerAccount", "sequence"] as const)
      await (tx[m] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { administrationId: A } });
    const admin = await tx.administration.findUniqueOrThrow({ where: { id: A } });
    await tx.client.delete({ where: { id: admin.clientId } });
  });
  await prisma.$disconnect();
});

describe("opening stock", () => {
  it("books bonded stock against equity at cost, without excise", async () => {
    const r = await withTenant(A, (tx) =>
      bookOpeningStock(tx, { administrationId: A, warehouseId: bonded, date: new Date("2026-01-01T00:00:00Z"), country: COUNTRY, lines: [{ productId: wine, qty: 100, unitCostCents: 600 }], counter: { mode: "equity" } }),
    );
    expect(r).toMatchObject({ units: 100, value: 60000, excise: 0 });
    const bal = await withTenant(A, (tx) => balances(tx, A));
    expect(bal.get("3000")).toBe(60000);
    expect(bal.get("0800")).toBe(-60000);
  });

  it("moves duty-paid stock's value from an imported account, with prepaid excise", async () => {
    await withTenant(A, (tx) =>
      bookOpeningStock(tx, { administrationId: A, warehouseId: dutyPaid, date: new Date("2026-01-01T00:00:00Z"), country: COUNTRY, lines: [{ productId: wine, qty: 10, unitCostCents: 600 }], counter: { mode: "account", account: "1101" } }),
    );
    const bal = await withTenant(A, (tx) => balances(tx, A));
    expect(bal.get("3010")).toBe(6000);
    expect(bal.get("1730")).toBe(750); // 10 × 0.75 L × €1.00/L
    expect(bal.get("1101")).toBe(-6750);
  });

  it("records quantities only, and keeps the average cost price up to date", async () => {
    await withTenant(A, (tx) =>
      bookOpeningStock(tx, { administrationId: A, warehouseId: bonded, date: new Date("2026-01-02T00:00:00Z"), country: COUNTRY, lines: [{ productId: wine, qty: 90, unitCostCents: 400 }], counter: { mode: "none" } }),
    );
    const [levels, product, entries] = await withTenant(A, (tx) =>
      Promise.all([stockLevels(tx, A), tx.product.findUniqueOrThrow({ where: { id: wine } }), tx.journalEntry.count({ where: { administrationId: A } })]),
    );
    expect(unitsIn(levels, wine, bonded)).toBe(190);
    expect(unitsIn(levels, wine)).toBe(200);
    expect(entries).toBe(2); // the quantities-only batch booked nothing
    expect(product.costCents).toBe(Math.round((110 * 600 + 90 * 400) / 200));
  });

  it("refuses zero quantities", async () => {
    await expect(
      withTenant(A, (tx) => bookOpeningStock(tx, { administrationId: A, warehouseId: bonded, date: new Date(), country: COUNTRY, lines: [{ productId: wine, qty: 0, unitCostCents: 1 }], counter: { mode: "none" } })),
    ).rejects.toThrow(/at least 1/);
  });
});
