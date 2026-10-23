import type { AccountType, JournalSource } from "@prisma/client";
import type { Tx } from "@/lib/domain/types";
import { ACC } from "@/lib/domain/chart";
import { VAT } from "@/lib/domain/vat";
import { balances } from "@/lib/domain/ledger";

// XAF 3.2 export ("XML Auditfile Financieel") of one fiscal year: chart,
// relations, VAT codes, periods, opening balance and every journal entry.
// Element order and lengths follow the official XSD; the result can be read by
// the Belastingdienst, auditors and other bookkeeping packages.

export interface XafExportData {
  software: { name: string; version: string };
  created: Date;
  from: Date;
  to: Date;
  currency: string;
  company: { ident: string | null; name: string; country: string; taxRegIdent: string | null; street: string | null; postcode: string | null; city: string | null };
  accounts: { code: string; name: string; type: AccountType; rgsCode: string | null }[];
  relations: { id: string; name: string; kind: "CUSTOMER" | "SUPPLIER" | "BOTH"; email: string | null; phone: string | null; country: string; vatNumber: string | null; street: string | null; postcode: string | null; city: string | null; iban: string | null }[];
  /** Balance (debit − credit) per account at the day before `from`. */
  opening: Map<string, number>;
  entries: {
    number: number;
    date: Date;
    title: string;
    source: JournalSource;
    lines: { accountCode: string; debitCents: number; creditCents: number; vatCode: string | null; vatBaseCents: number | null; relationId: string | null; description: string | null }[];
  }[];
  lang: "nl" | "en";
}

const JOURNALS: Record<JournalSource, { tp: string; nl: string; en: string }> = {
  OPENING: { tp: "O", nl: "Beginbalans", en: "Opening balance" },
  SALES: { tp: "S", nl: "Verkoop", en: "Sales" },
  PURCHASE: { tp: "P", nl: "Inkoop", en: "Purchases" },
  BANK: { tp: "B", nl: "Bank", en: "Bank" },
  RECEIPT: { tp: "P", nl: "Bonnetjes en declaraties", en: "Receipts & expense claims" },
  STOCK: { tp: "G", nl: "Voorraad", en: "Stock" },
  EXCISE: { tp: "M", nl: "Accijns", en: "Excise" },
  MANUAL: { tp: "M", nl: "Memoriaal", en: "General journal" },
  PAYROLL_IMPORT: { tp: "Y", nl: "Salaris", en: "Payroll" },
  IMPORT: { tp: "Z", nl: "Overgenomen boekingen", en: "Imported bookings" },
};

const VAT_DESC: Record<string, { nl: string; en: string }> = {
  [VAT.SALES_HIGH]: { nl: "Omzet hoog tarief", en: "Sales, standard rate" },
  [VAT.SALES_LOW]: { nl: "Omzet laag tarief", en: "Sales, reduced rate" },
  [VAT.SALES_ZERO]: { nl: "Omzet 0% of vrijgesteld", en: "Sales, 0% or exempt" },
  [VAT.EXPORT]: { nl: "Export buiten de EU", en: "Exports outside the EU" },
  [VAT.ICP]: { nl: "Intracommunautaire levering", en: "Intra-community supply" },
  [VAT.IMPORT]: { nl: "Invoer-btw (verlegd)", en: "Import VAT (reverse charge)" },
  [VAT.EU_ACQ]: { nl: "Intracommunautaire verwerving", en: "Intra-community acquisition" },
  [VAT.EU_SERVICES]: { nl: "Diensten uit de EU (verlegd)", en: "EU services (reverse charge)" },
  [VAT.INPUT]: { nl: "Voorbelasting", en: "Input VAT" },
};

const VAT_ACCOUNTS = new Set<string>([ACC.vatPayable, ACC.vatReclaim]);

