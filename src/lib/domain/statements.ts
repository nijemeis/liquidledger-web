import { XMLParser } from "fast-xml-parser";

// Bank statement files as Dutch banks export them. Every parser returns one
// statement per account in the file, with the account's IBAN, currency and
// opening balance when the format carries them, so an import can find (or
// create) the bank account by itself. Pure: no database access.
//
//  - CAMT.053 (ISO 20022 XML): ABN AMRO, ING, Rabobank, Triodos, bunq, Knab…
//  - MT940 (SWIFT, .sta/.940): ABN AMRO, ING, Rabobank, SNS/ASN…
//  - ABN AMRO "TXT" (tab-separated, no header)
//  - CSV with a header (date, amount, counterparty, description[, iban])

export interface ParsedTx {
  date: Date;
  amountCents: number;
  counterparty: string;
  counterpartyIban?: string;
  description: string;
  ref?: string;
}

export interface ParsedStatement {
  iban?: string;
  currency?: string;
  /** Balance before the first transaction in the file. */
  opening?: { cents: number; date: Date };
  txs: ParsedTx[];
}

export type StatementFormat = "camt053" | "mt940" | "abn-txt" | "csv";

export class StatementError extends Error {}

// ── IBAN helpers ─────────────────────────────────────────────────────────────

export const compactIban = (iban: string) => iban.replace(/\s+/g, "").toUpperCase();

function mod97(s: string): number {
  let rem = 0;
  for (const ch of s) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem;
}

/** ISO 13616 check (mod 97). */
export function isValidIban(iban: string): boolean {
  const s = compactIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  return mod97(s.slice(4) + s.slice(0, 4)) === 1;
}

/** Dutch account number + bank code → IBAN ("459264885", "ABNA" → "NL39ABNA0459264885"). */
export function dutchIban(accountNumber: string, bankCode: string): string | undefined {
  const digits = accountNumber.replace(/\D/g, "");
  if (!digits || digits.length > 10) return undefined;
  const bban = bankCode + digits.padStart(10, "0");
  const check = 98 - mod97(bban + "NL00");
  const iban = `NL${String(check).padStart(2, "0")}${bban}`;
  return isValidIban(iban) ? iban : undefined;
}

const BANKS: Record<string, string> = {
  ABNA: "ABN AMRO",
  INGB: "ING",
  RABO: "Rabobank",
  TRIO: "Triodos",
  BUNQ: "bunq",
  KNAB: "Knab",
  SNSB: "SNS",
  ASNB: "ASN Bank",
  RBRB: "RegioBank",
  REVO: "Revolut",
  FVLB: "Van Lanschot",
  HAND: "Handelsbanken",
};

/** Name for a new bank account: the bank ("ABN AMRO"), with the last digits when that name is taken. */
export function bankAccountName(iban: string, taken: readonly string[] = []): string {
  const s = compactIban(iban);
  const bank = (s.startsWith("NL") ? BANKS[s.slice(4, 8)] : undefined) ?? `Bank ${s.slice(0, 2)}`;
  return taken.includes(bank) ? `${bank} ··${s.slice(-4)}` : bank;
}

// ── Amounts and dates ────────────────────────────────────────────────────────

/** "1.234,56" / "1234.56" / "-12,5" → cents. */
export function amountCents(raw: string): number {
  let a = raw.replace(/[€\s]/g, "");
  if (a.lastIndexOf(",") > a.lastIndexOf(".")) a = a.replace(/\./g, "").replace(",", ".");
  else a = a.replace(/,/g, "");
  if (!/^[+-]?\d*(\.\d+)?$/.test(a) || a === "" || a === "-") return NaN;
  return Math.round(Number(a) * 100);
}

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
/** YYMMDD (MT940) → date; years 70–99 are 19xx. */
const yymmdd = (s: string) => ymd((Number(s.slice(0, 2)) < 70 ? 2000 : 1900) + Number(s.slice(0, 2)), Number(s.slice(2, 4)), Number(s.slice(4, 6)));
const yyyymmdd = (s: string) => ymd(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));

