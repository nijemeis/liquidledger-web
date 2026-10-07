"use server";
import { z } from "zod";
import { appAction, auditApp, type AppContext } from "@/lib/app-context";
import type { Tx } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import {
  choiceFor,
  compactIban,
  importTransactions,
  isValidIban,
  parseCamt053,
  parseCsv,
  reconcile,
  sepaCandidates,
  suggestionsFor,
  type ReconcileChoice,
} from "@/lib/domain/bank";
import { accountName, ACC } from "@/lib/domain/chart";
import { balances, post, PostingError } from "@/lib/domain/ledger";
import { parseMoney } from "@/lib/format";

const REVALIDATE = { revalidate: ["/", "layout"] };

/** Plain-language toast after a line is reconciled, naming the side effect. */
async function reconciledMessage(ctx: AppContext, tx: Tx, choice: ReconcileChoice, txId: string) {
  const { t, fmt } = await getI18n(ctx.locale);
  const A = ctx.administration.id;
  if (choice.kind === "sales" && choice.invoiceId) {
    const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: choice.invoiceId } });
    return inv.status === "PAID"
      ? t("bank.toast.salesPaid", { number: inv.number ?? "" })
      : t("bank.toast.salesPartial", { number: inv.number ?? "", amount: fmt.money(inv.totalCents - inv.paidCents) });
  }
  if (choice.kind === "purchase" && choice.invoiceId) {
    const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: choice.invoiceId } });
    return inv.status === "PAID"
      ? t("bank.toast.purchasePaid", { number: inv.number })
      : t("bank.toast.purchasePartial", { number: inv.number, amount: fmt.money(inv.totalCents - inv.paidCents) });
  }
  if (choice.kind === "receipt") {
    const bt = await tx.bankTransaction.findUniqueOrThrow({ where: { id: txId } });
    return t("bank.toast.receiptLinked", { label: bt.matchLabel ?? "" });
  }
  const acc = await tx.ledgerAccount.findFirst({ where: { administrationId: A, code: choice.account } });
  return t("bank.toast.ledger", { account: `${choice.account} ${acc ? accountName(acc, ctx.administration.ledgerLanguage) : ""}`.trim() });
}

/** Accept the suggestion for one line. The suggestion is recomputed on the server. */
export async function matchLine(txId: string) {
  return appAction(
    "bank",
    async (ctx, tx) => {
      const A = ctx.administration.id;
      const line = await tx.bankTransaction.findFirst({ where: { id: txId, administrationId: A } });
      if (!line) throw new PostingError("That bank line no longer exists.");
      if (line.status === "RECONCILED") throw new PostingError("This line is already reconciled.");
      const s = (await suggestionsFor(tx, A, [line])).get(line.id);
      if (!s) throw new PostingError("There's no suggestion for this line any more. Use Other… to choose.");
      const choice = choiceFor(s);
      const res = await reconcile(tx, { administrationId: A, txId: line.id, choice, userId: ctx.userId });
      await auditApp(ctx, "bank.reconcile", `Reconciled ${line.counterparty} ${line.amountCents / 100} → ${res.matchLabel}`, { targetType: "bank_transaction", targetId: line.id }, tx);
      return { message: await reconciledMessage(ctx, tx, choice, line.id) };
    },
    REVALIDATE,
  );
}

const otherSchema = z.object({
  txId: z.string().min(1),
  kind: z.enum(["sales", "purchase", "receipt", "ledger"]),
  invoiceId: z.string().optional(),
  receiptId: z.string().optional(),
  account: z.string().optional(),
  vatRateBp: z.union([z.literal(0), z.literal(900), z.literal(2100)]).optional(),
  remember: z.boolean().optional(),
});

