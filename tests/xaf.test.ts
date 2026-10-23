import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma, withSystem, withTenant } from "@/lib/db";
import { createClientWithAdministration } from "@/lib/domain/setup";
import { balances } from "@/lib/domain/ledger";
import { checkXaf, parseXaf, toCents, XafError } from "@/lib/xaf/parse";
import { nextFree, suggestMapping, type AccountTarget } from "@/lib/xaf/mapping";
import { previewImport, reverseImport, runImport, vatNumberOf, type ImportTarget } from "@/lib/xaf/import";
import { loadXafData, renderXaf } from "@/lib/xaf/export";

// A small auditfile in the shape Reeleezee writes (XAF 3.2): its own chart
// where 1300 is input VAT and 1200 is receivables, two relations, an opening
// balance with open items, sales, purchase and a period-result journal.
const SAMPLE = `<?xml version="1.0"?>
<auditfile xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.auditfiles.nl/XAF/3.2">
  <header><fiscalYear>2025</fiscalYear><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate><curCode>EUR</curCode><dateCreated>2026-01-15</dateCreated><softwareDesc>Testware</softwareDesc><softwareVersion>1</softwareVersion></header>
  <company>
    <companyIdent>123</companyIdent><companyName>Pisco &amp; Co</companyName><taxRegistrationCountry>NL</taxRegistrationCountry><taxRegIdent>001234567B01</taxRegIdent>
    <streetAddress><streetname>Kade</streetname><number>1</number><city>Utrecht</city><postalCode>3511 AA</postalCode><country>NL</country></streetAddress>
    <customersSuppliers>
      <customerSupplier><custSupID>10</custSupID><custSupName>Café Lima</custSupName><eMail>lima@example.com</eMail><taxRegIdent>NL999999999B01</taxRegIdent><custSupTp>C</custSupTp><streetAddress><city>Amsterdam</city><country>NL</country></streetAddress><bankAccount><bankAccNr>NL13 INGB 0006 6544 71</bankAccNr></bankAccount></customerSupplier>
      <customerSupplier><custSupID>20</custSupID><custSupName>Bodega Ica</custSupName><custSupTp>S</custSupTp><streetAddress><country>PE</country></streetAddress></customerSupplier>
      <customerSupplier><custSupID>30</custSupID><custSupName>Never booked</custSupName><custSupTp>C</custSupTp></customerSupplier>
    </customersSuppliers>
    <generalLedger>
      <ledgerAccount><accID>0509</accID><accDesc>Resultaat lopend boekjaar</accDesc><accTp>B</accTp></ledgerAccount>
      <ledgerAccount><accID>1001</accID><accDesc>ABN-AMRO bank 12.34.56.789</accDesc><accTp>B</accTp></ledgerAccount>
      <ledgerAccount><accID>1200</accID><accDesc>Debiteuren</accDesc><accTp>B</accTp></ledgerAccount>
      <ledgerAccount><accID>1300</accID><accDesc>BTW betaald (voorbelasting)</accDesc><accTp>B</accTp></ledgerAccount>
      <ledgerAccount><accID>1600</accID><accDesc>Crediteuren</accDesc><accTp>B</accTp></ledgerAccount>
      <ledgerAccount><accID>1700</accID><accDesc>BTW ontvangen hoog</accDesc><accTp>B</accTp></ledgerAccount>
      <ledgerAccount><accID>1710</accID><accDesc>Loonbelasting te betalen</accDesc><accTp>B</accTp></ledgerAccount>
      <ledgerAccount><accID>4100</accID><accDesc>Huur kantoor</accDesc><accTp>P</accTp></ledgerAccount>
      <ledgerAccount><accID>7999</accID><accDesc>Winst</accDesc><accTp>P</accTp></ledgerAccount>
      <ledgerAccount><accID>8000</accID><accDesc>Omzet 1</accDesc><accTp>P</accTp></ledgerAccount>
    </generalLedger>
    <vatCodes><vatCode><vatID>H</vatID><vatDesc>Hoog</vatDesc><vatToPayAccID>1700</vatToPayAccID><vatToClaimAccID>1300</vatToClaimAccID></vatCode></vatCodes>
    <periods><period><periodNumber>1</periodNumber><startDatePeriod>2025-01-01</startDatePeriod><endDatePeriod>2025-01-31</endDatePeriod></period></periods>
    <openingBalance>
      <opBalDate>2025-01-01</opBalDate><linesCount>4</linesCount><totalDebit>1300.0000</totalDebit><totalCredit>1300.0000</totalCredit>
      <obLine><nr>1</nr><accID>1001</accID><amnt>1000.0000</amnt><amntTp>D</amntTp></obLine>
      <obLine><nr>2</nr><accID>1200</accID><amnt>300.0000</amnt><amntTp>D</amntTp></obLine>
      <obLine><nr>3</nr><accID>1710</accID><amnt>100.0000</amnt><amntTp>C</amntTp></obLine>
      <obLine><nr>4</nr><accID>0509</accID><amnt>1200.0000</amnt><amntTp>C</amntTp></obLine>
      <obSubledgers><obSubledger><sbType>CU</sbType><linesCount>2</linesCount><totalDebit>300</totalDebit><totalCredit>0</totalCredit>
        <obSbLine><nr>1</nr><obLineNr>2</obLineNr><amnt>200.0000</amnt><amntTp>D</amntTp><custSupID>10</custSupID><invRef>101</invRef></obSbLine>
        <obSbLine><nr>2</nr><obLineNr>2</obLineNr><amnt>100.0000</amnt><amntTp>D</amntTp><custSupID>10</custSupID><invRef>102</invRef></obSbLine>
      </obSubledger></obSubledgers>
    </openingBalance>
    <transactions>
      <linesCount>9</linesCount><totalDebit>2231.00</totalDebit><totalCredit>2231.00</totalCredit>
      <journal><jrnID>51</jrnID><desc>Omzet boeking</desc><jrnTp>S</jrnTp>
        <transaction><nr>1</nr><desc>Omzet boeking</desc><periodNumber>1</periodNumber><trDt>2025-01-07</trDt><sourceID>INV</sourceID>
          <trLine><nr>1</nr><accID>1200</accID><docRef>771</docRef><effDate>2025-01-07</effDate><desc>Café Lima</desc><amnt>121.00</amnt><amntTp>D</amntTp><custSupID>10</custSupID><invRef>771</invRef></trLine>
          <trLine><nr>2</nr><accID>8000</accID><docRef>771</docRef><effDate>2025-01-07</effDate><desc>Pisco 700ml</desc><amnt>100.00</amnt><amntTp>C</amntTp><custSupID>10</custSupID><invRef>771</invRef></trLine>
          <trLine><nr>3</nr><accID>1700</accID><docRef>771</docRef><effDate>2025-01-07</effDate><desc>BTW</desc><amnt>21.00</amnt><amntTp>C</amntTp><custSupID>10</custSupID><invRef>771</invRef></trLine>
        </transaction>
      </journal>
      <journal><jrnID>71</jrnID><desc>Inkoopfactuur boeking</desc><jrnTp>P</jrnTp>
        <transaction><nr>2</nr><desc>Huur januari</desc><periodNumber>1</periodNumber><trDt>2025-01-10</trDt>
          <trLine><nr>4</nr><accID>4100</accID><docRef>H1</docRef><effDate>2025-01-10</effDate><amnt>1000.00</amnt><amntTp>D</amntTp><custSupID>20</custSupID></trLine>
          <trLine><nr>5</nr><accID>1300</accID><docRef>H1</docRef><effDate>2025-01-10</effDate><amnt>210.00</amnt><amntTp>D</amntTp><custSupID>20</custSupID></trLine>
          <trLine><nr>6</nr><accID>1600</accID><docRef>H1</docRef><effDate>2025-01-10</effDate><amnt>1210.00</amnt><amntTp>C</amntTp><custSupID>20</custSupID></trLine>
        </transaction>
      </journal>
      <journal><jrnID>191</jrnID><desc>Berekening Resultaat</desc><jrnTp>Z</jrnTp>
        <transaction><nr>3</nr><desc>Berekening Resultaat</desc><periodNumber>1</periodNumber><trDt>2025-01-31</trDt>
          <trLine><nr>7</nr><accID>7999</accID><docRef>0</docRef><effDate>2025-01-31</effDate><amnt>900.00</amnt><amntTp>C</amntTp></trLine>
          <trLine><nr>8</nr><accID>0509</accID><docRef>0</docRef><effDate>2025-01-31</effDate><amnt>900.00</amnt><amntTp>D</amntTp></trLine>
          <trLine><nr>9</nr><accID>8000</accID><docRef>0</docRef><effDate>2025-01-31</effDate><amnt>0.00</amnt><amntTp>D</amntTp></trLine>
        </transaction>
      </journal>
    </transactions>
  </company>
</auditfile>`;