// ── Description (MT940 :86: and ABN TXT) ─────────────────────────────────────

const TAGS = ["TRTP", "IBAN", "BIC", "NAME", "REMI", "EREF", "CSID", "MARF", "ORDP", "BENM", "ADDR", "SVCL", "ISDT", "PREF", "RTRN", "ULTC", "ULTD", "PURP", "CNTP", "ID"];

/**
 * Turns a bank's free text into counterparty, IBAN, description and reference.
 * Handles the SEPA "/TRTP/…/IBAN/…/NAME/…/REMI/…" form, ABN AMRO's
 * "SEPA Overboeking IBAN: … Naam: … Omschrijving: …" form and card payments.
 */
export function parseDescription(raw: string): { counterparty: string; iban?: string; description: string; ref?: string } {
  const text = raw.replace(/\s+/g, " ").trim();
  if (/^\/(TRTP|CNTP|EREF|NAME|IBAN|REMI)\//.test(text)) {
    const re = new RegExp(`\\/(${TAGS.join("|")})\\/`, "g");
    const hits = [...text.matchAll(re)];
    const f: Record<string, string> = {};
    hits.forEach((m, i) => {
      const end = i + 1 < hits.length ? hits[i + 1]!.index! : text.length;
      f[m[1]!] ??= text.slice(m.index! + m[0].length, end).trim();
    });
    // CNTP (Rabobank) = IBAN/BIC/NAME/CITY
    if (f.CNTP && !f.NAME) {
      const [ib, , name] = f.CNTP.split("/");
      f.IBAN ??= ib ?? "";
      f.NAME = name ?? "";
    }
    const remi = (f.REMI ?? "").replace(/^(USTD|STRD)\/\/?/, "").replace(/^CUR\/\/?/, "").replace(/\/$/, "").trim();
    const ref = f.EREF && f.EREF !== "NOTPROVIDED" ? f.EREF : undefined;
    return { counterparty: f.NAME || f.TRTP || "Unknown", iban: f.IBAN || undefined, description: remi || f.TRTP || "—", ref };
  }
  const label = (l: string) => new RegExp(`${l}:\\s*(.*?)(?=\\s+(?:IBAN|BIC|Naam|Omschrijving|Kenmerk|Machtiging|Incassant|Betalingskenm\\.|Referentie):|$)`, "i").exec(text)?.[1]?.trim();
  if (/IBAN:|Naam:/i.test(text)) {
    return { counterparty: label("Naam") || "Unknown", iban: label("IBAN")?.split(" ")[0], description: label("Omschrijving") || label("Betalingskenm\\.") || text.slice(0, 120), ref: label("Kenmerk") || undefined };
  }
  // Card payment / ATM: "BEA, Betaalpas Albert Heijn 1234,PAS123 NR:… 01.02.25/12:34 Amsterdam" or "BEA NR:… 01.02.25/12.34 ALBERT HEIJN,PAS123"
  if (/^(BEA|GEA|eCom)/i.test(text)) {
    const m = /Betaalpas\s+(.+?),PAS/i.exec(text) ?? /\d{2}\.\d{2}\.\d{2}\/\d{2}[.:]\d{2}\s+(.+?)(?:,PAS\d+|$)/.exec(text);
    return { counterparty: (m?.[1] ?? text.slice(0, 40)).trim(), description: text.slice(0, 300) };
  }
  if (/^ABN AMRO Bank/i.test(text)) return { counterparty: "ABN AMRO", description: text.slice(0, 300) };
  return { counterparty: text.slice(0, 60) || "Unknown", description: text.slice(0, 300) || "—" };
}

// ── CAMT.053 ─────────────────────────────────────────────────────────────────

