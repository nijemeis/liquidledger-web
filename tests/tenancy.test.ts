import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withSystem, withTenant } from "@/lib/db";
import { createClientWithAdministration } from "@/lib/domain/setup";
import { post } from "@/lib/domain/ledger";

// Row-level security: a transaction scoped to administration A can never read
// or write administration B's rows, and queries outside a tenant transaction
// see nothing at all.

let A = "";
let B = "";

beforeAll(async () => {
  const a = await withSystem((tx) => createClientWithAdministration(tx, { name: "Tenant A", country: "NL", plan: "BUSINESS", trial: true }));
  const b = await withSystem((tx) => createClientWithAdministration(tx, { name: "Tenant B", country: "NL", plan: "BUSINESS", trial: true }));
  A = a.administration.id;
  B = b.administration.id;
  await withTenant(A, (tx) => tx.relation.create({ data: { administrationId: A, kind: "CUSTOMER", name: "Only in A", country: "NL" } }));
  await withTenant(B, (tx) => tx.relation.create({ data: { administrationId: B, kind: "CUSTOMER", name: "Only in B", country: "NL" } }));
});

afterAll(async () => {
  await withSystem(async (tx) => {
    for (const id of [A, B]) {
      await tx.journalLine.deleteMany({ where: { administrationId: id } });
      await tx.journalEntry.deleteMany({ where: { administrationId: id } });
      await tx.relation.deleteMany({ where: { administrationId: id } });
      await tx.ledgerAccount.deleteMany({ where: { administrationId: id } });
      await tx.warehouse.deleteMany({ where: { administrationId: id } });
      await tx.bankAccount.deleteMany({ where: { administrationId: id } });
      await tx.sequence.deleteMany({ where: { administrationId: id } });
    }
    const admins = await tx.administration.findMany({ where: { id: { in: [A, B] } } });
    await tx.client.deleteMany({ where: { id: { in: admins.map((a) => a.clientId) } } });
  });
  await prisma.$disconnect();
});

describe("row-level security", () => {
  it("only shows the current administration's rows, even without a filter", async () => {
    const names = await withTenant(A, (tx) => tx.relation.findMany({ select: { name: true } }));
    expect(names.map((n) => n.name)).toEqual(["Only in A"]);
  });

  it("shows nothing outside a tenant transaction", async () => {
    expect(await prisma.relation.count()).toBe(0);
    expect(await prisma.ledgerAccount.count()).toBe(0);
  });

  it("refuses to write rows for another administration", async () => {
    await expect(
      withTenant(A, (tx) => tx.relation.create({ data: { administrationId: B, kind: "CUSTOMER", name: "Sneaky", country: "NL" } })),
    ).rejects.toThrow(/row-level security/);
  });

  it("can't update or delete another administration's rows", async () => {
    const updated = await withTenant(A, (tx) => tx.relation.updateMany({ where: { administrationId: B }, data: { name: "Hacked" } }));
    expect(updated.count).toBe(0);
    const deleted = await withTenant(A, (tx) => tx.relation.deleteMany({ where: { administrationId: B } }));
    expect(deleted.count).toBe(0);
    const stillThere = await withTenant(B, (tx) => tx.relation.findMany({ select: { name: true } }));
    expect(stillThere.map((n) => n.name)).toEqual(["Only in B"]);
  });
});

describe("journal integrity", () => {
  it("rejects unbalanced entries and unknown accounts", async () => {
    await expect(
      withTenant(A, (tx) => post(tx, { administrationId: A, date: new Date(), title: "x", source: "MANUAL", lines: [{ account: "1000", debit: 100 }, { account: "0800", credit: 90 }] })),
    ).rejects.toThrow(/doesn't balance/);
    await expect(
      withTenant(A, (tx) => post(tx, { administrationId: A, date: new Date(), title: "x", source: "MANUAL", lines: [{ account: "9999", debit: 100 }, { account: "0800", credit: 100 }] })),
    ).rejects.toThrow(/Unknown ledger account/);
  });

  it("numbers entries without gaps and keeps lines immutable", async () => {
    const e1 = await withTenant(A, (tx) => post(tx, { administrationId: A, date: new Date(), title: "one", source: "MANUAL", lines: [{ account: "1000", debit: 100 }, { account: "0800", credit: 100 }] }));
    await expect(
      withTenant(A, async (tx) => {
        await post(tx, { administrationId: A, date: new Date(), title: "rolled back", source: "MANUAL", lines: [{ account: "1000", debit: 100 }, { account: "0800", credit: 100 }] });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    const e2 = await withTenant(A, (tx) => post(tx, { administrationId: A, date: new Date(), title: "two", source: "MANUAL", lines: [{ account: "1000", debit: 50 }, { account: "0800", credit: 50 }] }));
    expect(e2.number).toBe(e1.number + 1);
    await expect(withTenant(A, (tx) => tx.journalLine.updateMany({ where: { entryId: e1.id }, data: { debitCents: 1 } }))).rejects.toThrow(/immutable/);
  });

  it("blocks postings in a closed period", async () => {
    await prisma.administration.update({ where: { id: A }, data: { lockedThrough: new Date("2026-06-30") } });
    await expect(
      withTenant(A, (tx) => post(tx, { administrationId: A, date: new Date("2026-06-15"), title: "late", source: "MANUAL", lines: [{ account: "1000", debit: 100 }, { account: "0800", credit: 100 }] })),
    ).rejects.toThrow(/period is closed/);
    await prisma.administration.update({ where: { id: A }, data: { lockedThrough: null } });
  });
});