const XAF30 = `<?xml version="1.0" encoding="UTF-8"?>
<auditfile xmlns="http://www.auditfiles.nl/XAF/3.0">
  <header><auditfileVersion>CLAIR2.00.00</auditfileVersion><companyID>1</companyID><taxRegistrationNr>NL001234567B01</taxRegistrationNr><companyName>Old Co</companyName><fiscalYear>2019</fiscalYear><startDate>2019-01-01</startDate><endDate>2019-12-31</endDate><currencyCode>EUR</currencyCode><dateCreated>2020-02-01</dateCreated><productID>OldBooks</productID><productVersion>9</productVersion></header>
  <generalLedger><ledgerAccount><accountID>1000</accountID><accountDesc>Kas</accountDesc><accountType>Balans</accountType></ledgerAccount><ledgerAccount><accountID>8000</accountID><accountDesc>Omzet</accountDesc><accountType>Winst en verlies</accountType></ledgerAccount></generalLedger>
  <customersSuppliers><customerSupplier><custSupID>K1</custSupID><companyName>Klant</companyName><type>Debtor</type></customerSupplier></customersSuppliers>
  <transactions><journal><journalID>V</journalID><description>Verkoop</description><type>S</type>
    <transaction><transactionID>1</transactionID><description>Kasverkoop</description><period>1</period><transactionDate>2019-03-01</transactionDate>
      <line><recordID>1</recordID><accountID>1000</accountID><documentID>A1</documentID><effectiveDate>2019-03-01</effectiveDate><description>Kas</description><debitAmount>50.00</debitAmount><creditAmount>0</creditAmount></line>
      <line><recordID>2</recordID><accountID>8000</accountID><documentID>A1</documentID><effectiveDate>2019-03-01</effectiveDate><description>Omzet</description><debitAmount>0</debitAmount><creditAmount>50.00</creditAmount></line>
    </transaction></journal></transactions>
</auditfile>`;