export function parseCamt053Statements(xml: string): ParsedStatement[] {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, isArray: (name) => ["Stmt", "Ntry", "NtryDtls", "TxDtls", "Ustrd", "Bal"].includes(name) });
  const doc = parser.parse(xml);
  const stmts = doc?.Document?.BkToCstmrStmt?.Stmt;
  if (!Array.isArray(stmts)) throw new StatementError("Not a CAMT.053 statement.");
  const num = (amt: unknown) => (typeof amt === "object" && amt ? Number((amt as Record<string, unknown>)["#text"]) : Number(amt));
  return stmts.map((st): ParsedStatement => {
    const txs: ParsedTx[] = [];
    for (const n of st.Ntry ?? []) {
      const sign = n.CdtDbtInd === "DBIT" ? -1 : 1;
      const date = new Date(String(n.BookgDt?.Dt ?? n.ValDt?.Dt ?? n.BookgDt?.DtTm ?? "").slice(0, 10) + "T00:00:00Z");
      const det = n.NtryDtls?.[0]?.TxDtls?.[0];
      const parties = det?.RltdPties ?? {};
      const cp = sign > 0 ? parties.Dbtr : parties.Cdtr;
      const cpAcct = sign > 0 ? parties.DbtrAcct : parties.CdtrAcct;
      const strd = det?.RmtInf?.Strd?.CdtrRefInf?.Ref;
      // No structured parties (ABN AMRO card payments, some exports): read the free text instead.
      const fallback = !cp && n.AddtlNtryInf ? parseDescription(String(n.AddtlNtryInf)) : null;
      const ustrd = det?.RmtInf?.Ustrd?.join(" ") ?? (fallback ? "" : (n.AddtlNtryInf ?? ""));
      txs.push({
        date,
        amountCents: Math.round(num(n.Amt) * 100) * sign,
        counterparty: String(cp?.Nm ?? cp?.Pty?.Nm ?? fallback?.counterparty ?? "Unknown").slice(0, 140),
        counterpartyIban: cpAcct?.Id?.IBAN ?? fallback?.iban,
        description: String(strd ? `${strd} ${ustrd}` : ustrd || fallback?.description || "—").trim().slice(0, 300),
        ref: det?.Refs?.EndToEndId && det.Refs.EndToEndId !== "NOTPROVIDED" ? det.Refs.EndToEndId : n.AcctSvcrRef,
      });
    }
    // Opening booked balance (OPBD), or the previous closing balance (PRCD).
    const bals: { Tp?: { CdOrPrtry?: { Cd?: string } }; Amt?: unknown; CdtDbtInd?: string; Dt?: { Dt?: string; DtTm?: string } }[] = st.Bal ?? [];
    const ob = bals.find((b) => b.Tp?.CdOrPrtry?.Cd === "OPBD") ?? bals.find((b) => b.Tp?.CdOrPrtry?.Cd === "PRCD");
    const opening = ob
      ? { cents: Math.round(num(ob.Amt) * 100) * (ob.CdtDbtInd === "DBIT" ? -1 : 1), date: new Date(String(ob.Dt?.Dt ?? ob.Dt?.DtTm ?? "").slice(0, 10) + "T00:00:00Z") }
      : undefined;
    return { iban: st?.Acct?.Id?.IBAN ? compactIban(st.Acct.Id.IBAN) : undefined, currency: st?.Acct?.Ccy, opening: opening && !Number.isNaN(opening.date.getTime()) ? opening : undefined, txs };
  });
}

// ── MT940 ────────────────────────────────────────────────────────────────────

/** The account in :25:, as an IBAN where possible (ABN AMRO writes a bare account number). */
function mt940Account(raw: string, bankCode: string | undefined): { iban?: string; currency?: string } {
  const s = raw.replace(/\s/g, "").toUpperCase();
  const withCur = /^([A-Z]{2}\d{2}[A-Z0-9]+?)([A-Z]{3})?$/.exec(s);
  if (withCur && isValidIban(withCur[1]!)) return { iban: withCur[1], currency: withCur[2] };
  if (isValidIban(s)) return { iban: s };
  const digits = s.split("/").pop()!.replace(/\D/g, "");
  if (bankCode && digits) return { iban: dutchIban(digits, bankCode) };
  return {};
}