/** Characters XML 1.0 doesn't allow, plus the escapes it needs. */
export function esc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Cents → "1234.56" (absolute; the side goes in amntTp). */
export function amount(cents: number): string {
  const a = Math.abs(Math.round(cents));
  return `${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

class Xml {
  private out: string[] = [];
  private depth = 0;
  open(tag: string) {
    this.out.push(`${"  ".repeat(this.depth)}<${tag}>`);
    this.depth++;
  }
  close(tag: string) {
    this.depth--;
    this.out.push(`${"  ".repeat(this.depth)}</${tag}>`);
  }
  el(tag: string, value: string | number | null | undefined, max?: number) {
    if (value === null || value === undefined || value === "") return;
    const s = String(value).trim();
    if (!s) return;
    this.out.push(`${"  ".repeat(this.depth)}<${tag}>${esc(max ? cut(s, max) : s)}</${tag}>`);
  }
  /** Required element; written even when empty. */
  req(tag: string, value: string | number | null | undefined, max?: number) {
    const s = value === null || value === undefined ? "" : String(value).trim();
    this.out.push(`${"  ".repeat(this.depth)}<${tag}>${esc(max ? cut(s, max) : s)}</${tag}>`);
  }
  toString() {
    return this.out.join("\r\n") + "\r\n";
  }
}

function months(from: Date, to: Date) {
  const out: { nr: number; start: Date; end: Date }[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  while (Date.UTC(y, m, 1) <= to.getTime() && out.length < 999) {
    out.push({ nr: out.length + 1, start: new Date(Date.UTC(y, m, 1)), end: new Date(Math.min(Date.UTC(y, m + 1, 0), to.getTime())) });
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }
  return out;
}

const isCountry = (s: string | null | undefined): s is string => !!s && /^[A-Z]{2}$/.test(s);

export function renderXaf(d: XafExportData): string {
  const x = new Xml();
  const balanceSheet = (t: AccountType) => t === "ASSET" || t === "LIABILITY" || t === "EQUITY";
  const periods = months(d.from, d.to);
  const periodOf = (date: Date) => periods.find((p) => date >= p.start && date <= p.end)?.nr ?? 1;

  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<auditfile xmlns="http://www.auditfiles.nl/XAF/3.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'];
  x.open("header");
  x.req("fiscalYear", d.from.getUTCFullYear() === d.to.getUTCFullYear() ? String(d.from.getUTCFullYear()) : `${d.from.getUTCFullYear()}/${String(d.to.getUTCFullYear()).slice(2)}`, 9);
  x.req("startDate", iso(d.from));
  x.req("endDate", iso(d.to));
  x.req("curCode", d.currency);
  x.req("dateCreated", iso(d.created));
  x.el("softwareDesc", d.software.name, 50);
  x.el("softwareVersion", d.software.version, 20);
  x.close("header");

  x.open("company");
  x.el("companyIdent", d.company.ident, 35);
  x.req("companyName", d.company.name, 999);
  x.req("taxRegistrationCountry", d.company.country);
  x.req("taxRegIdent", d.company.taxRegIdent, 30);
  if (d.company.street || d.company.city || d.company.postcode) {
    x.open("streetAddress");
    x.el("streetname", d.company.street, 999);
    x.el("city", d.company.city, 50);
    x.el("postalCode", d.company.postcode, 10);
    x.el("country", d.company.country);
    x.close("streetAddress");
  }

  if (d.relations.length) {
    x.open("customersSuppliers");
    for (const r of d.relations) {
      x.open("customerSupplier");
      x.req("custSupID", r.id, 35);
      x.el("custSupName", r.name, 50);
      x.el("telephone", r.phone, 30);
      x.el("eMail", r.email);
      if (isCountry(r.country)) x.el("taxRegistrationCountry", r.country);
      x.el("taxRegIdent", r.vatNumber, 30);
      x.req("custSupTp", r.kind === "CUSTOMER" ? "C" : r.kind === "SUPPLIER" ? "S" : "B");
      if (r.street || r.city || r.postcode || isCountry(r.country)) {
        x.open("streetAddress");
        x.el("streetname", r.street, 999);
        x.el("city", r.city, 50);
        x.el("postalCode", r.postcode, 10);
        if (isCountry(r.country)) x.el("country", r.country);
        x.close("streetAddress");
      }
      if (r.iban) {
        x.open("bankAccount");
        x.req("bankAccNr", r.iban, 35);
        x.close("bankAccount");
      }
      x.close("customerSupplier");
    }
    x.close("customersSuppliers");
  }

  x.open("generalLedger");
  for (const a of d.accounts) {
    x.open("ledgerAccount");
    x.req("accID", a.code, 35);
    x.req("accDesc", a.name, 999);
    x.req("accTp", balanceSheet(a.type) ? "B" : "P");
    x.el("leadCode", a.rgsCode, 999);
    x.close("ledgerAccount");
  }
  x.close("generalLedger");

  const usedVat = [...new Set(d.entries.flatMap((e) => e.lines.map((l) => l.vatCode)).filter((c): c is string => !!c))].sort();
  if (usedVat.length) {
    x.open("vatCodes");
    for (const c of usedVat) {
      x.open("vatCode");
      x.req("vatID", c, 35);
      x.req("vatDesc", VAT_DESC[c]?.[d.lang] ?? c, 999);
      const claim = c === VAT.INPUT || c === VAT.IMPORT || c === VAT.EU_ACQ || c === VAT.EU_SERVICES;
      const pay = c !== VAT.INPUT;
      if (pay) x.el("vatToPayAccID", ACC.vatPayable);
      if (claim) x.el("vatToClaimAccID", ACC.vatReclaim);
      x.close("vatCode");
    }
    x.close("vatCodes");
  }

  x.open("periods");
  for (const p of periods) {
    x.open("period");
    x.req("periodNumber", p.nr);
    x.el("periodDesc", `${p.start.getUTCFullYear()}-${String(p.start.getUTCMonth() + 1).padStart(2, "0")}`);
    x.req("startDatePeriod", iso(p.start));
    x.req("endDatePeriod", iso(p.end));
    x.close("period");
  }
  x.close("periods");

  // Opening balance: balance-sheet accounts as they stood; earlier years' results
  // go to retained earnings, since Liquid Ledger has no closing entries.
  const accType = new Map(d.accounts.map((a) => [a.code, a.type]));
  const ob = new Map<string, number>();
  let earlierResult = 0;
  for (const [code, bal] of d.opening) {
    const t = accType.get(code);
    if (t && !balanceSheet(t)) earlierResult += bal;
    else ob.set(code, (ob.get(code) ?? 0) + bal);
  }
  if (earlierResult) ob.set(ACC.retained, (ob.get(ACC.retained) ?? 0) + earlierResult);
  const obLines = [...ob].filter(([, b]) => b !== 0).sort(([a], [b]) => a.localeCompare(b));
  if (obLines.length) {
    x.open("openingBalance");
    x.req("opBalDate", iso(d.from));
    x.req("linesCount", obLines.length);
    x.req("totalDebit", amount(obLines.reduce((a, [, b]) => a + Math.max(b, 0), 0)));
    x.req("totalCredit", amount(obLines.reduce((a, [, b]) => a + Math.max(-b, 0), 0)));
    obLines.forEach(([code, b], i) => {
      x.open("obLine");
      x.req("nr", i + 1);
      x.req("accID", code);
      x.req("amnt", amount(b));
      x.req("amntTp", b >= 0 ? "D" : "C");
      x.close("obLine");
    });
    x.close("openingBalance");
  }

  let lineCount = 0;
  let debit = 0;
  let credit = 0;
  for (const e of d.entries)
    for (const l of e.lines) {
      lineCount++;
      debit += l.debitCents;
      credit += l.creditCents;
    }
  x.open("transactions");
  x.req("linesCount", lineCount);
  x.req("totalDebit", amount(debit));
  x.req("totalCredit", amount(credit));
  const sources = (Object.keys(JOURNALS) as JournalSource[]).filter((s) => d.entries.some((e) => e.source === s));
  let lineNr = 0;
  for (const s of sources) {
    x.open("journal");
    x.req("jrnID", s);
    x.req("desc", JOURNALS[s][d.lang]);
    x.req("jrnTp", JOURNALS[s].tp);
    for (const e of d.entries) {
      if (e.source !== s) continue;
      x.open("transaction");
      x.req("nr", e.number);
      x.el("desc", e.title, 9999);
      x.req("periodNumber", periodOf(e.date));
      x.req("trDt", iso(e.date));
      x.el("sourceID", s, 35);
      for (const l of e.lines) {
        const cents = l.debitCents - l.creditCents;
        x.open("trLine");
        x.req("nr", ++lineNr);
        x.req("accID", l.accountCode, 35);
        x.req("docRef", e.number, 999);
        x.req("effDate", iso(e.date));
        x.el("desc", l.description || e.title, 9999);
        x.req("amnt", amount(cents));
        x.req("amntTp", cents >= 0 ? "D" : "C");
        x.el("custSupID", l.relationId, 35);
        if (l.vatCode) {
          const isVat = VAT_ACCOUNTS.has(l.accountCode);
          const base = Math.abs(l.vatBaseCents ?? 0);
          const perc = isVat && base ? Math.round((Math.abs(cents) / base) * 100_000) / 1000 : 0;
          x.open("vat");
          x.req("vatID", l.vatCode, 35);
          x.req("vatPerc", perc.toFixed(3));
          x.req("vatAmnt", amount(isVat ? cents : 0));
          x.req("vatAmntTp", cents >= 0 ? "D" : "C");
          x.close("vat");
        }
        x.close("trLine");
      }
      x.close("transaction");
    }
    x.close("journal");
  }
  x.close("transactions");
  x.close("company");
  return out.join("\r\n") + "\r\n" + x.toString() + "</auditfile>\r\n";
}

export async function loadXafData(
  tx: Tx,
  admin: { id: string; legalName: string; country: string; baseCurrency: string; vatNumber: string | null; cocNumber: string | null; addressLine: string | null; postcode: string | null; city: string | null; ledgerLanguage: string },
  from: Date,
  to: Date,
  software: { name: string; version: string },
): Promise<XafExportData> {
  const A = admin.id;
  const lang = admin.ledgerLanguage === "nl" ? "nl" : "en";
  const [accounts, entries, opening] = await Promise.all([
    tx.ledgerAccount.findMany({ where: { administrationId: A }, orderBy: { code: "asc" } }),
    tx.journalEntry.findMany({ where: { administrationId: A, date: { gte: from, lte: to } }, orderBy: [{ date: "asc" }, { number: "asc" }], include: { lines: { orderBy: { id: "asc" } } } }),
    balances(tx, A, { to: new Date(from.getTime() - 86_400_000) }),
  ]);
  const used = new Set(entries.flatMap((e) => e.lines.map((l) => l.relationId)).filter((x): x is string => !!x));
  const relations = await tx.relation.findMany({
    where: { administrationId: A, OR: [{ archivedAt: null }, { id: { in: [...used] } }] },
    orderBy: { name: "asc" },
  });
  return {
    software,
    created: new Date(),
    from,
    to,
    currency: admin.baseCurrency,
    company: { ident: admin.cocNumber, name: admin.legalName, country: admin.country, taxRegIdent: admin.vatNumber, street: admin.addressLine, postcode: admin.postcode, city: admin.city },
    accounts: accounts.map((a) => ({ code: a.code, name: lang === "nl" ? a.nameNl : a.nameEn, type: a.type, rgsCode: a.rgsCode })),
    relations: relations.map((r) => ({ id: r.id, name: r.name, kind: r.kind, email: r.email, phone: r.phone, country: r.country, vatNumber: r.vatNumber, street: r.addressLine, postcode: r.postcode, city: r.city, iban: r.iban })),
    opening,
    entries: entries.map((e) => ({ number: e.number, date: e.date, title: e.title, source: e.source, lines: e.lines })),
    lang,
  };
}
