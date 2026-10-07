import type { AccountType } from "@prisma/client";
import type { Tx } from "./types";
import { balances } from "./ledger";

// Profit & loss and balance sheet straight from the journal. Excise is a
// pass-through (payable/prepaid accounts) and therefore never in revenue.

export async function chartWithBalances(tx: Tx, administrationId: string, opts: { to?: Date; from?: Date } = {}) {
  const [accounts, bal] = await Promise.all([
    tx.ledgerAccount.findMany({ where: { administrationId }, orderBy: { code: "asc" } }),
    balances(tx, administrationId, opts),
  ]);
  return accounts.map((a) => ({ ...a, balanceCents: bal.get(a.code) ?? 0 }));
}

export interface PnlLine {
  key: string;
  label: { en: string; nl: string };
  cur: number;
  prev: number;
  ytd: number;
  level: 0 | 1 | 2; // 1 = subtotal, 2 = result
}

const GROUPS: { key: string; label: { en: string; nl: string }; codes: (c: string) => boolean }[] = [
  { key: "freight", label: { en: "Freight & customs", nl: "Vracht & douane" }, codes: (c) => c === "4300" || c === "4310" },
  { key: "warehousing", label: { en: "Warehousing", nl: "Opslag" }, codes: (c) => c === "4400" },
  { key: "wages", label: { en: "Wages & salaries", nl: "Lonen & salarissen" }, codes: (c) => ["4000", "4010", "4020"].includes(c) },
];

/** P&L for a month vs the month before, plus year to date. Revenue positive, costs negative. */
export async function profitAndLoss(tx: Tx, administrationId: string, month: Date, fiscalYearStart = 1) {
  const y = month.getUTCFullYear();
  const m = month.getUTCMonth();
  const curFrom = new Date(Date.UTC(y, m, 1));
  const curTo = new Date(Date.UTC(y, m + 1, 0));
  const prevFrom = new Date(Date.UTC(y, m - 1, 1));
  const prevTo = new Date(Date.UTC(y, m, 0));
  const fyStartMonth = fiscalYearStart - 1;
  const ytdFrom = new Date(Date.UTC(m >= fyStartMonth ? y : y - 1, fyStartMonth, 1));
  const accounts = await tx.ledgerAccount.findMany({ where: { administrationId, type: { in: ["REVENUE", "COST"] } } });
  const types = new Map(accounts.map((a) => [a.code, a.type as AccountType]));
  const [cur, prev, ytd] = await Promise.all([
    balances(tx, administrationId, { from: curFrom, to: curTo }),
    balances(tx, administrationId, { from: prevFrom, to: prevTo }),
    balances(tx, administrationId, { from: ytdFrom, to: curTo }),
  ]);
  // Sign: revenue = credit − debit (positive), cost = −(debit − credit) (negative).
  const val = (map: Map<string, number>, pred: (code: string, t: AccountType) => boolean) => {
    let s = 0;
    for (const [code, b] of map) {
      const t = types.get(code);
      if (t && pred(code, t)) s += -b;
    }
    return s;
  };
  const line = (key: string, label: PnlLine["label"], pred: (code: string, t: AccountType) => boolean, level: PnlLine["level"] = 0): PnlLine => ({
    key,
    label,
    cur: val(cur, pred),
    prev: val(prev, pred),
    ytd: val(ytd, pred),
    level,
  });
  const revenue = line("revenue", { en: "Revenue (excl. excise)", nl: "Omzet (excl. accijns)" }, (_, t) => t === "REVENUE", 1);
  const cogs = line("cogs", { en: "Cost of goods sold", nl: "Kostprijs omzet" }, (c) => c.startsWith("70"));
  const gross: PnlLine = { key: "gross", label: { en: "Gross margin", nl: "Brutomarge" }, cur: revenue.cur + cogs.cur, prev: revenue.prev + cogs.prev, ytd: revenue.ytd + cogs.ytd, level: 1 };
  const groups = GROUPS.map((g) => line(g.key, g.label, (c, t) => t === "COST" && g.codes(c)));
  const other = line("other", { en: "Other costs", nl: "Overige kosten" }, (c, t) => t === "COST" && !c.startsWith("70") && !GROUPS.some((g) => g.codes(c)));
  const profit: PnlLine = {
    key: "profit",
    label: { en: "Profit before tax", nl: "Resultaat voor belasting" },
    cur: gross.cur + groups.reduce((a, g) => a + g.cur, 0) + other.cur,
    prev: gross.prev + groups.reduce((a, g) => a + g.prev, 0) + other.prev,
    ytd: gross.ytd + groups.reduce((a, g) => a + g.ytd, 0) + other.ytd,
    level: 2,
  };
  return { month: curFrom, prevMonth: prevFrom, lines: [revenue, cogs, gross, ...groups, other, profit] };
}