export function parseMt940(text: string): ParsedStatement[] {
  const bankCode = /\b(ABNA|INGB|RABO|SNSB|TRIO|ASNB|RBRB|KNAB|BUNQ)/.exec(text.slice(0, 200))?.[1];
  // Fields start with ":NN[A]:" at the start of a line; other lines continue the previous field.
  // :86: wraps at 65 characters: a full line continues mid-word, a shorter one ended at a word.
  const fields: { tag: string; value: string; last: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
    if (m) fields.push({ tag: m[1]!, value: m[2]!, last: line.length });
    else if (fields.length && line.trim() && !/^-\}?$/.test(line.trim()) && !/^\{/.test(line)) {
      const f = fields[fields.length - 1]!;
      f.value += f.tag === "86" ? (f.last >= 64 ? "" : " ") + line : "\n" + line;
      f.last = line.length;
    }
  }
  const out: ParsedStatement[] = [];
  let cur: ParsedStatement | null = null;
  let pending: { date: Date; amountCents: number; ref?: string } | null = null;
  const flush = (desc: string) => {
    if (!pending || !cur) return;
    const d = parseDescription(desc);
    cur.txs.push({ date: pending.date, amountCents: pending.amountCents, counterparty: d.counterparty.slice(0, 140), counterpartyIban: d.iban, description: d.description.slice(0, 300), ref: d.ref ?? pending.ref });
    pending = null;
  };
  for (const f of fields) {
    switch (f.tag) {
      case "25": {
        flush("");
        const acc = mt940Account(f.value, bankCode);
        // Several :20: blocks for one account (one per day) merge into one statement.
        const same = out.find((s) => s.iban && s.iban === acc.iban);
        cur = same ?? { iban: acc.iban, currency: acc.currency, txs: [] };
        if (!same) out.push(cur);
        break;
      }
      case "60F":
      case "60M": {
        const m = /^([CD])(\d{6})([A-Z]{3})([\d,]+)/.exec(f.value.trim());
        if (cur && m) {
          cur.currency ??= m[3];
          if (!cur.opening) cur.opening = { cents: amountCents(m[4]!) * (m[1] === "D" ? -1 : 1), date: yymmdd(m[2]!) };
        }
        break;
      }
      case "61": {
        flush("");
        const m = /^(\d{6})(\d{4})?(R?[CD])([A-Z])?([\d,]+)(?:[A-Z]\w{3})?([^/\n]*)?/.exec(f.value.trim());
        if (!m || !cur) break;
        const credit = m[3] === "C" || m[3] === "RD"; // RD = reversal of a debit
        const ref = m[6]?.trim();
        pending = { date: yymmdd(m[1]!), amountCents: amountCents(m[5]!) * (credit ? 1 : -1), ref: ref && ref !== "NONREF" ? ref : undefined };
        break;
      }
      case "86":
        flush(f.value);
        break;
    }
  }
  flush("");
  if (!out.length) throw new StatementError("Not an MT940 statement.");
  return out;
}

// ── ABN AMRO TXT ─────────────────────────────────────────────────────────────

