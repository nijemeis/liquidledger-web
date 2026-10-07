import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { BankTransaction } from "@prisma/client";
import type { Tx } from "./types";
import { ACC, accountName } from "./chart";
import { post, PostingError } from "./ledger";
import { registerPurchasePayment } from "./purchases";
import { registerSalesPayment } from "./sales";
import { STANDARD_RATE, VAT } from "./vat";

// Bank reconciliation (DOMAIN_AND_DATA.md §8). Matching runs in this order:
//  1. exact amount + reference to an open invoice
//  2. booking rules
//  3. history ("booked the same way N times")
//  4. partial payments

/**
 * Why a suggestion was made, for translated UI text. `label`/`reason` stay as
 * English fallbacks (logs, scripts); screens render from `code` + fields.
 */
export type ReasonCode = "exactRef" | "exactAmount" | "partial" | "customs" | "receipt" | "claim" | "rule" | "ruleN" | "history";

type SuggestionMeta = { code?: ReasonCode; n?: number; who?: string; number?: string | null };

export type Suggestion = SuggestionMeta &
  (
    | { kind: "sales"; invoiceId: string; label: string; reason: string; amountCents: number; partial?: number; icon: "Receipt" }
    | { kind: "purchase"; invoiceId: string; label: string; reason: string; amountCents: number; icon: "Receipt" }
    | { kind: "ledger"; account: string; vatRateBp: number; label: string; reason: string; icon: "MagicWand" | "Anchor" | "Users"; ruleId?: string }
    | { kind: "receipt"; receiptId: string; label: string; reason: string; icon: "Wallet" }
  );

