"use server";
import { z } from "zod";
import { appAction, auditApp, type AppContext } from "@/lib/app-context";
import type { Tx } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { sendMail } from "@/lib/email";
import { parseMoney } from "@/lib/format";
import { PostingError } from "@/lib/domain/ledger";
import { creditInvoice, daysOverdue, registerSalesPayment, saveDraft, sendInvoice } from "@/lib/domain/sales";
import { determineRegime } from "@/lib/domain/vat";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const todayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
};

const draftSchema = z.object({
  invoiceId: z.string().optional().nullable(),
  customerId: z.string().min(1),
  issueDate: isoDate,
  dueDate: isoDate.optional().nullable(),
  warehouseId: z.string().optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  lines: z
    .array(z.object({ productId: z.string().min(1), qtyUnits: z.number().int().min(0).max(10_000_000), unitPriceCents: z.number().int().min(0).max(1_000_000_000) }))
    .max(200),
});
export type DraftPayload = z.infer<typeof draftSchema>;

async function storeDraft(ctx: AppContext, tx: Tx, input: DraftPayload) {
  const { t } = await getI18n(ctx.locale);
  const v = draftSchema.safeParse(input);
  if (!v.success) throw new PostingError(t("sales.err.invalid"));
  const d = v.data;
  const A = ctx.administration.id;
  const customer = await tx.relation.findFirst({ where: { id: d.customerId, administrationId: A } });
  if (!customer) throw new PostingError(t("sales.err.customer"));
  if (d.warehouseId && !(await tx.warehouse.count({ where: { id: d.warehouseId, administrationId: A } }))) throw new PostingError(t("sales.err.warehouse"));
  const issue = toDate(d.issueDate);
  const due = d.dueDate ? toDate(d.dueDate) : null;
  if (due && due < issue) throw new PostingError(t("sales.err.dueBeforeIssue"));
  const lines = d.lines.filter((l) => l.qtyUnits > 0);
  if (!lines.length) throw new PostingError(t("sales.err.noLines"));
  const { regime } = determineRegime(ctx.administration.country, customer);
  const inv = await saveDraft(tx, {
    administrationId: A,
    invoiceId: d.invoiceId || null,
    customerId: customer.id,
    issueDate: issue,
    dueDate: due,
    warehouseId: d.warehouseId || null,
    reference: d.reference || null,
    regime,
    lines,
    createdById: ctx.userId,
  });
  return { inv, customer };
}

export async function saveInvoiceDraft(input: DraftPayload) {
  return appAction("sales", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const { inv, customer } = await storeDraft(ctx, tx, input);
    await auditApp(ctx, input.invoiceId ? "sales.draft_update" : "sales.draft_create", `Draft for ${customer.name}: ${(inv.totalCents / 100).toFixed(2)}`, { targetType: "sales_invoice", targetId: inv.id }, tx);
    return { id: inv.id, message: t("sales.toast.draftSaved", { name: customer.name, amount: fmt.money(inv.totalCents) }) };
  });
}

/** Save and send in one go: numbering, journal entry, stock out, customs drafts (and e-mail when we have an address). */
export async function sendInvoiceNow(input: DraftPayload) {
  return appAction("sales", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const { inv } = await storeDraft(ctx, tx, input);
    const res = await sendInvoice(tx, { administrationId: ctx.administration.id, invoiceId: inv.id, userId: ctx.userId });
    const number = res.invoice.number!;
    await auditApp(ctx, "sales.send", `Sent ${number} to ${res.customer.name}: ${(res.invoice.totalCents / 100).toFixed(2)}`, { targetType: "sales_invoice", targetId: inv.id }, tx);
    let message = t("sales.toast.sent", { number, name: res.customer.name, amount: fmt.money(res.invoice.totalCents) });
    if (res.customsDoc === "E_AD") message += " · " + t("sales.toast.eadDrafted");
    if (res.customsDoc === "EXPORT_DECLARATION") message += " · " + t("sales.toast.exportDrafted");
    if (res.customer.email) {
      await mailInvoice(ctx, tx, res.invoice.id);
      message += " · " + t("sales.toast.emailedTo", { email: res.customer.email });
    }
    return { id: res.invoice.id, message };
  });
}

export async function deleteDraft(invoiceId: string) {
  return appAction("sales", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const inv = await tx.salesInvoice.findFirst({ where: { id: invoiceId, administrationId: ctx.administration.id } });
    if (!inv) throw new PostingError(t("sales.err.notFound"));
    if (inv.status !== "DRAFT") throw new PostingError(t("sales.err.onlyDrafts"));
    await tx.salesInvoice.delete({ where: { id: inv.id } });
    await auditApp(ctx, "sales.draft_delete", `Deleted draft of ${(inv.totalCents / 100).toFixed(2)}`, { targetType: "sales_invoice", targetId: inv.id }, tx);
    return { message: t("sales.toast.draftDeleted") };
  });
}