describe("XAF parser", () => {
  it("reads XAF 3.2 with exact cents, signs and leading zeros", () => {
    const f = parseXaf(SAMPLE);
    expect(f.version).toBe("3.2");
    expect(f.company.name).toBe("Pisco & Co");
    expect(f.accounts.map((a) => a.id)).toContain("0509");
    expect(f.relations).toHaveLength(3);
    expect(f.relations[0]!.address.country).toBe("NL");
    expect(f.opening!.lines.map((l) => l.amount)).toEqual([100000, 30000, -10000, -120000]);
    expect(f.opening!.openItems).toHaveLength(2);
    const c = checkXaf(f);
    expect(c).toMatchObject({ transactions: 3, lines: 9, debit: 223100, credit: 223100, totalsMatch: true, openingBalanced: true, unbalanced: [], first: "2025-01-07", last: "2025-01-31" });
  });

  it("reads the older XAF 3.0 layout", () => {
    const f = parseXaf(XAF30);
    expect(f.version).toBe("3.0");
    expect(f.header.software).toBe("OldBooks");
    expect(f.company.name).toBe("Old Co");
    expect(f.accounts).toEqual([
      expect.objectContaining({ id: "1000", type: "B" }),
      expect.objectContaining({ id: "8000", type: "P" }),
    ]);
    expect(f.journals[0]!.transactions[0]!.lines.map((l) => l.amount)).toEqual([5000, -5000]);
  });

  it("converts amounts without floating point", () => {
    expect(toCents("962.4800")).toBe(96248);
    expect(toCents("0.105")).toBe(11);
    expect(toCents("-12.5")).toBe(-1250);
    expect(toCents("1234567.89")).toBe(123456789);
    expect(() => toCents("1e3")).toThrow(XafError);
  });

  it("refuses DTDs and files that aren't auditfiles", () => {
    expect(() => parseXaf('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><auditfile/>')).toThrow(/DTD/);
    expect(() => parseXaf("<invoice/>")).toThrow(/auditfile/);
  });
});

