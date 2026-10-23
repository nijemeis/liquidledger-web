import { XMLParser } from "fast-xml-parser";

// Parser for the Dutch "XML Auditfile Financieel" (XAF), the standard export
// of Dutch bookkeeping software (Reeleezee, Exact, Twinfield, AFAS, Moneybird,
// e-Boekhouden, SnelStart…). Reads XAF 3.2 and 3.1, and the older 3.0 layout
// (debitAmount/creditAmount, accountID…). Pure: no database access.
//
// Amounts become integer cents, signed: debit positive, credit negative.

export type XafVersion = "3.2" | "3.1" | "3.0" | "unknown";

export interface XafAddress {
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface XafAccount {
  id: string;
  desc: string;
  /** B = balance sheet, P = profit & loss, M = memo. */
  type: "B" | "P" | "M" | "";
  leadCode: string;
  leadDescription: string;
}

export interface XafRelation {
  id: string;
  name: string;
  /** C = customer, S = supplier, B = both, O = other. */
  type: "C" | "S" | "B" | "O" | "";
  email: string;
  phone: string;
  website: string;
  commerceNr: string;
  taxRegIdent: string;
  address: XafAddress;
  iban: string;
}

export interface XafVatCode {
  id: string;
  desc: string;
  payAccount: string;
  claimAccount: string;
}

export interface XafLine {
  nr: string;
  account: string;
  date: string;
  desc: string;
  /** Signed cents: debit > 0, credit < 0. */
  amount: number;
  relation: string;
  docRef: string;
  invRef: string;
}

export interface XafTransaction {
  nr: string;
  desc: string;
  date: string;
  period: string;
  sourceId: string;
  lines: XafLine[];
}

export interface XafJournal {
  id: string;
  desc: string;
  /** B bank, C cash, G goods, M memorial, O opening, P purchases, S sales, T production, Y payroll, Z other. */
  type: string;
  transactions: XafTransaction[];
}

export interface XafOpeningLine {
  nr: string;
  account: string;
  amount: number;
}

export interface XafOpenItem {
  obLineNr: string;
  relation: string;
  invRef: string;
  desc: string;
  amount: number;
}

export interface XafFile {
  version: XafVersion;
  header: {
    fiscalYear: string;
    startDate: string;
    endDate: string;
    currency: string;
    dateCreated: string;
    software: string;
    softwareVersion: string;
  };
  company: { ident: string; name: string; taxRegIdent: string; country: string; address: XafAddress };
  accounts: XafAccount[];
  relations: XafRelation[];
  vatCodes: XafVatCode[];
  opening: { date: string; lines: XafOpeningLine[]; openItems: XafOpenItem[] } | null;
  journals: XafJournal[];
  /** Control totals as stated in the file (null when absent). */
  declared: { lines: number; debit: number; credit: number } | null;
}

export class XafError extends Error {}

type Node = Record<string, unknown>;

const ARRAYS = new Set([
  "customerSupplier",
  "ledgerAccount",
  "vatCode",
  "period",
  "obLine",
  "obSubledger",
  "obSbLine",
  "journal",
  "transaction",
  "trLine",
  "line",
  "subledger",
  "sbLine",
  "streetAddress",
  "postalAddress",
  "bankAccount",
  "vat",
]);

/** "1.234,56"-free decimal string → cents, exact (no float maths). */
export function toCents(raw: unknown): number {
  const s = str(raw).replace(/\s/g, "");
  if (!s) return 0;
  const m = /^([+-])?(\d*)(?:[.,](\d*))?$/.exec(s);
  if (!m) throw new XafError(`Invalid amount "${s}".`);
  const frac = (m[3] ?? "").padEnd(3, "0");
  let cents = Number(m[2] || "0") * 100 + Number(frac.slice(0, 2));
  // Round half away from zero on the third decimal (files carry up to 4).
  if (Number(frac[2]) >= 5) cents += 1;
  return m[1] === "-" ? -cents : cents;
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") {
    const text = (v as Node)["#text"];
    return text === undefined ? "" : String(text).trim();
  }
  return String(v).trim();
}