export async function balanceSheet(tx: Tx, administrationId: string, at: Date) {
  const chart = await chartWithBalances(tx, administrationId, { to: at });
  const bankCodes = (await tx.bankAccount.findMany({ where: { administrationId } })).map((b) => b.accountCode);
  const sum = (pred: (a: (typeof chart)[number]) => boolean) => chart.filter(pred).reduce((s, a) => s + a.balanceCents, 0);
  const assets = [
    { key: "bank", label: { en: "Bank & cash", nl: "Bank & kas" }, cents: sum((a) => bankCodes.includes(a.code) || a.code.startsWith("10")) },
    { key: "receivables", label: { en: "Accounts receivable", nl: "Debiteuren" }, cents: sum((a) => a.code === "1300") },
    { key: "stock", label: { en: "Stock (bonded, duty paid, in transit)", nl: "Voorraad (douaneverband, vrij verkeer, onderweg)" }, cents: sum((a) => a.code.startsWith("30")) },
    { key: "other", label: { en: "Prepaid & other", nl: "Vooruitbetaald & overig" }, cents: sum((a) => a.type === "ASSET" && !bankCodes.includes(a.code) && !a.code.startsWith("10") && a.code !== "1300" && !a.code.startsWith("30")) },
  ];
  const profit = -sum((a) => a.type === "REVENUE" || a.type === "COST");
  const liabilities = [
    { key: "equity", label: { en: "Equity", nl: "Eigen vermogen" }, cents: -sum((a) => a.type === "EQUITY") },
    { key: "profit", label: { en: "Profit this year", nl: "Resultaat boekjaar" }, cents: profit },
    { key: "payables", label: { en: "Accounts payable", nl: "Crediteuren" }, cents: -sum((a) => a.code === "1600") },
    { key: "taxes", label: { en: "VAT & excise payable", nl: "Te betalen btw & accijns" }, cents: -sum((a) => ["1700", "1710", "1750"].includes(a.code)) },
    { key: "otherLiab", label: { en: "Other liabilities", nl: "Overige schulden" }, cents: -sum((a) => a.type === "LIABILITY" && !["1600", "1700", "1710", "1750"].includes(a.code)) },
  ];
  // VAT to reclaim (1810) sits in assets; net it against VAT payable for presentation.
  return {
    assets,
    liabilities,
    totalAssets: assets.reduce((a, r) => a + r.cents, 0),
    totalLiabilities: liabilities.reduce((a, r) => a + r.cents, 0),
  };
}

/** Cash in and out per month for the dashboard chart (bank accounts only). */
export async function cashFlow(tx: Tx, administrationId: string, months: number, today: Date) {
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months + 1, 1));
  const rows = await tx.bankTransaction.findMany({ where: { administrationId, date: { gte: from } }, select: { date: true, amountCents: true } });
  const out: { month: Date; inCents: number; outCents: number }[] = [];
  for (let i = 0; i < months; i++) out.push({ month: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1)), inCents: 0, outCents: 0 });
  for (const r of rows) {
    const idx = (r.date.getUTCFullYear() - from.getUTCFullYear()) * 12 + r.date.getUTCMonth() - from.getUTCMonth();
    const b = out[idx];
    if (!b) continue;
    if (r.amountCents > 0) b.inCents += r.amountCents;
    else b.outCents += -r.amountCents;
  }
  return out;
}
