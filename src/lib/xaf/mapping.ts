import type { AccountType } from "@prisma/client";
import { ACC } from "@/lib/domain/chart";
import type { XafAccount, XafFile, XafJournal } from "./parse";
import { accountUsage } from "./parse";

// Suggested mapping from the accounts in an auditfile to this administration's
// chart. Other packages number their accounts differently (Reeleezee's 1300 is
// input VAT, ours is receivables), so codes are never matched blindly: control
// accounts are recognised by name, everything else becomes a new account under
// the file's own code (or the next free one). The user reviews every row.

export interface ChartAccount {
  code: string;
  nameNl: string;
  nameEn: string;
  type: AccountType;
}

export interface AccountTarget {
  code: string;
  /** true = create this account; false = book on the existing account `code`. */
  create: boolean;
  name: string;
  type: AccountType;
}

export interface MappingRow {
  accId: string;
  desc: string;
  xafType: XafAccount["type"];
  lines: number;
  balance: number;
  /** Where the account is used: journal ids, and "opening" for the opening balance. */
  usedIn: string[];
  target: AccountTarget;
  reason: "control" | "same" | "new" | "renumbered";
}

export const ACCOUNT_CODE = /^\d{4,6}$/;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Control accounts the posting engine relies on, recognised by (Dutch or English) name. */
const CONTROL: { code: string; test: RegExp; type?: "B" | "P" }[] = [
  { code: ACC.receivables, test: /\bdebiteuren\b|accounts receivable|trade debtors|\bdebtors\b/, type: "B" },
  { code: ACC.payables, test: /\bcrediteuren\b|accounts payable|trade creditors|\bcreditors\b/, type: "B" },
  { code: ACC.vatReclaim, test: /voorbelasting|te vorderen (btw|omzetbelasting)|\bbtw betaald\b|input vat|vat (to )?reclaim/, type: "B" },
  { code: ACC.vatPayable, test: /\b(btw|omzetbelasting) (ontvangen|af te dragen)\b(?! op aangifte)|^af te dragen (btw|omzetbelasting)$|output vat|vat payable/, type: "B" },
  { code: ACC.wageTax, test: /loonbelasting|loonheffing|wage tax|payroll tax/, type: "B" },
  { code: ACC.equity, test: /^(eigen vermogen|aandelenkapitaal|geplaatst kapitaal|ondernemingsvermogen|equity|share capital)$/, type: "B" },
  { code: ACC.retained, test: /resultaat (lopend|vorig|voorgaand) boekjaar|onverdeelde winst|retained earnings|result for the year/, type: "B" },
  { code: "4820", test: /^bankkosten$|^bank (charges|costs|fees)$/, type: "P" },
  { code: ACC.fx, test: /koersverschil|exchange (rate )?differences?/, type: "P" },
];

const BANK = /\b(bank|abn|amro|ing|rabo(bank)?|knab|bunq|triodos|sns|asn|revolut|wise|kbc|belfius)\b/;
const NOT_BANK = /kosten|charges|costs|fees|rente|interest|lening|loan|tussen|kruisposten|transit/;

export function guessType(a: XafAccount, balance: number): AccountType {
  const d = norm(a.desc);
  if (a.type === "P") {
    if (/omzet|opbrengst|revenue|sales|turnover|income|verkopen|ontvangen rente/.test(d) || /^8/.test(a.id)) return "REVENUE";
    return "COST";
  }
  if (/vermogen|kapitaal|reserve|resultaat|\bprive\b|equity|capital|retained|winst/.test(d)) return "EQUITY";
  if (/crediteur|te betalen|af te dragen|schuld|payable|vooruitontvangen|vooruitbetaalde verkoop|accrued|liabilit|lening o\/g/.test(d)) return "LIABILITY";
  if (/gebouw|terrein|inventaris|apparatuur|vervoermiddel|machine|installatie|voorraad|vordering|te ontvangen|te vorderen|debiteur|\bkas\b|waarborg|building|equipment|vehicle|inventory|stock|receivable|\bcash\b|deposit|prepaid/.test(d)) return "ASSET";
  return balance < 0 ? "LIABILITY" : "ASSET";
}