/** The reconcile choice that accepts a suggestion as-is. */
export function choiceFor(s: Suggestion): ReconcileChoice {
  switch (s.kind) {
    case "sales":
    case "purchase":
      return { kind: s.kind, invoiceId: s.invoiceId };
    case "receipt":
      return { kind: "receipt", receiptId: s.receiptId };
    case "ledger":
      return { kind: "ledger", account: s.account, vatRateBp: s.vatRateBp };
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function refMatches(text: string, number: string | null) {
  if (!number) return false;
  const t = norm(text);
  const n = norm(number);
  if (t.includes(n)) return true;
  // "Factuur 0418" style: last numeric block of the invoice number.
  const tail = number.match(/(\d+)$/)?.[1];
  return Boolean(tail && tail.length >= 3 && new RegExp(`(^|\\D)0*${Number(tail)}(\\D|$)`).test(text.replace(/\s/g, " ")));
}

export async function suggestionsFor(tx: Tx, administrationId: string, txs: BankTransaction[]): Promise<Map<string, Suggestion | null>> {
  const [openSales, openPurch, rules, history, accounts] = await Promise.all([
    tx.salesInvoice.findMany({ where: { administrationId, status: "OPEN" } }),
    tx.purchaseInvoice.findMany({ where: { administrationId, status: "BOOKED" } }),
    tx.bookingRule.findMany({ where: { administrationId } }),
    tx.bankTransaction.findMany({
      where: { administrationId, status: "RECONCILED", matchType: "ledger" },
      select: { counterparty: true, matchId: true },
    }),
    tx.ledgerAccount.findMany({ where: { administrationId }, select: { code: true, nameEn: true, nameNl: true } }),
  ]);
  const bankReceipts = await tx.receipt.findMany({ where: { administrationId, status: "BOOKED", paidBy: "BANK" }, select: { id: true, amountCents: true, supplier: true } });
  const linked = await tx.bankTransaction.findMany({ where: { administrationId, matchType: "receipt" }, select: { matchId: true } });
  const linkedReceipts = new Set(linked.map((l) => l.matchId!));
  const paidClaims = await tx.receipt.findMany({ where: { administrationId, paidBy: "OWN", claimPaidAt: { not: null } }, select: { employeeName: true, amountCents: true, claimPaidAt: true } });
  const claimMap = new Map<string, number>();
  for (const c of paidClaims) {
    const k = `${c.employeeName}|${c.claimPaidAt!.toISOString().slice(0, 10)}`;
    claimMap.set(k, (claimMap.get(k) ?? 0) + c.amountCents);
  }
  const claimTotals = [...claimMap].map(([k, cents]) => ({ name: k.split("|")[0]!, cents }));
  const customers = await tx.relation.findMany({ where: { administrationId, id: { in: openSales.map((s) => s.customerId) } }, select: { id: true, name: true } });
  const custName = new Map(customers.map((c) => [c.id, c.name]));
  const accName = new Map(accounts.map((a) => [a.code, a.nameEn]));
  const out = new Map<string, Suggestion | null>();

  for (const t of txs) {
    const text = `${t.description} ${t.counterparty}`;
    let s: Suggestion | null = null;
    if (t.amountCents > 0) {
      const outstanding = (i: (typeof openSales)[number]) => i.totalCents - i.paidCents;
      const byRef = openSales.filter((i) => refMatches(text, i.number));
      const exact = byRef.find((i) => outstanding(i) === t.amountCents);
      if (exact) s = { kind: "sales", invoiceId: exact.id, label: `Sales invoice ${exact.number}`, reason: "Exact amount and reference", amountCents: t.amountCents, icon: "Receipt", code: "exactRef", number: exact.number };
      if (!s) {
        const amt = openSales.filter((i) => outstanding(i) === t.amountCents);
        const sameName = amt.find((i) => norm(custName.get(i.customerId) ?? "") === norm(t.counterparty)) ?? (amt.length === 1 ? amt[0] : undefined);
        if (sameName) s = { kind: "sales", invoiceId: sameName.id, label: `Sales invoice ${sameName.number}`, reason: "Exact amount", amountCents: t.amountCents, icon: "Receipt", code: "exactAmount", number: sameName.number };
      }
      if (!s && byRef.length === 1 && t.amountCents < outstanding(byRef[0]!)) {
        const i = byRef[0]!;
        s = { kind: "sales", invoiceId: i.id, label: `Part-payment ${i.number}`, reason: `€${((outstanding(i) - t.amountCents) / 100).toFixed(2)} will stay open`, amountCents: t.amountCents, partial: outstanding(i) - t.amountCents, icon: "Receipt", code: "partial", number: i.number };
      }
    } else {
      const amount = -t.amountCents;
      const outstanding = (i: (typeof openPurch)[number]) => i.totalCents - i.paidCents;
      const byRef = openPurch.find((i) => refMatches(text, i.number) && outstanding(i) === amount);
      const byAmt = byRef ?? openPurch.find((i) => outstanding(i) === amount && norm(i.supplierName).slice(0, 6) === norm(t.counterparty).slice(0, 6));
      if (byAmt) s = { kind: "purchase", invoiceId: byAmt.id, label: `Purchase invoice ${byAmt.number}`, reason: byRef ? "Exact amount and reference" : "Exact amount", amountCents: amount, icon: "Receipt", code: byRef ? "exactRef" : "exactAmount", number: byAmt.number };
      if (!s) {
        const mrn = text.match(/\bMRN\s*([0-9A-Z]{18})\b/i);
        if (mrn) s = { kind: "ledger", account: "4310", vatRateBp: 0, label: `4310 ${accName.get("4310") ?? "Import duties"}`, reason: "Customs reference found", icon: "Anchor", code: "customs" };
      }
      if (!s) {
        const r = bankReceipts.find((x) => x.amountCents === amount && !linkedReceipts.has(x.id));
        if (r) {
          linkedReceipts.add(r.id);
          s = { kind: "receipt", receiptId: r.id, label: `Receipt · ${r.supplier}`, reason: "Already booked · same amount", icon: "Wallet", code: "receipt", who: r.supplier };
        }
      }
      if (!s) {
        const claim = claimTotals.find((c) => c.cents === amount);
        if (claim) s = { kind: "ledger", account: ACC.claims, vatRateBp: 0, label: `${ACC.claims} ${accName.get(ACC.claims) ?? "Expense claims"} · ${claim.name}`, reason: "Matches a paid-out expense claim", icon: "Users", code: "claim", who: claim.name };
      }
    }
    if (!s) {
      const rule = rules.find((r) => {
        const p = r.pattern.toLowerCase();
        if (r.matchType === "iban") return Boolean(t.counterpartyIban && norm(t.counterpartyIban) === norm(r.pattern));
        if (r.matchType === "description") return t.description.toLowerCase().includes(p);
        return t.counterparty.toLowerCase().includes(p);
      });
      if (rule?.accountCode) {
        s = {
          kind: "ledger",
          account: rule.accountCode,
          vatRateBp: rule.vatRateBp ?? 0,
          label: `${rule.accountCode} ${accName.get(rule.accountCode) ?? ""}${rule.vatRateBp ? ` · ${rule.vatRateBp / 100}% VAT` : ""}`,
          reason: rule.timesUsed > 1 ? `Rule: booked the same way ${rule.timesUsed} times` : "Rule",
          icon: "MagicWand",
          ruleId: rule.id,
          code: rule.timesUsed > 1 ? "ruleN" : "rule",
          n: rule.timesUsed,
        };
      }
    }
    if (!s) {
      const same = history.filter((h) => norm(h.counterparty) === norm(t.counterparty) && h.matchId);
      if (same.length) {
        const counts = new Map<string, number>();
        for (const h of same) counts.set(h.matchId!, (counts.get(h.matchId!) ?? 0) + 1);
        const [account, n] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
        s = { kind: "ledger", account, vatRateBp: 0, label: `${account} ${accName.get(account) ?? ""}`, reason: `Booked the same way ${n} time${n === 1 ? "" : "s"}`, icon: "MagicWand", code: "history", n };
      }
    }
    out.set(t.id, s);
  }
  return out;
}

export interface ReconcileChoice {
  kind: "sales" | "purchase" | "ledger" | "receipt";
  invoiceId?: string;
  receiptId?: string;
  account?: string;
  vatRateBp?: number;
  remember?: boolean; // create a booking rule for this counterparty (ledger only)
}

export async function reconcile(tx: Tx, input: { administrationId: string; txId: string; choice: ReconcileChoice; userId?: string | null }) {
  const t = await tx.bankTransaction.findUniqueOrThrow({ where: { id: input.txId }, include: { bankAccount: true } });
  if (t.status === "RECONCILED") throw new PostingError("Already reconciled.");
  const base = await tx.administration.findUniqueOrThrow({ where: { id: input.administrationId }, select: { baseCurrency: true } });
  if (t.bankAccount.currency !== base.baseCurrency) {
    throw new PostingError(`Reconciling ${t.bankAccount.currency} accounts isn't supported yet. Book these lines with a journal entry for now.`);
  }
  const bankCode = t.bankAccount.accountCode;
  const amount = Math.abs(t.amountCents);
  let entryId: string;
  let label: string;
  let matchId: string;
  const c = input.choice;
  if (c.kind === "sales") {
    if (t.amountCents <= 0) throw new PostingError("Only incoming payments can settle a sales invoice.");
    const r = await registerSalesPayment(tx, { administrationId: input.administrationId, invoiceId: c.invoiceId!, amountCents: amount, date: t.date, bankAccountCode: bankCode, userId: input.userId, sourceId: t.id });
    const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: c.invoiceId! } });
    entryId = r.entry.id;
    label = `${r.full ? "Sales invoice" : "Part-payment"} ${inv.number}`;
    matchId = inv.id;
  } else if (c.kind === "purchase") {
    if (t.amountCents >= 0) throw new PostingError("Only outgoing payments can settle a purchase invoice.");
    const r = await registerPurchasePayment(tx, { administrationId: input.administrationId, invoiceId: c.invoiceId!, amountCents: amount, date: t.date, bankAccountCode: bankCode, userId: input.userId, sourceId: t.id });
    const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: c.invoiceId! } });
    entryId = r.entry.id;
    label = `Purchase invoice ${inv.number}`;
    matchId = inv.id;
  } else if (c.kind === "receipt") {
    // The receipt was booked against the bank already: link, don't post again.
    const r = await tx.receipt.findUniqueOrThrow({ where: { id: c.receiptId! } });
    if (r.status !== "BOOKED" || !r.journalEntryId) throw new PostingError("Book the receipt first.");
    if (r.paidBy !== "BANK") throw new PostingError("That receipt wasn't paid by bank transfer.");
    entryId = r.journalEntryId;
    label = `Receipt · ${r.supplier}`;
    matchId = r.id;
  } else {
    const account = c.account;
    if (!account) throw new PostingError("Choose a ledger account.");
    if (account === bankCode) throw new PostingError("Pick another account than the bank account itself.");
    const rate = c.vatRateBp ?? 0;
    const lines: Parameters<typeof post>[1]["lines"] = [];
    if (t.amountCents < 0) {
      const net = rate ? Math.round((amount * 10_000) / (10_000 + rate)) : amount;
      lines.push({ account, debit: net }, ...(rate ? [{ account: ACC.vatReclaim, debit: amount - net, vatCode: VAT.INPUT }] : []), { account: bankCode, credit: amount });
    } else {
      // Incoming with VAT (e.g. a refund or a small cash sale): net to the account, VAT payable.
      const net = rate ? Math.round((amount * 10_000) / (10_000 + rate)) : amount;
      const admin = rate ? await tx.administration.findUniqueOrThrow({ where: { id: input.administrationId }, select: { country: true } }) : null;
      const code = rate ? (rate >= (STANDARD_RATE[admin!.country] ?? 2100) ? VAT.SALES_HIGH : VAT.SALES_LOW) : null;
      lines.push(
        { account: bankCode, debit: amount },
        { account, credit: net },
        ...(rate ? [{ account: ACC.vatPayable, credit: amount - net, vatCode: code, vatBase: net }] : []),
      );
    }
    const e = await post(tx, {
      administrationId: input.administrationId,
      date: t.date,
      title: `${t.counterparty} · ${t.description}`.slice(0, 180),
      source: "BANK",
      sourceId: t.id,
      createdById: input.userId,
      lines,
    });
    entryId = e.id;
    const [acc, lang] = await Promise.all([
      tx.ledgerAccount.findFirst({ where: { administrationId: input.administrationId, code: account } }),
      tx.administration.findUniqueOrThrow({ where: { id: input.administrationId }, select: { ledgerLanguage: true } }),
    ]);
    label = `${account} ${acc ? accountName(acc, lang.ledgerLanguage) : ""}${rate ? ` · ${rate / 100}% VAT` : ""}`;
    matchId = account;
    const rule = await tx.bookingRule.findFirst({
      where: { administrationId: input.administrationId, matchType: "supplier", pattern: { equals: t.counterparty, mode: "insensitive" }, accountCode: account },
    });
    if (rule) await tx.bookingRule.update({ where: { id: rule.id }, data: { timesUsed: { increment: 1 } } });
    else if (c.remember) {
      await tx.bookingRule.create({
        data: { administrationId: input.administrationId, matchType: "supplier", pattern: t.counterparty, accountCode: account, vatRateBp: rate, timesUsed: 1, createdById: input.userId ?? null },
      });
    }
  }
  return tx.bankTransaction.update({
    where: { id: t.id },
    data: { status: "RECONCILED", matchType: c.kind, matchId, matchLabel: label, journalEntryId: entryId, reconciledAt: new Date() },
  });
}