describe("account mapping", () => {
  const chart = [
    { code: "1000", nameNl: "Bank", nameEn: "Bank", type: "ASSET" as const },
    { code: "1300", nameNl: "Debiteuren", nameEn: "Receivables", type: "ASSET" as const },
    { code: "1500", nameNl: "Af te dragen loonheffing", nameEn: "Wage tax payable", type: "LIABILITY" as const },
    { code: "1600", nameNl: "Crediteuren", nameEn: "Payables", type: "LIABILITY" as const },
    { code: "1700", nameNl: "Af te dragen btw", nameEn: "VAT payable", type: "LIABILITY" as const },
    { code: "1710", nameNl: "Af te dragen accijns", nameEn: "Excise payable", type: "LIABILITY" as const },
    { code: "1810", nameNl: "Te vorderen btw", nameEn: "VAT to reclaim", type: "ASSET" as const },
    { code: "0850", nameNl: "Onverdeelde winst", nameEn: "Retained earnings", type: "EQUITY" as const },
    { code: "4100", nameNl: "Overige personeelskosten", nameEn: "Other staff costs", type: "COST" as const },
    { code: "8000", nameNl: "Omzet wijn", nameEn: "Sales — wine", type: "REVENUE" as const },
  ];

  it("recognises control accounts by name, never by colliding codes", () => {
    const rows = suggestMapping(parseXaf(SAMPLE), chart);
    const to = Object.fromEntries(rows.map((r) => [r.accId, r.target]));
    expect(to["1001"]).toMatchObject({ code: "1000", create: false });
    expect(to["1200"]).toMatchObject({ code: "1300", create: false });
    expect(to["1300"]).toMatchObject({ code: "1810", create: false }); // input VAT, not receivables
    expect(to["1600"]).toMatchObject({ code: "1600", create: false });
    expect(to["1700"]).toMatchObject({ code: "1700", create: false });
    expect(to["1710"]).toMatchObject({ code: "1500", create: false }); // wage tax, not excise
    expect(to["0509"]).toMatchObject({ code: "0850", create: false });
    expect(to["4100"]).toMatchObject({ code: "4101", create: true, name: "Huur kantoor", type: "COST" });
    expect(to["8000"]).toMatchObject({ code: "8001", create: true, type: "REVENUE" });
    expect(to["7999"]).toMatchObject({ code: "7999", create: true, type: "COST" });
  });

  it("finds the next free code", () => {
    expect(nextFree("4100", new Set(["4100", "4101"]))).toBe("4102");
    expect(nextFree("9999", new Set(["9999"]))).toBe("99990");
  });

  it("normalises Dutch VAT numbers without a country prefix", () => {
    expect(vatNumberOf("822742342B01", "NL")).toBe("NL822742342B01");
    expect(vatNumberOf("be 0123.456.789", "BE")).toBe("BE0123456789");
    expect(vatNumberOf("", "NL")).toBeNull();
  });
});