/** "Other…": book a line against a chosen invoice, receipt or ledger account. */
export async function reconcileOther(input: z.infer<typeof otherSchema>) {
  return appAction(
    "bank",
    async (ctx, tx) => {
      const v = otherSchema.parse(input);
      const A = ctx.administration.id;
      const line = await tx.bankTransaction.findFirst({ where: { id: v.txId, administrationId: A } });
      if (!line) throw new PostingError("That bank line no longer exists.");
      const choice: ReconcileChoice = { kind: v.kind };
      if (v.kind === "sales" || v.kind === "purchase") {
        if (!v.invoiceId) throw new PostingError("Choose an invoice.");
        const ok =
          v.kind === "sales"
            ? await tx.salesInvoice.count({ where: { id: v.invoiceId, administrationId: A, status: "OPEN" } })
            : await tx.purchaseInvoice.count({ where: { id: v.invoiceId, administrationId: A, status: "BOOKED" } });
        if (!ok) throw new PostingError("That invoice isn't open any more.");
        choice.invoiceId = v.invoiceId;
      } else if (v.kind === "receipt") {
        if (!v.receiptId) throw new PostingError("Choose a receipt.");
        const r = await tx.receipt.count({ where: { id: v.receiptId, administrationId: A } });
        if (!r) throw new PostingError("That receipt no longer exists.");
        const linked = await tx.bankTransaction.count({ where: { administrationId: A, matchType: "receipt", matchId: v.receiptId } });
        if (linked) throw new PostingError("That receipt is already linked to another bank line.");
        choice.receiptId = v.receiptId;
      } else {
        if (!v.account) throw new PostingError("Choose a ledger account.");
        choice.account = v.account;
        choice.vatRateBp = v.vatRateBp ?? 0;
        choice.remember = v.remember ?? false;
      }
      const ruleBefore = choice.remember
        ? await tx.bookingRule.count({ where: { administrationId: A, matchType: "supplier", pattern: { equals: line.counterparty, mode: "insensitive" } } })
        : 1;
      const res = await reconcile(tx, { administrationId: A, txId: line.id, choice, userId: ctx.userId });
      await auditApp(ctx, "bank.reconcile", `Reconciled ${line.counterparty} ${line.amountCents / 100} → ${res.matchLabel}`, { targetType: "bank_transaction", targetId: line.id }, tx);
      let message = await reconciledMessage(ctx, tx, choice, line.id);
      if (choice.remember && !ruleBefore) {
        const { t } = await getI18n(ctx.locale);
        await auditApp(ctx, "rule.create", `Booking rule: ${line.counterparty} → ${choice.account}`, { targetType: "booking_rule" }, tx);
        message += " · " + t("bank.toast.ruleCreated", { name: line.counterparty });
      }
      return { message };
    },
    REVALIDATE,
  );
}

/** Book every line of an account that has a suggestion, in one transaction. */
export async function acceptAll(bankAccountId: string) {
  return appAction(
    "bank",
    async (ctx, tx) => {
      const A = ctx.administration.id;
      const { t } = await getI18n(ctx.locale);
      const lines = await tx.bankTransaction.findMany({
        where: { administrationId: A, bankAccountId, status: "UNRECONCILED" },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      });
      const sugg = await suggestionsFor(tx, A, lines);
      const usedDocs = new Set<string>();
      let booked = 0;
      let paid = 0;
      let skipped = 0;
      for (const line of lines) {
        const s = sugg.get(line.id);
        if (!s) continue;
        const choice = choiceFor(s);
        const doc = choice.invoiceId ?? choice.receiptId;
        // Two lines suggesting the same document: book the first, leave the other for a human.
        if (doc && usedDocs.has(doc)) {
          skipped++;
          continue;
        }
        if (doc) usedDocs.add(doc);
        try {
          await reconcile(tx, { administrationId: A, txId: line.id, choice, userId: ctx.userId });
        } catch (e) {
          if (e instanceof PostingError) throw new PostingError(t("bank.toast.acceptFailed", { name: line.counterparty, error: e.message }));
          throw e;
        }
        booked++;
        if (choice.kind === "sales" && choice.invoiceId) {
          const inv = await tx.salesInvoice.findUnique({ where: { id: choice.invoiceId }, select: { status: true } });
          if (inv?.status === "PAID") paid++;
        }
      }
      if (!booked) throw new PostingError(t("bank.toast.nothingToAccept"));
      await auditApp(ctx, "bank.accept_all", `Accepted ${booked} bank suggestions`, { targetType: "bank_account", targetId: bankAccountId }, tx);
      let message = t("bank.toast.acceptedAll", { n: booked });
      if (paid) message += " · " + t("bank.toast.invoicesPaid", { n: paid });
      if (skipped) message += " · " + t("bank.toast.skippedDup", { n: skipped });
      return { message };
    },
    REVALIDATE,
  );
}