// ── Statement import ────────────────────────────────────────────────────────

export interface ParsedTx {
  date: Date;
  amountCents: number;
  counterparty: string;
  counterpartyIban?: string;
  description: string;
  ref?: string;
}

export function importHash(t: ParsedTx): string {
  return createHash("sha256")
    .update([t.date.toISOString().slice(0, 10), t.amountCents, t.counterparty, t.description, t.ref ?? ""].join("|"))
    .digest("hex")
    .slice(0, 40);
}

/** ISO 20022 CAMT.053 bank statement (exported by ING, Rabobank, ABN AMRO, …). */
export function parseCamt053(xml: string): { iban?: string; currency?: string; txs: ParsedTx[] } {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, isArray: (name) => ["Stmt", "Ntry", "NtryDtls", "TxDtls", "Ustrd"].includes(name) });
  const doc = parser.parse(xml);
  const stmts = doc?.Document?.BkToCstmrStmt?.Stmt ?? [];
  const txs: ParsedTx[] = [];
  let iban: string | undefined;
  let currency: string | undefined;
  for (const st of stmts) {
    iban ??= st?.Acct?.Id?.IBAN;
    currency ??= st?.Acct?.Ccy;
    for (const n of st.Ntry ?? []) {
      const amt = n.Amt;
      const value = typeof amt === "object" ? Number(amt["#text"]) : Number(amt);
      const sign = n.CdtDbtInd === "DBIT" ? -1 : 1;
      const date = new Date((n.BookgDt?.Dt ?? n.ValDt?.Dt ?? n.BookgDt?.DtTm ?? "").slice(0, 10) + "T00:00:00Z");
      const det = n.NtryDtls?.[0]?.TxDtls?.[0];
      const parties = det?.RltdPties ?? {};
      const cp = sign > 0 ? parties.Dbtr : parties.Cdtr;
      const cpAcct = sign > 0 ? parties.DbtrAcct : parties.CdtrAcct;
      const ustrd = det?.RmtInf?.Ustrd?.join(" ") ?? n.AddtlNtryInf ?? "";
      const strd = det?.RmtInf?.Strd?.CdtrRefInf?.Ref;
      txs.push({
        date,
        amountCents: Math.round(value * 100) * sign,
        counterparty: String(cp?.Nm ?? cp?.Pty?.Nm ?? n.AddtlNtryInf ?? "Unknown").slice(0, 140),
        counterpartyIban: cpAcct?.Id?.IBAN,
        description: String(strd ? `${strd} ${ustrd}` : ustrd || "—").trim().slice(0, 300),
        ref: det?.Refs?.EndToEndId ?? n.AcctSvcrRef,
      });
    }
  }
  return { iban, currency, txs };
}

