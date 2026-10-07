"use server";
import { z } from "zod";
import { appAction, auditApp } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { post, PostingError, reverse } from "@/lib/domain/ledger";
import { ACC } from "@/lib/domain/chart";
import { VAT } from "@/lib/domain/vat";
import { makeFormatters } from "@/lib/format";

const VAT_CODES = Object.values(VAT) as string[];
const SALES_CODES = new Set<string>([VAT.SALES_HIGH, VAT.SALES_LOW, VAT.SALES_ZERO, VAT.EXPORT, VAT.ICP]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const EntryInput = z.object({
  date: day,
  title: z.string().trim().min(2).max(200),
  lines: z
    .array(
      z.object({
        account: z.string().min(1).max(10),
        debit: z.number().int().min(0).max(1e12),
        credit: z.number().int().min(0).max(1e12),
        vatCode: z.string().optional().nullable(),
        description: z.string().trim().max(200).optional().nullable(),
      }),
    )
    .min(2)
    .max(100),
});

/** Post a manual journal entry (memoriaal). */
export async function postJournal(input: z.input<typeof EntryInput>) {
  return appAction("reports", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const parsed = EntryInput.safeParse(input);
    if (!parsed.success) throw new PostingError(t("ledger.err.entry"));
    const e = parsed.data;
    const date = new Date(e.date + "T00:00:00Z");
    if (Number.isNaN(date.getTime())) throw new PostingError(t("ledger.err.date"));
    const locked = ctx.administration.lockedThrough;
    if (locked && date <= locked) throw new PostingError(t("ledger.err.locked", { date: fmt.dateMed(locked) }));
    for (const l of e.lines) if (l.vatCode && !VAT_CODES.includes(l.vatCode)) throw new PostingError(t("ledger.err.vatCode"));
    const vatAccounts = new Set<string>([ACC.vatPayable, ACC.vatReclaim]);
    const entry = await post(tx, {
      administrationId: ctx.administration.id,
      date,
      title: e.title,
      source: "MANUAL",
      createdById: ctx.userId,
      lines: e.lines.map((l) => {
        // A VAT code on a revenue/cost line makes that line the VAT base (turnover);
        // on the VAT accounts themselves it tags the VAT amount for the return.
        const base = l.vatCode && !vatAccounts.has(l.account) ? (SALES_CODES.has(l.vatCode) ? l.credit - l.debit : l.debit - l.credit) : null;
        return { account: l.account, debit: l.debit, credit: l.credit, vatCode: l.vatCode || null, vatBase: base, description: l.description || null };
      }),
    });
    const total = entry.lines.reduce((a, l) => a + l.debitCents, 0);
    const en = makeFormatters("en");
    await auditApp(ctx, "ledger.post", `Manual journal entry #${entry.number} · ${e.title} · ${en.money(total)}`, { targetType: "journal_entry", targetId: entry.id, after: { date: e.date, lines: e.lines } }, tx);
    return { message: t("ledger.toast.posted", { n: entry.number, amount: fmt.money(total) }) };
  });
}

/** Correct a manual entry by posting its mirror image (history is never edited). */
export async function reverseEntry(input: { id: string; date?: string }) {
  return appAction("reports", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const A = ctx.administration.id;
    const e = await tx.journalEntry.findFirst({ where: { id: String(input.id), administrationId: A } });
    if (!e) throw new PostingError(t("ledger.err.notFound"));
    if (e.source !== "MANUAL") throw new PostingError(t("ledger.err.onlyManual"));
    if (e.reversalOfId) throw new PostingError(t("ledger.err.isReversal"));
    const already = await tx.journalEntry.findFirst({ where: { administrationId: A, reversalOfId: e.id } });
    if (already) throw new PostingError(t("ledger.err.alreadyReversed", { n: already.number }));
    const now = new Date();
    let date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? new Date(input.date + "T00:00:00Z") : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (e.date > date) date = e.date;
    const locked = ctx.administration.lockedThrough;
    if (locked && date <= locked) throw new PostingError(t("ledger.err.locked", { date: fmt.dateMed(locked) }));
    const rev = await reverse(tx, e.id, date, ctx.userId);
    await auditApp(ctx, "ledger.reverse", `Reversed journal entry #${e.number} with #${rev.number}`, { targetType: "journal_entry", targetId: e.id, after: { reversalId: rev.id, reversalNumber: rev.number } }, tx);
    return { message: t("ledger.toast.reversed", { n: e.number, r: rev.number, date: fmt.dateMed(date) }) };
  });
}

const AccountInput = z.object({
  code: z.string().trim().regex(/^\d{4,6}$/),
  nameNl: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().min(2).max(120),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COST"]),
});

export async function createAccount(input: z.input<typeof AccountInput>) {
  return appAction("reports", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const parsed = AccountInput.safeParse(input);
    if (!parsed.success) throw new PostingError(t(parsed.error.issues.some((i) => i.path[0] === "code") ? "ledger.err.code" : "ledger.err.account"));
    const a = parsed.data;
    const A = ctx.administration.id;
    const exists = await tx.ledgerAccount.findFirst({ where: { administrationId: A, code: a.code } });
    if (exists) throw new PostingError(t("ledger.err.codeTaken", { code: a.code, name: ctx.administration.ledgerLanguage === "nl" ? exists.nameNl : exists.nameEn }));
    const acc = await tx.ledgerAccount.create({ data: { administrationId: A, ...a } });
    await auditApp(ctx, "ledger.account.create", `Added ledger account ${a.code} ${a.nameEn}`, { targetType: "ledger_account", targetId: acc.id, after: a }, tx);
    return { message: t("ledger.toast.accountAdded", { code: a.code, name: ctx.administration.ledgerLanguage === "nl" ? a.nameNl : a.nameEn }) };
  });
}

/** Close the books through a month end, or reopen to an earlier one (null = all open). Owner/Admin only. */
export async function setPeriodClose(input: { through: string | null }) {
  return appAction("users", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const before = ctx.administration.lockedThrough;
    let through: Date | null = null;
    if (input.through) {
      if (!day.safeParse(input.through).success) throw new PostingError(t("ledger.err.date"));
      through = new Date(input.through + "T00:00:00Z");
      const next = new Date(through.getTime() + 86400_000);
      if (next.getUTCDate() !== 1) throw new PostingError(t("ledger.err.monthEnd"));
      const now = new Date();
      if (through.getTime() >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) throw new PostingError(t("ledger.err.future"));
    }
    if ((before?.getTime() ?? null) === (through?.getTime() ?? null)) throw new PostingError(t("ledger.err.unchanged"));
    await tx.administration.update({ where: { id: ctx.administration.id }, data: { lockedThrough: through } });
    const reopening = !through || (before && through < before);
    const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    await auditApp(
      ctx,
      reopening ? "ledger.period.reopen" : "ledger.period.close",
      reopening ? `Reopened the books ${through ? `after ${iso(through)}` : "completely"} (were closed through ${iso(before)})` : `Closed the books through ${iso(through)}`,
      { targetType: "administration", targetId: ctx.administration.id, before: { lockedThrough: iso(before) }, after: { lockedThrough: iso(through) } },
      tx,
    );
    return {
      message: !through ? t("ledger.toast.reopenedAll") : reopening ? t("ledger.toast.reopened", { date: fmt.dateMed(through) }) : t("ledger.toast.closed", { date: fmt.dateMed(through) }),
    };
  });
}