/** Tab-separated, no header: account, currency, date, opening, closing, value date, amount, description. */
export function parseAbnTxt(text: string): ParsedStatement[] {
  const byAccount = new Map<string, ParsedStatement>();
  for (const line of text.split(/\r?\n/)) {
    const c = line.split("\t");
    if (c.length < 8 || !/^\d{8}$/.test(c[2]!.trim())) continue;
    const acct = c[0]!.trim();
    const iban = isValidIban(acct) ? compactIban(acct) : dutchIban(acct, "ABNA");
    const key = iban ?? acct;
    let st = byAccount.get(key);
    if (!st) {
      st = { iban, currency: c[1]!.trim() || undefined, opening: { cents: amountCents(c[3]!), date: yyyymmdd(c[2]!.trim()) }, txs: [] };
      byAccount.set(key, st);
    }
    const d = parseDescription(c.slice(7).join(" "));
    const cents = amountCents(c[6]!);
    if (!Number.isFinite(cents)) continue;
    st.txs.push({ date: yyyymmdd(c[2]!.trim()), amountCents: cents, counterparty: d.counterparty.slice(0, 140), counterpartyIban: d.iban, description: d.description.slice(0, 300), ref: d.ref });
  }
  if (!byAccount.size) throw new StatementError("Not an ABN AMRO TXT statement.");
  return [...byAccount.values()];
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** Date, amount, counterparty, description[, iban]; comma or semicolon; either decimal mark. */
export function parseCsvRows(text: string): ParsedTx[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
  const split = (l: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]!).map((h) => h.toLowerCase());
  const hasHeader = header.some((h) => /date|datum|amount|bedrag/.test(h));
  const idx = (re: RegExp, fallback: number) => {
    const i = header.findIndex((h) => re.test(h));
    return hasHeader && i >= 0 ? i : fallback;
  };
  const iDate = idx(/date|datum/, 0);
  const iAmt = idx(/amount|bedrag/, 1);
  const iName = idx(/name|naam|counterparty|tegenpartij/, 2);
  const iDesc = idx(/desc|omschrijving|mededeling/, 3);
  const iIban = idx(/iban|tegenrekening/, 4);
  const rows = hasHeader ? lines.slice(1) : lines;
  const out: ParsedTx[] = [];
  for (const l of rows) {
    const c = split(l);
    const rawDate = c[iDate] ?? "";
    const d = /^\d{8}$/.test(rawDate)
      ? yyyymmdd(rawDate)
      : /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(rawDate)
        ? (() => {
            const [dd, mm, yy] = rawDate.split(/[-/.]/);
            return ymd(Number(yy), Number(mm), Number(dd));
          })()
        : new Date(rawDate.slice(0, 10) + "T00:00:00Z");
    const amount = amountCents(c[iAmt] ?? "");
    if (Number.isNaN(d.getTime()) || !Number.isFinite(amount)) continue;
    out.push({ date: d, amountCents: amount, counterparty: (c[iName] || "Unknown").slice(0, 140), description: (c[iDesc] || "—").slice(0, 300), counterpartyIban: c[iIban] || undefined });
  }
  return out;
}

// ── Detection ────────────────────────────────────────────────────────────────

export function detectFormat(text: string): StatementFormat {
  const t = text.replace(/^﻿/, "").trimStart();
  if (t.startsWith("<")) return "camt053";
  if (/^:20:|\n:20:/.test(t) && /:61:/.test(t)) return "mt940";
  if (/^(ABNANL2A|\{1:)/.test(t) && /:61:/.test(t)) return "mt940";
  const first = t.split(/\r?\n/)[0] ?? "";
  const c = first.split("\t");
  if (c.length >= 8 && /^[A-Z]{3}$/.test(c[1]!.trim()) && /^\d{8}$/.test(c[2]!.trim())) return "abn-txt";
  return "csv";
}

export function parseStatement(text: string): { format: StatementFormat; statements: ParsedStatement[] } {
  const clean = text.replace(/^﻿/, "");
  const format = detectFormat(clean);
  switch (format) {
    case "camt053":
      return { format, statements: parseCamt053Statements(clean) };
    case "mt940":
      return { format, statements: parseMt940(clean) };
    case "abn-txt":
      return { format, statements: parseAbnTxt(clean) };
    case "csv":
      return { format, statements: [{ txs: parseCsvRows(clean) }] };
  }
}