/**
 * Simple CSV: date, amount, counterparty, description[, iban]. Accepts
 * comma or semicolon separators and either decimal mark.
 */
export function parseCsv(text: string): ParsedTx[] {
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
      ? new Date(`${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}T00:00:00Z`)
      : /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(rawDate)
        ? (() => {
            const [dd, mm, yy] = rawDate.split(/[-/.]/);
            return new Date(`${yy}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}T00:00:00Z`);
          })()
        : new Date(rawDate.slice(0, 10) + "T00:00:00Z");
    let a = (c[iAmt] ?? "").replace(/[€\s]/g, "");
    if (a.lastIndexOf(",") > a.lastIndexOf(".")) a = a.replace(/\./g, "").replace(",", ".");
    else a = a.replace(/,/g, "");
    const amount = Math.round(Number(a) * 100);
    if (Number.isNaN(d.getTime()) || !Number.isFinite(amount)) continue;
    out.push({ date: d, amountCents: amount, counterparty: (c[iName] || "Unknown").slice(0, 140), description: (c[iDesc] || "—").slice(0, 300), counterpartyIban: c[iIban] || undefined });
  }
  return out;
}

export async function importTransactions(tx: Tx, input: { administrationId: string; bankAccountId: string; txs: ParsedTx[] }) {
  let added = 0;
  for (const t of input.txs) {
    const hash = importHash(t);
    const res = await tx.bankTransaction.createMany({
      data: [{
        administrationId: input.administrationId,
        bankAccountId: input.bankAccountId,
        date: t.date,
        amountCents: t.amountCents,
        counterparty: t.counterparty,
        counterpartyIban: t.counterpartyIban ?? null,
        description: t.description,
        importHash: hash,
      }],
      skipDuplicates: true,
    });
    added += res.count;
  }
  await tx.bankAccount.update({ where: { id: input.bankAccountId }, data: { lastSyncedAt: new Date() } });
  return { added, skipped: input.txs.length - added };
}

