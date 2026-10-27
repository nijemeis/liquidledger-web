import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withSystem, withTenant } from "@/lib/db";
import { createClientWithAdministration } from "@/lib/domain/setup";
import { balances, post } from "@/lib/domain/ledger";
import { bankLedgerFor, createBankAccount } from "@/lib/domain/bank";

// Bank accounts created from a statement: which ledger account they get, and
// when the statement's opening balance is booked.

const ids: string[] = [];
const fresh = async (name: string) => {
  const a = await withSystem((tx) => createClientWithAdministration(tx, { name, country: "NL", plan: "BUSINESS", trial: true }));
  ids.push(a.administration.id);
  return a.administration.id;
};
const opening = { cents: 50000, date: new Date("2026-04-01T00:00:00Z") };

afterAll(async () => {
  await withSystem(async (tx) => {
    for (const id of ids) {
      await tx.journalLine.deleteMany({ where: { administrationId: id } });
      await tx.journalEntry.deleteMany({ where: { administrationId: id } });
      await tx.bankAccount.deleteMany({ where: { administrationId: id } });
      await tx.ledgerAccount.deleteMany({ where: { administrationId: id } });
      await tx.warehouse.deleteMany({ where: { administrationId: id } });
      await tx.sequence.deleteMany({ where: { administrationId: id } });
    }
    const admins = await tx.administration.findMany({ where: { id: { in: ids } } });
    await tx.client.deleteMany({ where: { id: { in: admins.map((a) => a.clientId) } } });
  });
  await prisma.$disconnect();
});

describe("bank accounts from a statement", () => {
  let A = "";
  beforeAll(async () => {
    A = await fresh("Bank BV");
  });

  it("uses 1000 first, then the next free 10xx code, booking the opening balance", async () => {
    const first = await withTenant(A, async (tx) => {
      // A new administration may already have a bank account on 1000; start from none.
      await tx.bankAccount.deleteMany({ where: { administrationId: A } });
      const l = await bankLedgerFor(tx, A);
      expect(l).toEqual({ code: "1000", exists: true });
      return createBankAccount(tx, { administrationId: A, baseCurrency: "EUR", name: "ABN AMRO ··4300", iban: "NL91ABNA0417164300", currency: "EUR", accountCode: l.code, createLedger: !l.exists, opening });
    });
    expect(first.bookedOpening).toBe(true);
    expect(first.account.iban).toBe("NL91 ABNA 0417 1643 00");
    const second = await withTenant(A, async (tx) => {
      const l = await bankLedgerFor(tx, A);
      expect(l).toEqual({ code: "1001", exists: false });
      return createBankAccount(tx, { administrationId: A, baseCurrency: "EUR", name: "ING ··4471", iban: "NL91INGB0006654471", currency: "EUR", accountCode: l.code, createLedger: true, ledgerName: "Bank ING ··4471", opening });
    });
    expect(second.bookedOpening).toBe(true);
    const bal = await withTenant(A, (tx) => balances(tx, A));
    expect(bal.get("1000")).toBe(50000);
    expect(bal.get("1001")).toBe(50000);
    expect(bal.get("0800")).toBe(-100000);
    const entry = await withTenant(A, (tx) => tx.journalEntry.findFirstOrThrow({ where: { administrationId: A, source: "OPENING" } }));
    expect(entry.date.toISOString().slice(0, 10)).toBe("2026-04-01");
  });

  it("doesn't book the opening balance when the ledger account already carries money (after an auditfile import)", async () => {
    const B = await fresh("Imported BV");
    const res = await withTenant(B, async (tx) => {
      await tx.bankAccount.deleteMany({ where: { administrationId: B } });
      await post(tx, { administrationId: B, date: new Date("2026-01-01T00:00:00Z"), title: "Imported opening", source: "IMPORT", lines: [{ account: "1000", debit: 50000 }, { account: "0800", credit: 50000 }] });
      const l = await bankLedgerFor(tx, B);
      return createBankAccount(tx, { administrationId: B, baseCurrency: "EUR", name: "ABN AMRO ··4300", iban: "NL91ABNA0417164300", currency: "EUR", accountCode: l.code, createLedger: !l.exists, opening });
    });
    expect(res.bookedOpening).toBe(false);
    expect(res.account.openingBalanceCents).toBe(50000);
    expect((await withTenant(B, (tx) => balances(tx, B))).get("1000")).toBe(50000);
  });
});