const MAX_FILE = 5 * 1024 * 1024;

/** Import a CAMT.053 (XML) or CSV statement into a bank account. */
export async function importStatement(form: FormData) {
  return appAction(
    "bank",
    async (ctx, tx) => {
      const { t } = await getI18n(ctx.locale);
      const A = ctx.administration.id;
      const accountId = String(form.get("accountId") ?? "");
      const file = form.get("file");
      if (!(file instanceof File) || !file.size) throw new PostingError(t("bank.import.noFile"));
      if (file.size > MAX_FILE) throw new PostingError(t("bank.import.tooBig"));
      const account = await tx.bankAccount.findFirst({ where: { id: accountId, administrationId: A, archivedAt: null } });
      if (!account) throw new PostingError(t("bank.import.pickAccount"));
      const text = (await file.text()).replace(/^﻿/, "");
      let txs;
      if (text.trimStart().startsWith("<")) {
        let parsed;
        try {
          parsed = parseCamt053(text);
        } catch {
          throw new PostingError(t("bank.import.badXml"));
        }
        if (parsed.iban && account.iban && compactIban(parsed.iban) !== compactIban(account.iban)) {
          throw new PostingError(t("bank.import.ibanMismatch", { iban: parsed.iban, name: account.name }));
        }
        if (parsed.currency && parsed.currency !== account.currency) {
          throw new PostingError(t("bank.import.currencyMismatch", { currency: parsed.currency, name: account.name }));
        }
        txs = parsed.txs;
      } else {
        txs = parseCsv(text);
      }
      txs = txs.filter((x) => x.amountCents !== 0);
      if (!txs.length) throw new PostingError(t("bank.import.empty"));
      const res = await importTransactions(tx, { administrationId: A, bankAccountId: account.id, txs });
      await auditApp(ctx, "bank.import", `Imported ${file.name} into ${account.name}: ${res.added} new, ${res.skipped} duplicates`, { targetType: "bank_account", targetId: account.id }, tx);
      return { message: t("bank.toast.imported", { n: res.added, m: res.skipped }) };
    },
    REVALIDATE,
  );
}

const accountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  iban: z.string().trim().max(42).optional().default(""),
  currency: z.string().trim().length(3),
  mode: z.enum(["existing", "new"]),
  accountCode: z.string().trim().regex(/^10\d\d$/),
  ledgerName: z.string().trim().max(80).optional().default(""),
  openingBalance: z.string().trim().max(20).optional().default(""),
});