/** Statement balance: opening balance plus every imported line. */
export async function accountBalances(tx: Tx, administrationId: string) {
  const accounts = await tx.bankAccount.findMany({ where: { administrationId, archivedAt: null }, orderBy: { createdAt: "asc" } });
  const sums = await tx.bankTransaction.groupBy({ by: ["bankAccountId"], where: { administrationId }, _sum: { amountCents: true } });
  const open = await tx.bankTransaction.groupBy({ by: ["bankAccountId"], where: { administrationId, status: "UNRECONCILED" }, _count: true });
  return accounts.map((a) => ({
    ...a,
    balanceCents: a.openingBalanceCents + (sums.find((s) => s.bankAccountId === a.id)?._sum.amountCents ?? 0),
    toReconcile: open.find((o) => o.bankAccountId === a.id)?._count ?? 0,
  }));
}

// ── IBAN & SEPA ──────────────────────────────────────────────────────────────

export const compactIban = (iban: string) => iban.replace(/\s+/g, "").toUpperCase();

/** ISO 13616 check (mod 97). */
export function isValidIban(iban: string): boolean {
  const s = compactIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

export interface SepaPayment {
  endToEndId: string; // e.g. the supplier's invoice number
  amountCents: number;
  creditorName: string;
  creditorIban: string;
  remittance: string;
}

const xmlEsc = (s: string) =>
  s
    // SEPA basic Latin character set; anything else becomes a space.
    .replace(/&/g, "+")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const amt = (cents: number) => (cents / 100).toFixed(2);

/** SEPA credit transfer initiation, ISO 20022 pain.001.001.03. */
export function buildPain001(input: {
  messageId: string;
  createdAt: Date;
  executionDate: Date;
  debtorName: string;
  debtorIban: string;
  debtorBic?: string | null;
  payments: SepaPayment[];
}): string {
  const total = input.payments.reduce((a, p) => a + p.amountCents, 0);
  const n = input.payments.length;
  const dbtrAgt = input.debtorBic
    ? `<FinInstnId><BIC>${xmlEsc(input.debtorBic)}</BIC></FinInstnId>`
    : `<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>`;
  const txs = input.payments
    .map(
      (p) => `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${xmlEsc(p.endToEndId).slice(0, 35) || "NOTPROVIDED"}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${amt(p.amountCents)}</InstdAmt></Amt>
        <Cdtr><Nm>${xmlEsc(p.creditorName).slice(0, 70)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${compactIban(p.creditorIban)}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${xmlEsc(p.remittance).slice(0, 140)}</Ustrd></RmtInf>
      </CdtTrfTxInf>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xmlEsc(input.messageId).slice(0, 35)}</MsgId>
      <CreDtTm>${input.createdAt.toISOString().slice(0, 19)}</CreDtTm>
      <NbOfTxs>${n}</NbOfTxs>
      <CtrlSum>${amt(total)}</CtrlSum>
      <InitgPty><Nm>${xmlEsc(input.debtorName).slice(0, 70)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${xmlEsc(input.messageId).slice(0, 31)}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${n}</NbOfTxs>
      <CtrlSum>${amt(total)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${input.executionDate.toISOString().slice(0, 10)}</ReqdExctnDt>
      <Dbtr><Nm>${xmlEsc(input.debtorName).slice(0, 70)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${compactIban(input.debtorIban)}</IBAN></Id><Ccy>EUR</Ccy></DbtrAcct>
      <DbtrAgt>${dbtrAgt}</DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${txs}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}

/**
 * Booked purchase invoices to pay now: due within `days` days (or overdue) or
 * with a scheduled payment. Splits them into payable by SEPA and skipped
 * (no supplier IBAN, invalid IBAN, or not in euro).
 */
export async function sepaCandidates(tx: Tx, administrationId: string, today: Date, days = 7) {
  const until = new Date(today.getTime() + days * 86400_000);
  const invoices = await tx.purchaseInvoice.findMany({
    where: {
      administrationId,
      status: "BOOKED",
      OR: [{ dueDate: { lte: until } }, { paymentScheduledAt: { not: null } }],
    },
    orderBy: [{ dueDate: "asc" }],
  });
  const suppliers = await tx.relation.findMany({
    where: { administrationId, id: { in: invoices.map((i) => i.supplierId).filter((x): x is string => Boolean(x)) } },
    select: { id: true, name: true, iban: true },
  });
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const pay: { invoice: (typeof invoices)[number]; amountCents: number; iban: string; name: string }[] = [];
  const skipped: { invoice: (typeof invoices)[number]; reason: "noIban" | "badIban" | "currency" }[] = [];
  for (const inv of invoices) {
    const outstanding = inv.totalCents - inv.paidCents;
    if (outstanding <= 0) continue;
    const sup = inv.supplierId ? byId.get(inv.supplierId) : undefined;
    if (inv.currency !== "EUR") skipped.push({ invoice: inv, reason: "currency" });
    else if (!sup?.iban) skipped.push({ invoice: inv, reason: "noIban" });
    else if (!isValidIban(sup.iban)) skipped.push({ invoice: inv, reason: "badIban" });
    else pay.push({ invoice: inv, amountCents: outstanding, iban: compactIban(sup.iban), name: sup.name });
  }
  return { pay, skipped };
}