function arr(v: unknown): Node[] {
  if (v === undefined || v === null || v === "") return [];
  return (Array.isArray(v) ? v : [v]).filter((x): x is Node => typeof x === "object" && x !== null);
}

function obj(v: unknown): Node {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Node) : {};
}

/** First non-empty value among the given element names. */
function pick(n: Node, ...names: string[]): string {
  for (const name of names) {
    const s = str(n[name]);
    if (s) return s;
  }
  return "";
}

function signed(amount: unknown, type: unknown): number {
  const c = toCents(amount);
  const t = str(type).toUpperCase();
  return t === "C" ? -c : c;
}

function address(n: Node | undefined): XafAddress {
  const a = obj(n);
  const street = [pick(a, "streetname"), pick(a, "number"), pick(a, "numberExtension")].filter(Boolean).join(" ");
  return { street, city: pick(a, "city"), postalCode: pick(a, "postalCode"), country: pick(a, "country").toUpperCase() };
}

/** 3.1/3.2 use B/P/M; 3.0 files often spell it out ("Balans", "Winst en verlies"). */
function accountType(tp: string): XafAccount["type"] {
  if (tp === "B" || tp === "P" || tp === "M") return tp;
  if (/^BAL/.test(tp)) return "B";
  if (/WINST|VERLIES|PROFIT|RESULT|^PL$|^P&L$|^W&V$/.test(tp)) return "P";
  return "";
}

function relationType(tp: string): XafRelation["type"] {
  if (tp === "C" || tp === "S" || tp === "B" || tp === "O") return tp;
  if (/^(DEB|CUST|KLANT)/.test(tp)) return "C";
  if (/^(CRED|SUPP|LEV)/.test(tp)) return "S";
  return "";
}

function isoDate(s: string): string {
  // Some exports add a time part; keep the date.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1]! : "";
}