export async function addBankAccount(input: z.input<typeof accountSchema>) {
  return appAction(
    "bank",
    async (ctx, tx) => {
      const { t, fmt } = await getI18n(ctx.locale);
      const parsed = accountSchema.safeParse(input);
      if (!parsed.success) {
        const path = parsed.error.issues[0]?.path[0];
        throw new PostingError(path === "accountCode" ? t("bank.add.badCode") : path === "name" ? t("bank.add.needName") : t("bank.add.invalid"));
      }
      const v = parsed.data;
      const A = ctx.administration.id;
      const iban = v.iban ? compactIban(v.iban) : null;
      if (iban && !isValidIban(iban)) throw new PostingError(t("bank.add.badIban"));
      const opening = v.openingBalance ? parseMoney(v.openingBalance) : 0;
      if (opening === null) throw new PostingError(t("bank.add.badAmount"));
      const existing = await tx.bankAccount.findMany({ where: { administrationId: A, archivedAt: null } });
      if (iban && existing.some((b) => b.iban && compactIban(b.iban) === iban)) throw new PostingError(t("bank.add.dupIban"));
      const ledger = await tx.ledgerAccount.findFirst({ where: { administrationId: A, code: v.accountCode } });
      let createdLedger = false;
      if (v.mode === "new") {
        if (ledger) throw new PostingError(t("bank.add.codeTaken", { code: v.accountCode }));
        const nm = v.ledgerName || v.name;
        await tx.ledgerAccount.create({ data: { administrationId: A, code: v.accountCode, nameNl: nm, nameEn: nm, type: "ASSET" } });
        createdLedger = true;
      } else if (!ledger) {
        throw new PostingError(t("bank.add.codeMissing", { code: v.accountCode }));
      }
      const acct = await tx.bankAccount.create({
        data: {
          administrationId: A,
          name: v.name,
          iban: iban ? iban.replace(/(.{4})/g, "$1 ").trim() : null,
          currency: v.currency.toUpperCase(),
          accountCode: v.accountCode,
          provider: "manual",
          openingBalanceCents: opening,
        },
      });
      // Book the opening balance against equity when the ledger account isn't carrying money yet.
      let bookedOpening = false;
      if (opening && acct.currency === ctx.administration.baseCurrency) {
        const shared = existing.some((b) => b.accountCode === v.accountCode);
        const bal = (await balances(tx, A)).get(v.accountCode) ?? 0;
        if (!shared && bal === 0) {
          const now = new Date();
          await post(tx, {
            administrationId: A,
            date: new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
            title: `Opening balance · ${acct.name}`,
            source: "OPENING",
            sourceId: acct.id,
            createdById: ctx.userId,
            lines:
              opening > 0
                ? [{ account: v.accountCode, debit: opening }, { account: ACC.equity, credit: opening }]
                : [{ account: ACC.equity, debit: -opening }, { account: v.accountCode, credit: -opening }],
          });
          bookedOpening = true;
        }
      }
      await auditApp(ctx, "bank.account_create", `Added bank account ${acct.name}${iban ? ` (${iban})` : ""} on ${v.accountCode}`, { targetType: "bank_account", targetId: acct.id }, tx);
      let message = t("bank.toast.accountAdded", { name: acct.name, code: v.accountCode });
      if (createdLedger) message += " · " + t("bank.toast.ledgerCreated", { code: v.accountCode });
      if (bookedOpening) message += " · " + t("bank.toast.openingBooked", { amount: fmt.money(opening, { currency: acct.currency }) });
      return { message, accountId: acct.id };
    },
    REVALIDATE,
  );
}

/** What a SEPA batch would contain right now (shown before downloading). */
export async function sepaPreview() {
  return appAction(
    "bank",
    async (ctx, tx) => {
      const now = new Date();
      const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
      const { pay, skipped } = await sepaCandidates(tx, ctx.administration.id, today);
      const accounts = await tx.bankAccount.findMany({ where: { administrationId: ctx.administration.id, archivedAt: null, currency: "EUR", iban: { not: null } }, orderBy: { createdAt: "asc" } });
      return {
        debtors: accounts.map((a) => ({ id: a.id, name: a.name, iban: a.iban!, valid: isValidIban(a.iban!) })),
        pay: pay.map((p) => ({ id: p.invoice.id, supplier: p.name, number: p.invoice.number, dueDate: p.invoice.dueDate, amountCents: p.amountCents, iban: p.iban, scheduled: Boolean(p.invoice.paymentScheduledAt) })),
        skipped: skipped.map((s) => ({ id: s.invoice.id, supplier: s.invoice.supplierName, number: s.invoice.number, amountCents: s.invoice.totalCents - s.invoice.paidCents, currency: s.invoice.currency, reason: s.reason })),
      };
    },
    { revalidate: [] },
  );
}
