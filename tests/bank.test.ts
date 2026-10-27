import { describe, expect, it } from "vitest";
import { parseCamt053, parseCsv } from "@/lib/domain/bank";
import { parseMoney } from "@/lib/format";
import { bankAccountName, detectFormat, dutchIban, isValidIban, parseStatement, StatementError } from "@/lib/domain/statements";

describe("bank statement parsing", () => {
  it("reads CAMT.053", () => {
    const xml = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
      <Acct><Id><IBAN>NL91INGB0006654471</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Ntry><Amt Ccy="EUR">3412.15</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-06</Dt></BookgDt>
        <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Hotel Meridiaan</Nm></Dbtr><DbtrAcct><Id><IBAN>NL44RABO0123456789</IBAN></Id></DbtrAcct></RltdPties>
        <RmtInf><Ustrd>Payment INV-2026-0416</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
      <Ntry><Amt Ccy="EUR">86.40</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-10-04</Dt></BookgDt>
        <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Shell Waalhaven</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Card payment</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
    </Stmt></BkToCstmrStmt></Document>`;
    const r = parseCamt053(xml);
    expect(r.iban).toBe("NL91INGB0006654471");
    expect(r.txs).toHaveLength(2);
    expect(r.txs[0]).toMatchObject({ amountCents: 341215, counterparty: "Hotel Meridiaan", counterpartyIban: "NL44RABO0123456789", description: "Payment INV-2026-0416" });
    expect(r.txs[1]).toMatchObject({ amountCents: -8640, counterparty: "Shell Waalhaven" });
  });
  it("reads Dutch-style CSV", () => {
    const csv = 'Datum;Bedrag;Naam;Omschrijving\n06-10-2026;"1.284,60";Café Rosa;Factuur 0418\n04-10-2026;-86,40;Shell;Fuel\n';
    const r = parseCsv(csv);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ amountCents: 128460, counterparty: "Café Rosa" });
    expect(r[0]!.date.toISOString().slice(0, 10)).toBe("2026-10-06");
    expect(r[1]!.amountCents).toBe(-8640);
  });
  it("parses money in either notation", () => {
    expect(parseMoney("1.234,56")).toBe(123456);
    expect(parseMoney("€1,234.56")).toBe(123456);
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("-86,40")).toBe(-8640);
    expect(parseMoney("abc")).toBeNull();
  });
});

describe("statement formats (ABN AMRO and others)", () => {
  // The textbook example account (ABN AMRO 417164300 = NL91ABNA0417164300), not a real customer.
  const IBAN = "NL91ABNA0417164300";

  it("turns a Dutch account number into an IBAN and names the bank", () => {
    expect(dutchIban("417164300", "ABNA")).toBe(IBAN);
    expect(isValidIban(IBAN)).toBe(true);
    expect(bankAccountName(IBAN)).toBe("ABN AMRO");
    expect(bankAccountName(IBAN, ["ABN AMRO"])).toBe("ABN AMRO ··4300");
  });

  it("reads ABN AMRO MT940 with account, opening balance and wrapped descriptions", () => {
    const sta = [
      "ABNANL2A",
      "940",
      "ABNANL2A",
      ":20:ABN AMRO BANK NV",
      ":25:417164300",
      ":28:13501/1",
      ":60F:C260401EUR1234,56",
      ":61:2604020402D12,50N426NONREF",
      ":86:BEA, Betaalpas                   ALBERT HEIJN 1234,PAS123",
      "NR:ABCD1234, 02.04.26/12:34      AMSTERDAM",
      ":61:2604030403C1000,00N654NONREF",
      ":86:/TRTP/SEPA OVERBOEKING/IBAN/NL44RABO0123456789/BIC/RABONL2U/NAME/",
      "HOTEL MERIDIAAN/REMI/Payment INV-2026-0416/EREF/E2E-77",
      ":61:2604030403D25,00N658NONREF",
      ":86:SEPA Overboeking                 IBAN: NL20INGB0001234567",
      "BIC: INGBNL2A                    Naam: Wijnhandel Noord",
      "Omschrijving: Factuur 2026-11",
      ":62F:C260403EUR2197,06",
      "-",
    ].join("\r\n");
    expect(detectFormat(sta)).toBe("mt940");
    const [st] = parseStatement(sta).statements;
    expect(st).toMatchObject({ iban: IBAN, currency: "EUR", opening: { cents: 123456 } });
    expect(st!.opening!.date.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(st!.txs).toHaveLength(3);
    expect(st!.txs[0]).toMatchObject({ amountCents: -1250, counterparty: "ALBERT HEIJN 1234" });
    expect(st!.txs[1]).toMatchObject({ amountCents: 100000, counterparty: "HOTEL MERIDIAAN", counterpartyIban: "NL44RABO0123456789", description: "Payment INV-2026-0416", ref: "E2E-77" });
    expect(st!.txs[2]).toMatchObject({ amountCents: -2500, counterparty: "Wijnhandel Noord", counterpartyIban: "NL20INGB0001234567", description: "Factuur 2026-11" });
    expect(st!.txs[1]!.date.toISOString().slice(0, 10)).toBe("2026-04-03");
  });

  it("reads ABN AMRO TXT (tab-separated)", () => {
    const txt = [
      "417164300\tEUR\t20260402\t1234,56\t1222,06\t20260402\t-12,50\tBEA, Betaalpas ALBERT HEIJN 1234,PAS123 NR:X, 02.04.26/12:34 AMSTERDAM",
      "417164300\tEUR\t20260403\t1222,06\t2222,06\t20260403\t1.000,00\t/TRTP/SEPA OVERBOEKING/IBAN/NL44RABO0123456789/BIC/RABONL2U/NAME/HOTEL MERIDIAAN/REMI/Payment INV-2026-0416/EREF/NOTPROVIDED",
    ].join("\n");
    expect(detectFormat(txt)).toBe("abn-txt");
    const [st] = parseStatement(txt).statements;
    expect(st).toMatchObject({ iban: IBAN, currency: "EUR", opening: { cents: 123456 } });
    expect(st!.txs.map((x) => x.amountCents)).toEqual([-1250, 100000]);
    expect(st!.txs[1]).toMatchObject({ counterparty: "HOTEL MERIDIAAN", ref: undefined });
  });

  it("reads the opening balance and splits accounts in CAMT.053", () => {
    const stmt = (iban: string, amt: string) =>
      `<Stmt><Acct><Id><IBAN>${iban}</IBAN></Id><Ccy>EUR</Ccy></Acct>
        <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${amt}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Dt><Dt>2026-04-01</Dt></Dt></Bal>
        <Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-04-02</Dt></BookgDt><AddtlNtryInf>/TRTP/SEPA OVERBOEKING/IBAN/NL44RABO0123456789/NAME/KLANT BV/REMI/Factuur 9</AddtlNtryInf></Ntry></Stmt>`;
    const xml = `<?xml version="1.0"?><Document><BkToCstmrStmt>${stmt(IBAN, "50.00")}${stmt("NL91INGB0006654471", "7.00")}</BkToCstmrStmt></Document>`;
    const { statements } = parseStatement(xml);
    expect(statements.map((s) => [s.iban, s.opening?.cents])).toEqual([
      [IBAN, -5000],
      ["NL91INGB0006654471", -700],
    ]);
    expect(statements[0]!.txs[0]).toMatchObject({ counterparty: "KLANT BV", counterpartyIban: "NL44RABO0123456789", description: "Factuur 9" });
  });

  it("refuses files that aren't statements", () => {
    expect(() => parseStatement("<html><body/></html>")).toThrow(StatementError);
  });
});