export function parseXaf(xml: string): XafFile {
  const text = xml.replace(/^﻿/, "");
  // No DTDs: blocks entity-expansion tricks before the parser sees them.
  if (/<!(DOCTYPE|ENTITY)/i.test(text)) throw new XafError("The file contains a DTD, which isn't allowed in an auditfile.");
  let doc: Node;
  try {
    doc = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@",
      removeNSPrefix: true,
      parseTagValue: false, // keep "0001" as text
      parseAttributeValue: false,
      trimValues: true,
      processEntities: true,
      htmlEntities: false,
      isArray: (name) => ARRAYS.has(name),
    }).parse(text) as Node;
  } catch (e) {
    throw new XafError(`This isn't a readable XML file (${e instanceof Error ? e.message : String(e)}).`);
  }
  const root = obj(doc.auditfile);
  if (!doc.auditfile) throw new XafError("This isn't an XML auditfile (XAF): the <auditfile> element is missing.");

  const header = obj(root.header);
  // The parser drops namespace declarations, so read the version from the raw text.
  const v3 = /<(?:\w+:)?auditfile[^>]*auditfiles\.nl\/XAF\/3\.(\d)/i.exec(text.slice(0, 2048));
  const version: XafVersion = v3 ? (v3[1] === "2" ? "3.2" : v3[1] === "1" ? "3.1" : "3.0") : str(header.auditfileVersion).startsWith("CLAIR") ? "3.0" : "unknown";
  if (version === "unknown" && !root.company && !root.generalLedger) throw new XafError("Unsupported auditfile version. XAF 3.0, 3.1 and 3.2 are supported.");

  // 3.1/3.2 nest everything under <company>; 3.0 puts it at the root.
  const company = root.company ? obj(root.company) : root;

  const accounts: XafAccount[] = arr(obj(company.generalLedger).ledgerAccount).map((a) => {
    const tp = pick(a, "accTp", "accountType").toUpperCase();
    return {
      id: pick(a, "accID", "accountID"),
      desc: pick(a, "accDesc", "accountDesc") || pick(a, "accID", "accountID"),
      type: accountType(tp),
      leadCode: pick(a, "leadCode"),
      leadDescription: pick(a, "leadDescription"),
    };
  });

  const relations: XafRelation[] = arr(obj(company.customersSuppliers).customerSupplier).map((c) => {
    const tp = pick(c, "custSupTp", "type").toUpperCase();
    const bank = arr(c.bankAccount)[0] ?? {};
    const addr = arr(c.streetAddress)[0] ?? arr(c.postalAddress)[0];
    const legacy: XafAddress | null = c.address || c.city ? { street: pick(c, "address"), city: pick(c, "city"), postalCode: pick(c, "postalCode"), country: pick(c, "country").toUpperCase() } : null;
    return {
      id: pick(c, "custSupID"),
      name: pick(c, "custSupName", "companyName", "contact") || pick(c, "custSupID"),
      type: relationType(tp),
      email: pick(c, "eMail", "email"),
      phone: pick(c, "telephone"),
      website: pick(c, "website"),
      commerceNr: pick(c, "commerceNr"),
      taxRegIdent: pick(c, "taxRegIdent", "taxRegistrationNr"),
      address: addr ? address(addr) : (legacy ?? address(undefined)),
      iban: pick(bank, "bankAccNr") || pick(c, "bankAccountNr"),
    };
  });

  const vatCodes: XafVatCode[] = arr(obj(company.vatCodes).vatCode).map((v) => ({
    id: pick(v, "vatID", "vatCode"),
    desc: pick(v, "vatDesc", "description"),
    payAccount: pick(v, "vatToPayAccID"),
    claimAccount: pick(v, "vatToClaimAccID"),
  }));

  let opening: XafFile["opening"] = null;
  if (company.openingBalance) {
    const ob = obj(company.openingBalance);
    const openItems: XafOpenItem[] = [];
    for (const sb of arr(obj(ob.obSubledgers).obSubledger)) {
      for (const l of arr(sb.obSbLine)) {
        openItems.push({ obLineNr: pick(l, "obLineNr"), relation: pick(l, "custSupID"), invRef: pick(l, "invRef"), desc: pick(l, "desc"), amount: signed(l.amnt, l.amntTp) });
      }
    }
    opening = {
      date: isoDate(pick(ob, "opBalDate")),
      lines: arr(ob.obLine).map((l) => ({ nr: pick(l, "nr"), account: pick(l, "accID"), amount: signed(l.amnt, l.amntTp) })),
      openItems,
    };
  }

  const trs = obj(company.transactions);
  const journals: XafJournal[] = arr(trs.journal).map((j) => ({
    id: pick(j, "jrnID", "journalID"),
    desc: pick(j, "desc", "description") || pick(j, "jrnID", "journalID"),
    type: pick(j, "jrnTp", "type").toUpperCase(),
    transactions: arr(j.transaction).map((t) => {
      const date = isoDate(pick(t, "trDt", "transactionDate"));
      return {
        nr: pick(t, "nr", "transactionID"),
        desc: pick(t, "desc", "description"),
        date,
        period: pick(t, "periodNumber", "period"),
        sourceId: pick(t, "sourceID"),
        lines: [...arr(t.trLine), ...arr(t.line)].map((l) => ({
          nr: pick(l, "nr", "recordID"),
          account: pick(l, "accID", "accountID"),
          date: isoDate(pick(l, "effDate", "effectiveDate")) || date,
          desc: pick(l, "desc", "description"),
          amount: l.amnt !== undefined ? signed(l.amnt, l.amntTp) : toCents(l.debitAmount) - toCents(l.creditAmount),
          relation: pick(l, "custSupID"),
          docRef: pick(l, "docRef", "documentID"),
          invRef: pick(l, "invRef"),
        })),
      };
    }),
  }));

  const declared =
    trs.totalDebit !== undefined || trs.linesCount !== undefined
      ? { lines: Number(str(trs.linesCount) || 0), debit: toCents(trs.totalDebit), credit: toCents(trs.totalCredit) }
      : null;

  const companyAddress = arr(company.streetAddress)[0];
  return {
    version,
    header: {
      fiscalYear: pick(header, "fiscalYear"),
      startDate: isoDate(pick(header, "startDate")),
      endDate: isoDate(pick(header, "endDate")),
      currency: pick(header, "curCode", "currencyCode") || "EUR",
      dateCreated: isoDate(pick(header, "dateCreated")),
      software: pick(header, "softwareDesc", "productID"),
      softwareVersion: pick(header, "softwareVersion", "productVersion"),
    },
    company: {
      ident: pick(company, "companyIdent") || pick(header, "companyID"),
      name: pick(company, "companyName") || pick(header, "companyName"),
      taxRegIdent: pick(company, "taxRegIdent") || pick(header, "taxRegistrationNr"),
      country: (pick(company, "taxRegistrationCountry") || (companyAddress ? pick(companyAddress, "country") : "")).toUpperCase(),
      address: companyAddress
        ? address(companyAddress)
        : { street: pick(header, "companyAddress"), city: pick(header, "companyCity"), postalCode: pick(header, "companyPostalCode"), country: "" },
    },
    accounts,
    relations,
    vatCodes,
    opening,
    journals,
    declared,
  };
}