/** E-mail every overdue customer that has an address; say who couldn't be reached. */
export async function sendReminders() {
  return appAction("sales", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const A = ctx.administration.id;
    const today = todayUtc();
    const overdue = await tx.salesInvoice.findMany({ where: { administrationId: A, status: "OPEN", dueDate: { lt: today } }, orderBy: { dueDate: "asc" } });
    if (!overdue.length) return { message: t("sales.toast.nothingOverdue") };
    const customers = await tx.relation.findMany({ where: { administrationId: A, id: { in: [...new Set(overdue.map((i) => i.customerId))] } } });
    const admin = ctx.administration;
    const sent: string[] = [];
    const noEmail: string[] = [];
    for (const c of customers) {
      const list = overdue.filter((i) => i.customerId === c.id);
      if (!c.email) {
        noEmail.push(c.name);
        continue;
      }
      const total = list.reduce((a, i) => a + i.totalCents - i.paidCents, 0);
      const rows = list
        .map((i) => `  ${i.number}  ·  ${fmt.dateMed(i.issueDate)}  ·  ${fmt.money(i.totalCents - i.paidCents)}  ·  ${daysOverdue(i, today)} days overdue`)
        .join("\n");
      await sendMail({
        to: c.email,
        subject: `Payment reminder · ${admin.legalName}`,
        text: `Dear ${c.name},\n\nAccording to our records the following invoice${list.length > 1 ? "s are" : " is"} past due:\n\n${rows}\n\nTotal outstanding: ${fmt.money(total)}\n\nPlease transfer the amount to ${admin.iban ?? "our bank account"} quoting the invoice number. If you've already paid, please disregard this message.\n\nKind regards,\n${admin.legalName}${admin.email ? `\n${admin.email}` : ""}`,
      });
      await tx.salesInvoice.updateMany({ where: { id: { in: list.map((i) => i.id) } }, data: { lastReminderAt: new Date() } });
      sent.push(c.name);
    }
    const join = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} ${t("sales.and")} ${names[names.length - 1]}` : names[0] ?? "");
    await auditApp(ctx, "sales.reminders", `Reminders sent to ${sent.join(", ") || "nobody"}${noEmail.length ? `; no e-mail for ${noEmail.join(", ")}` : ""}`, { targetType: "sales_invoice" }, tx);
    const parts: string[] = [];
    if (sent.length) parts.push(t("sales.toast.remindersSent", { names: join(sent) }));
    if (noEmail.length) parts.push(t("sales.toast.noEmail", { names: join(noEmail) }));
    if (!sent.length) throw new PostingError(parts.join(" "));
    return { message: parts.join(" ") };
  });
}

const paymentSchema = z.object({ invoiceId: z.string().min(1), amount: z.string().min(1).max(20), date: isoDate, bankAccountId: z.string().min(1) });

export async function registerPayment(input: z.infer<typeof paymentSchema>) {
  return appAction("sales", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const v = paymentSchema.safeParse(input);
    if (!v.success) throw new PostingError(t("sales.err.invalid"));
    const A = ctx.administration.id;
    const inv = await tx.salesInvoice.findFirst({ where: { id: v.data.invoiceId, administrationId: A } });
    if (!inv) throw new PostingError(t("sales.err.notFound"));
    if (inv.status !== "OPEN") throw new PostingError(t("sales.err.notOpen"));
    const cents = parseMoney(v.data.amount);
    const outstanding = inv.totalCents - inv.paidCents;
    if (!cents || cents <= 0) throw new PostingError(t("sales.err.amount"));
    if (cents > outstanding) throw new PostingError(t("sales.err.overpay", { amount: fmt.money(outstanding) }));
    const bank = await tx.bankAccount.findFirst({ where: { id: v.data.bankAccountId, administrationId: A } });
    if (!bank) throw new PostingError(t("sales.err.bank"));
    if (bank.currency !== ctx.administration.baseCurrency) throw new PostingError(t("sales.err.bankCurrency"));
    const res = await registerSalesPayment(tx, { administrationId: A, invoiceId: inv.id, amountCents: cents, date: toDate(v.data.date), bankAccountCode: bank.accountCode, userId: ctx.userId });
    await auditApp(ctx, "sales.payment", `Payment ${(cents / 100).toFixed(2)} on ${inv.number} via ${bank.name}`, { targetType: "sales_invoice", targetId: inv.id }, tx);
    return {
      message: res.full
        ? t("sales.toast.paidFull", { amount: fmt.money(cents), number: inv.number ?? "" })
        : t("sales.toast.paidPart", { amount: fmt.money(cents), number: inv.number ?? "", left: fmt.money(res.remaining) }),
    };
  });
}

async function mailInvoice(ctx: AppContext, tx: Tx, invoiceId: string) {
  const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { orderBy: { sort: "asc" } } } });
  const customer = await tx.relation.findUniqueOrThrow({ where: { id: inv.customerId } });
  if (!customer.email) throw new PostingError("No e-mail address");
  const { fmt } = await getI18n("en");
  const a = ctx.administration;
  const lines = inv.lines.map((l) => `  ${l.qtyUnits} × ${l.description} à ${fmt.money(l.unitPriceCents)}  =  ${fmt.money(l.netCents)}${l.exciseCents ? ` (+ excise ${fmt.money(l.exciseCents)})` : ""}`).join("\n");
  const regime =
    inv.taxRegime === "EU_B2B"
      ? `\nVAT reverse-charged — Article 138 VAT Directive. Your VAT number: ${customer.vatNumber ?? "—"} · ours: ${a.vatNumber ?? "—"}.`
      : inv.taxRegime === "EXPORT"
        ? "\nExport — 0% VAT."
        : "";
  await sendMail({
    to: customer.email,
    subject: `Invoice ${inv.number} from ${a.legalName}`,
    text:
      `Dear ${customer.name},\n\nPlease find our invoice ${inv.number} of ${fmt.dateMed(inv.issueDate)}.\n\n${lines}\n\n` +
      `Net: ${fmt.money(inv.netCents)}\n${inv.exciseCents ? `Excise: ${fmt.money(inv.exciseCents)}\n` : ""}${inv.depositCents ? `Deposit: ${fmt.money(inv.depositCents)}\n` : ""}VAT: ${fmt.money(inv.vatCents)}\nTotal: ${fmt.money(inv.totalCents)}${regime}\n\n` +
      `Please pay ${fmt.money(inv.totalCents - inv.paidCents)} by ${fmt.dateMed(inv.dueDate)} to ${a.iban ?? "our bank account"} (${a.legalName}), quoting ${inv.number}.\n\nKind regards,\n${a.legalName}${a.email ? `\n${a.email}` : ""}`,
  });
}

export async function emailInvoice(invoiceId: string) {
  return appAction("sales", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const inv = await tx.salesInvoice.findFirst({ where: { id: invoiceId, administrationId: ctx.administration.id } });
    if (!inv || inv.status === "DRAFT") throw new PostingError(t("sales.err.notFound"));
    const customer = await tx.relation.findUniqueOrThrow({ where: { id: inv.customerId } });
    if (!customer.email) throw new PostingError(t("sales.err.noEmail", { name: customer.name }));
    await mailInvoice(ctx, tx, inv.id);
    await auditApp(ctx, "sales.email", `E-mailed ${inv.number} to ${customer.email}`, { targetType: "sales_invoice", targetId: inv.id }, tx);
    return { message: t("sales.toast.emailed", { number: inv.number ?? "", email: customer.email }) };
  });
}

export async function creditInvoiceAction(input: { invoiceId: string; reason?: string }) {
  return appAction("sales", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const inv = await tx.salesInvoice.findFirst({ where: { id: input.invoiceId, administrationId: ctx.administration.id } });
    if (!inv) throw new PostingError(t("sales.err.notFound"));
    const res = await creditInvoice(tx, { administrationId: ctx.administration.id, invoiceId: inv.id, date: todayUtc(), userId: ctx.userId, reason: input.reason?.trim().slice(0, 300) || null });
    const wh = inv.warehouseId ? await tx.warehouse.findUnique({ where: { id: inv.warehouseId } }) : null;
    await auditApp(ctx, "sales.credit", `Credited ${inv.number} with ${res.creditNote.number}`, { targetType: "sales_invoice", targetId: inv.id }, tx);
    let message = t("sales.toast.credited", { number: inv.number ?? "", cn: res.creditNote.number ?? "" });
    if (res.units) message += " · " + t("sales.toast.stockBack", { n: fmt.int(res.units), warehouse: wh?.name ?? "" });
    if (res.customsVoided) message += " · " + t("sales.toast.customsVoided");
    if (res.refundCents) message += " · " + t("sales.toast.refund", { amount: fmt.money(res.refundCents) });
    return { message, creditNoteId: res.creditNote.id };
  });
}