describe("XAF import and export", () => {
  let A = "";
  let target: ImportTarget;
  const file = parseXaf(SAMPLE);

  beforeAll(async () => {
    const a = await withSystem((tx) => createClientWithAdministration(tx, { name: "Import BV", country: "NL", plan: "BUSINESS", trial: true }));
    A = a.administration.id;
    target = { administrationId: A, country: "NL", baseCurrency: "EUR", ledgerLanguage: "nl", lockedThrough: null, userId: null };
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.journalLine.deleteMany({ where: { administrationId: A } });
      await tx.journalEntry.deleteMany({ where: { administrationId: A } });
      await tx.importBatch.deleteMany({ where: { administrationId: A } });
      await tx.relation.deleteMany({ where: { administrationId: A } });
      await tx.ledgerAccount.deleteMany({ where: { administrationId: A } });
      await tx.warehouse.deleteMany({ where: { administrationId: A } });
      await tx.bankAccount.deleteMany({ where: { administrationId: A } });
      await tx.sequence.deleteMany({ where: { administrationId: A } });
      const admin = await tx.administration.findUniqueOrThrow({ where: { id: A } });
      await tx.client.delete({ where: { id: admin.clientId } });
    });
    await prisma.$disconnect();
  });

  async function importSample() {
    return withTenant(A, async (tx) => {
      const preview = await previewImport(tx, file, "hash-1", target);
      const mapping: Record<string, AccountTarget> = Object.fromEntries(preview.mapping.map((r) => [r.accId, r.target]));
      const journals = preview.journals.filter((j) => j.include).map((j) => j.id);
      return { preview, result: await runImport(tx, file, { fileName: "sample.xaf", fileHash: "hash-1" }, target, { mapping, journals, opening: true, allRelations: false }) };
    });
  }

  it("previews, then imports opening balance and transactions through the posting engine", async () => {
    const { preview, result } = await importSample();
    expect(preview.problems).toEqual([]);
    expect(preview.journals.find((j) => j.id === "191")!.include).toBe(false); // period result postings
    expect(preview.relations).toMatchObject({ total: 3, used: 2, matched: 0 });
    expect(result).toMatchObject({ entries: 3, skipped: 0, relationsCreated: 2, accountsCreated: 2 }); // 4101 rent, 8001 revenue

    const bal = await withTenant(A, (tx) => balances(tx, A));
    expect(bal.get("1000")).toBe(100000);
    expect(bal.get("1300")).toBe(30000 + 12100); // opening open items + invoice 771
    expect(bal.get("1810")).toBe(21000);
    expect(bal.get("1700")).toBe(-2100);
    expect(bal.get("1500")).toBe(-10000);
    expect(bal.get("1600")).toBe(-121000);
    expect(bal.get("0850")).toBe(-120000);
    expect(bal.get("4101")).toBe(100000);
    expect(bal.get("8001")).toBe(-10000);

    const entries = await withTenant(A, (tx) => tx.journalEntry.findMany({ where: { administrationId: A }, include: { lines: true }, orderBy: { number: "asc" } }));
    expect(entries.every((e) => e.source === "IMPORT")).toBe(true);
    expect(entries[1]!.title).toBe("Omzet boeking · 771");
    const lima = await withTenant(A, (tx) => tx.relation.findFirstOrThrow({ where: { administrationId: A, name: "Café Lima" } }));
    expect(lima).toMatchObject({ kind: "CUSTOMER", vatNumber: "NL999999999B01", iban: "NL13INGB0006654471", externalRef: "xaf:Testware:10" });
    // Open items of the opening balance land on the customer.
    const ob = entries[0]!.lines.find((l) => l.accountCode === "1300")!;
    expect(ob).toMatchObject({ debitCents: 30000, relationId: lima.id, description: "Openstaande posten: 101, 102" });
  });

  it("refuses the same file twice", async () => {
    await expect(importSample()).rejects.toThrow(/already been imported/);
  });

  it("exports XAF 3.2 that reads back with the same totals", async () => {
    const xml = await withTenant(A, async (tx) => {
      const admin = await tx.administration.findUniqueOrThrow({ where: { id: A } });
      return renderXaf(await loadXafData(tx, admin, new Date("2025-01-01T00:00:00Z"), new Date("2025-12-31T00:00:00Z"), { name: "LiquidLedger", version: "test" }));
    });
    const back = parseXaf(xml);
    expect(back.version).toBe("3.2");
    const c = checkXaf(back);
    expect(c).toMatchObject({ transactions: 3, totalsMatch: true, unbalanced: [], unknownAccounts: [], unknownRelations: [] });
    expect(back.relations.map((r) => r.name).sort()).toEqual(["Bodega Ica", "Café Lima"]);
    if (process.env.XAF_XSD) {
      const dir = mkdtempSync(path.join(tmpdir(), "xaf-"));
      writeFileSync(path.join(dir, "out.xaf"), xml);
      execFileSync("xmllint", ["--noout", "--schema", process.env.XAF_XSD, path.join(dir, "out.xaf")], { stdio: "pipe" });
    }
  });

  it("reverses an import with mirror entries", async () => {
    const batch = await withTenant(A, (tx) => tx.importBatch.findFirstOrThrow({ where: { administrationId: A } }));
    const r = await withTenant(A, (tx) => reverseImport(tx, A, batch.id, null));
    expect(r.reversed).toBe(3);
    const bal = await withTenant(A, (tx) => balances(tx, A));
    expect([...bal.values()].every((v) => v === 0)).toBe(true);
    await expect(withTenant(A, (tx) => reverseImport(tx, A, batch.id, null))).rejects.toThrow(/already been reversed/);
  });
});