/** Totals and integrity checks, as shown before anything is imported. */
export function checkXaf(f: XafFile) {
  let lines = 0;
  let debit = 0;
  let credit = 0;
  let transactions = 0;
  const unbalanced: { journal: string; nr: string; diff: number }[] = [];
  const unknownAccounts = new Set<string>();
  const unknownRelations = new Set<string>();
  const accountIds = new Set(f.accounts.map((a) => a.id));
  const relationIds = new Set(f.relations.map((r) => r.id));
  let first = "";
  let last = "";
  for (const j of f.journals) {
    for (const t of j.transactions) {
      transactions++;
      let sum = 0;
      for (const l of t.lines) {
        lines++;
        if (l.amount > 0) debit += l.amount;
        else credit -= l.amount;
        sum += l.amount;
        if (!accountIds.has(l.account)) unknownAccounts.add(l.account);
        if (l.relation && !relationIds.has(l.relation)) unknownRelations.add(l.relation);
      }
      if (sum !== 0) unbalanced.push({ journal: j.id, nr: t.nr, diff: sum });
      if (t.date && (!first || t.date < first)) first = t.date;
      if (t.date && (!last || t.date > last)) last = t.date;
    }
  }
  const openingSum = (f.opening?.lines ?? []).reduce((a, l) => a + l.amount, 0);
  for (const l of f.opening?.lines ?? []) if (!accountIds.has(l.account)) unknownAccounts.add(l.account);
  const totalsMatch = !f.declared || (f.declared.debit === debit && f.declared.credit === credit && (!f.declared.lines || f.declared.lines === lines));
  return {
    transactions,
    lines,
    debit,
    credit,
    first,
    last,
    unbalanced,
    openingBalanced: openingSum === 0,
    openingDiff: openingSum,
    totalsMatch,
    unknownAccounts: [...unknownAccounts],
    unknownRelations: [...unknownRelations],
  };
}

/** Movement per account (opening + transactions), used for type guesses and the mapping table. */
export function accountUsage(f: XafFile) {
  const m = new Map<string, { lines: number; balance: number }>();
  const add = (acc: string, amount: number) => {
    const u = m.get(acc) ?? { lines: 0, balance: 0 };
    u.lines++;
    u.balance += amount;
    m.set(acc, u);
  };
  for (const l of f.opening?.lines ?? []) add(l.account, l.amount);
  for (const j of f.journals) for (const t of j.transactions) for (const l of t.lines) add(l.account, l.amount);
  return m;
}
