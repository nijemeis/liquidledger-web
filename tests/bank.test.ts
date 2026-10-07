import { describe, expect, it } from "vitest";
import { parseCamt053, parseCsv } from "@/lib/domain/bank";
import { parseMoney } from "@/lib/format";

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