/** Journals that only repeat what Liquid Ledger derives itself (period result postings) are left out by default. */
export function defaultIncluded(j: XafJournal): boolean {
  return !/resultaat|result|afsluit|closing|year.?end|jaarafsluiting|winstverdeling/i.test(j.desc);
}

export function suggestMapping(file: XafFile, chart: ChartAccount[]): MappingRow[] {
  const usage = accountUsage(file);
  const usedIn = new Map<string, Set<string>>();
  const mark = (acc: string, where: string) => (usedIn.get(acc) ?? usedIn.set(acc, new Set()).get(acc)!).add(where);
  for (const l of file.opening?.lines ?? []) mark(l.account, "opening");
  for (const j of file.journals) for (const t of j.transactions) for (const l of t.lines) mark(l.account, j.id);
  const byCode = new Map(chart.map((c) => [c.code, c]));
  const fileAcc = new Map(file.accounts.map((a) => [a.id, a]));
  // Only accounts that carry an amount need a home.
  const used = [...usage.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const rows: MappingRow[] = [];
  const taken = new Set(chart.map((c) => c.code));
  const pending: { row: MappingRow; wanted: string }[] = [];

  // The busiest balance account that looks like a bank account becomes the main bank account.
  let bankId = "";
  let bankLines = -1;
  for (const id of used) {
    const a = fileAcc.get(id);
    if (!a || a.type === "P") continue;
    const d = norm(a.desc);
    if (BANK.test(d) && !NOT_BANK.test(d) && usage.get(id)!.lines > bankLines) {
      bankId = id;
      bankLines = usage.get(id)!.lines;
    }
  }

  for (const id of used) {
    const a = fileAcc.get(id) ?? { id, desc: id, type: "" as const, leadCode: "", leadDescription: "" };
    const u = usage.get(id)!;
    const d = norm(a.desc);
    const base = { accId: id, desc: a.desc, xafType: a.type, lines: u.lines, balance: u.balance, usedIn: [...usedIn.get(id)!] };
    let control = id === bankId ? ACC.bank : CONTROL.find((c) => (!c.type || !a.type || c.type === a.type) && c.test.test(d))?.code;
    if (control && !byCode.has(control)) control = undefined;
    if (control) {
      const c = byCode.get(control)!;
      rows.push({ ...base, target: { code: c.code, create: false, name: c.nameNl, type: c.type }, reason: "control" });
      continue;
    }
    const same = byCode.get(id);
    if (same && (norm(same.nameNl) === d || norm(same.nameEn) === d)) {
      rows.push({ ...base, target: { code: same.code, create: false, name: same.nameNl, type: same.type }, reason: "same" });
      continue;
    }
    const row: MappingRow = { ...base, target: { code: "", create: true, name: a.desc.slice(0, 120), type: guessType(a, u.balance) }, reason: "new" };
    rows.push(row);
    const digits = id.replace(/\D/g, "");
    const wanted = ACCOUNT_CODE.test(id) ? id : digits.length >= 1 && digits.length <= 6 ? digits.padEnd(4, "0") : "9000";
    if (wanted === id && !taken.has(id)) {
      taken.add(id);
      row.target.code = id;
    } else pending.push({ row, wanted });
  }

  // Second pass so renumbered accounts never take a code another file account keeps.
  for (const { row, wanted } of pending) {
    row.target.code = nextFree(wanted, taken);
    row.reason = "renumbered";
    taken.add(row.target.code);
  }
  return rows;
}

export function nextFree(wanted: string, taken: Set<string>): string {
  if (!taken.has(wanted)) return wanted;
  const width = wanted.length;
  const start = Number(wanted);
  for (let n = start + 1; n < 10 ** width; n++) {
    const c = String(n).padStart(width, "0");
    if (!taken.has(c)) return c;
  }
  // Every code of this width is used: go one digit longer.
  return nextFree(wanted + "0", taken);
}
