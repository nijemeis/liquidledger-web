"use server";
import { z } from "zod";
import { appAction, auditApp, canEditIn, getAppContext, type ActionResult } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { CATEGORY_BY_KEY, categoryLabel } from "@/lib/domain/categories";
import { accountName } from "@/lib/domain/chart";
import { PostingError } from "@/lib/domain/ledger";
import { bookReceipt, MILEAGE_RATE_CENTS, payClaims, suggestCategory } from "@/lib/domain/receipts";
import { aiEnabled, readReceipt } from "@/lib/documents/extract";
import { cleanFilename, createDocument, deleteDocument, discardBlob, DocumentError, putBlob, validateUpload, type StoredBlob } from "@/lib/documents/storage";
import { parseMoney } from "@/lib/format";

const PATHS = ["/costs", "/dashboard"];
type T = Awaited<ReturnType<typeof getI18n>>["t"];

const todayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

function reasonText(t: T, s: { categoryKey: string; kind: "rule" | "history" | "keyword"; count?: number }, supplier: string, locale: string) {
  const c = CATEGORY_BY_KEY[s.categoryKey];
  const label = c ? categoryLabel(c, locale).toLowerCase() : "";
  if (s.kind === "rule") return t("costs.why.rule", { supplier });
  if (s.kind === "history") return t("costs.why.history", { label, n: s.count ?? 1 });
  return t("costs.why.keyword", { label });
}

// ── Edit / categorise ────────────────────────────────────────────────────────

const Update = z.object({
  id: z.string().min(1),
  categoryKey: z.string().nullable().optional(),
  paidBy: z.enum(["CARD", "BANK", "OWN"]).optional(),
  employeeName: z.string().trim().max(80).nullable().optional(),
  vatOverride: z.enum(["EU_SERVICES", "FOREIGN_VAT", "NO_VAT"]).nullable().optional(),
});

/** Save what the user picked on a receipt (category, paid with, VAT). Doesn't book. */
export async function updateReceipt(raw: z.infer<typeof Update>) {
  const parsed = Update.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Check the fields." };
  const input = parsed.data;
  return appAction(
    "purchases",
    async (ctx, tx) => {
      const { t } = await getI18n(ctx.locale);
      const r = await tx.receipt.findFirst({ where: { id: input.id, administrationId: ctx.administration.id } });
      if (!r) throw new PostingError(t("costs.err.notFound"));
      if (r.status === "BOOKED") throw new PostingError(t("costs.err.booked"));
      if (r.payroll) throw new PostingError(t("costs.err.payroll"));
      if (input.categoryKey !== undefined && input.categoryKey !== null) {
        const c = CATEGORY_BY_KEY[input.categoryKey];
        if (!c || c.importOnly) throw new PostingError(t("costs.err.category"));
      }
      const pickedCategory = input.categoryKey !== undefined && input.categoryKey !== r.categoryKey;
      await tx.receipt.update({
        where: { id: r.id },
        data: {
          ...(input.categoryKey !== undefined
            ? { categoryKey: input.categoryKey, status: input.categoryKey ? "SUGGESTED" : "UNSORTED", suggestionReason: pickedCategory ? t("costs.why.chosen") : r.suggestionReason }
            : {}),
          ...(input.paidBy ? { paidBy: input.paidBy } : {}),
          ...(input.employeeName !== undefined ? { employeeName: input.employeeName || null } : {}),
          ...(input.vatOverride !== undefined ? { vatOverride: input.vatOverride } : {}),
        },
      });
      return {};
    },
    { revalidate: PATHS },
  );
}

// ── Book ─────────────────────────────────────────────────────────────────────

export async function bookReceiptAction(input: { id: string; makeRule: boolean }) {
  return appAction(
    "purchases",
    async (ctx, tx) => {
      const { t, fmt, locale } = await getI18n(ctx.locale);
      const A = ctx.administration.id;
      const r = await tx.receipt.findFirst({ where: { id: String(input.id), administrationId: A } });
      if (!r) throw new PostingError(t("costs.err.notFound"));
      if (!r.payroll && !r.categoryKey) throw new PostingError(t("costs.err.pickFirst"));
      if (r.paidBy === "OWN" && !r.employeeName) throw new PostingError(t("costs.err.who"));
      if (r.amountCents <= 0) throw new PostingError(t("costs.err.amount"));
      const res = await bookReceipt(tx, { administrationId: A, receiptId: r.id, userId: ctx.userId, makeRule: Boolean(input.makeRule) });
      const c = r.categoryKey ? CATEGORY_BY_KEY[r.categoryKey] : null;
      const acc = c ? await tx.ledgerAccount.findFirst({ where: { administrationId: A, code: c.account } }) : null;
      await auditApp(ctx, "costs.book", `Booked receipt ${r.supplier} · ${fmt.money(r.amountCents)} to ${c?.account ?? "payroll"}`, { targetType: "receipt", targetId: r.id }, tx);
      if (input.makeRule && c) await auditApp(ctx, "booking_rule.save", `Rule: always book ${r.supplier} as ${c.label.en}`, { targetType: "receipt", targetId: r.id }, tx);
      const parts = [t("costs.toast.booked", { account: c ? `${c.account} ${acc ? accountName(acc, ctx.administration.ledgerLanguage) : ""}`.trim() : t("costs.payroll") })];
      if (r.paidBy === "OWN") parts.push(t("costs.toast.claim", { amount: fmt.money(r.amountCents), name: r.employeeName ?? "" }));
      if (input.makeRule && c) parts.push(t("costs.toast.rule", { supplier: r.supplier, label: categoryLabel(c, locale).toLowerCase() }));
      void res;
      return { message: parts.join(" · ") };
    },
    { revalidate: PATHS },
  );
}

/** Book every receipt that has a suggested category (and who paid, for own money). */
export async function bookAllSuggested() {
  return appAction(
    "purchases",
    async (ctx, tx) => {
      const { t } = await getI18n(ctx.locale);
      const A = ctx.administration.id;
      const list = await tx.receipt.findMany({ where: { administrationId: A, status: "SUGGESTED" }, orderBy: { date: "asc" } });
      let n = 0;
      let skipped = 0;
      for (const r of list) {
        if ((!r.categoryKey && !r.payroll) || (r.paidBy === "OWN" && !r.employeeName) || r.amountCents <= 0) {
          skipped++;
          continue;
        }
        await bookReceipt(tx, { administrationId: A, receiptId: r.id, userId: ctx.userId });
        n++;
      }
      if (n) await auditApp(ctx, "costs.book_all", `Booked ${n} suggested receipts`, {}, tx);
      if (!n) return { message: t("costs.toast.nothingSuggested") };
      return { message: t("costs.toast.bookedAll", { n }) + (skipped ? ` ${t("costs.toast.skipped", { n: skipped })}` : "") };
    },
    { revalidate: PATHS },
  );
}

// ── Mileage & claims ─────────────────────────────────────────────────────────

const Mileage = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  from: z.string().trim().min(1).max(80),
  to: z.string().trim().min(1).max(80),
  km: z.number().positive().max(5000),
  employee: z.string().trim().min(1).max(80),
  returnTrip: z.boolean().optional(),
});

export async function logMileage(raw: z.infer<typeof Mileage>) {
  const parsed = Mileage.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Fill in the date, both places, the kilometres and who drove." };
  const m = parsed.data;
  return appAction(
    "purchases",
    async (ctx, tx) => {
      const { t, fmt } = await getI18n(ctx.locale);
      const km = Math.round(m.km * (m.returnTrip ? 2 : 1) * 10) / 10;
      const amount = Math.round(km * MILEAGE_RATE_CENTS);
      const r = await tx.receipt.create({
        data: {
          administrationId: ctx.administration.id,
          date: new Date(`${m.date}T00:00:00Z`),
          supplier: t("costs.mileage.supplier"),
          description: `${m.from} → ${m.to}${m.returnTrip ? ` ${t("costs.mileage.andBack")}` : ""} · ${fmt.num(km, km % 1 ? 1 : 0)} km`,
          amountCents: amount,
          categoryKey: "mileage",
          paidBy: "OWN",
          employeeName: m.employee,
          status: "SUGGESTED",
          suggestionReason: t("costs.why.mileage", { rate: fmt.money(MILEAGE_RATE_CENTS) }),
        },
      });
      await auditApp(ctx, "costs.mileage", `Logged ${km} km for ${m.employee}`, { targetType: "receipt", targetId: r.id }, tx);
      return { id: r.id, message: t("costs.toast.mileage", { km: fmt.num(km, km % 1 ? 1 : 0), rate: fmt.money(MILEAGE_RATE_CENTS), amount: fmt.money(amount), name: m.employee }) };
    },
    { revalidate: PATHS },
  );
}

export async function payOutClaims() {
  return appAction<{ people?: { name: string; cents: number }[]; total?: number; waiting?: number }>(
    "purchases",
    async (ctx, tx) => {
      const { t, fmt } = await getI18n(ctx.locale);
      const A = ctx.administration.id;
      const waiting = await tx.receipt.count({ where: { administrationId: A, paidBy: "OWN", status: { not: "BOOKED" }, claimPaidAt: null } });
      const res = await payClaims(tx, { administrationId: A, date: todayUtc() });
      if (!res.total) return { message: waiting ? t("costs.toast.claimsUnbooked", { n: waiting }) : t("costs.toast.noClaims"), people: [], total: 0, waiting };
      const names = res.people.map((p) => p.name);
      const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names.at(-1)}` : names[0] ?? "";
      await auditApp(ctx, "costs.pay_claims", `SEPA batch for expense claims: ${fmt.money(res.total)} to ${who}`, {}, tx);
      return {
        message: t("costs.toast.sepa", { amount: fmt.money(res.total), who }) + (waiting ? ` ${t("costs.toast.claimsWaiting", { n: waiting })}` : ""),
        people: res.people,
        total: res.total,
        waiting,
      };
    },
    { revalidate: PATHS },
  );
}

// ── New receipt ──────────────────────────────────────────────────────────────

/**
 * Create a receipt from a photo/PDF and/or typed fields. With an API key the
 * document is read by AI for supplier, date, amount and VAT; typed fields win.
 */
export async function createReceipt(form: FormData): Promise<ActionResult<{ id?: string }>> {
  const ctx = await getAppContext();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  if (!canEditIn(ctx, "purchases")) return { ok: false, error: "Your role doesn't allow this change." };
  const { t, fmt, locale } = await getI18n(ctx.locale);
  const str = (k: string) => (typeof form.get(k) === "string" ? String(form.get(k)).trim() : "");
  const file = form.get("file");
  let doc: { bytes: Uint8Array; filename: string; mime: string; sha256: string } | null = null;
  if (file instanceof File && file.size > 0) {
    const filename = cleanFilename(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const v = validateUpload(bytes, filename);
      doc = { bytes, filename, mime: v.mime, sha256: v.sha256 };
    } catch (e) {
      if (e instanceof DocumentError) return { ok: false, error: t(`purchases.err.file.${e.code}`, { file: filename }) };
      throw e;
    }
  }

  const read = doc && aiEnabled() ? await readReceipt(doc.bytes, doc.mime) : null;
  const x = read?.ok ? read.data : null;
  let supplier = str("supplier") || x?.supplier?.trim() || "";
  const description = str("description") || x?.description?.trim() || "";
  const typedAmount = str("amount") ? parseMoney(str("amount")) : null;
  const amountCents = typedAmount ?? (x ? Math.round(x.total * 100) : null);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str("date")) ? str("date") : x?.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : null;
  const paidBy = (["CARD", "BANK", "OWN"].includes(str("paidBy")) ? str("paidBy") : "CARD") as "CARD" | "BANK" | "OWN";
  const employeeName = str("employee") || null;

  if (!doc) {
    if (!supplier) return { ok: false, error: t("costs.err.supplier") };
    if (amountCents === null || amountCents <= 0) return { ok: false, error: t("costs.err.amount") };
  }
  if (amountCents !== null && amountCents < 0) return { ok: false, error: t("costs.err.amount") };
  if (paidBy === "OWN" && !employeeName) return { ok: false, error: t("costs.err.who") };
  supplier ||= doc?.filename ?? "";

  let blob: StoredBlob | null = null;
  if (doc) {
    try {
      blob = await putBlob(ctx.administration.id, doc.bytes, doc.mime);
    } catch (e) {
      console.error("[costs.receipt] storage", e);
      return { ok: false, error: t("purchases.err.storage") };
    }
  }

  const res = await appAction<{ id?: string }>(
    "purchases",
    async (ctx, tx) => {
      const A = ctx.administration.id;
      let documentId: string | null = null;
      if (doc && blob) {
        const d = await createDocument(tx, {
          administrationId: A, kind: "receipt", filename: doc.filename, mime: doc.mime, size: doc.bytes.length, sha256: doc.sha256, blob,
          uploadedById: ctx.userId, status: read ? (read.ok ? "PROCESSED" : "FAILED") : "UPLOADED", extraction: x ?? undefined, error: read && !read.ok ? read.reason : null,
        });
        documentId = d.id;
      }
      const s = supplier ? await suggestCategory(tx, A, supplier, description) : null;
      const r = await tx.receipt.create({
        data: {
          administrationId: A,
          date: date ? new Date(`${date}T00:00:00Z`) : todayUtc(),
          supplier: supplier.slice(0, 120),
          description: (description || (doc && !x ? t("costs.readManually") : "")).slice(0, 200),
          amountCents: amountCents ?? 0,
          currency: "EUR",
          categoryKey: s?.categoryKey ?? null,
          status: s ? "SUGGESTED" : "UNSORTED",
          suggestionReason: s ? reasonText(t, s, supplier, locale) : null,
          paidBy,
          employeeName: paidBy === "OWN" ? employeeName : null,
          documentId,
        },
      });
      await auditApp(ctx, "costs.receipt", `Added receipt ${r.supplier} · ${fmt.money(r.amountCents)}`, { targetType: "receipt", targetId: r.id }, tx);
      const c = s ? CATEGORY_BY_KEY[s.categoryKey] : null;
      const head = x
        ? t("costs.toast.read", { supplier: r.supplier, amount: fmt.money(r.amountCents) })
        : t("costs.toast.added", { supplier: r.supplier, amount: fmt.money(r.amountCents) });
      const tail = c ? t("costs.toast.suggested", { label: categoryLabel(c, locale).toLowerCase() }) : t("costs.toast.pickCategory");
      const manual = doc && !x && !amountCents ? ` ${t("costs.toast.fillAmount")}` : "";
      return { id: r.id, message: `${head} · ${tail}.${manual}` };
    },
    { revalidate: PATHS },
  );
  if (!res.ok && blob) await discardBlob(blob);
  return res;
}

const EditFields = z.object({
  id: z.string().min(1),
  supplier: z.string().trim().min(1).max(120),
  description: z.string().trim().max(200),
  amount: z.string().trim(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Correct the basic fields of an unbooked receipt (e.g. after a photo that couldn't be read). */
export async function editReceiptDetails(raw: z.infer<typeof EditFields>) {
  const parsed = EditFields.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Fill in the supplier, amount and date." };
  return appAction(
    "purchases",
    async (ctx, tx) => {
      const { t } = await getI18n(ctx.locale);
      const amount = parseMoney(parsed.data.amount);
      if (amount === null || amount <= 0) throw new PostingError(t("costs.err.amount"));
      const r = await tx.receipt.findFirst({ where: { id: parsed.data.id, administrationId: ctx.administration.id } });
      if (!r) throw new PostingError(t("costs.err.notFound"));
      if (r.status === "BOOKED" || r.payroll) throw new PostingError(t("costs.err.booked"));
      await tx.receipt.update({
        where: { id: r.id },
        data: { supplier: parsed.data.supplier, description: parsed.data.description, amountCents: amount, date: new Date(`${parsed.data.date}T00:00:00Z`) },
      });
      return { message: t("costs.toast.detailsSaved") };
    },
    { revalidate: PATHS },
  );
}

export async function deleteReceipt(id: string) {
  let blob: StoredBlob | null = null;
  const res = await appAction(
    "purchases",
    async (ctx, tx) => {
      const { t, fmt } = await getI18n(ctx.locale);
      const r = await tx.receipt.findFirst({ where: { id, administrationId: ctx.administration.id } });
      if (!r) throw new PostingError(t("costs.err.notFound"));
      if (r.status === "BOOKED") throw new PostingError(t("costs.err.deleteBooked"));
      await tx.receipt.delete({ where: { id: r.id } });
      if (r.documentId) blob = await deleteDocument(tx, ctx.administration.id, r.documentId);
      await auditApp(ctx, "costs.delete", `Deleted receipt ${r.supplier} · ${fmt.money(r.amountCents)}`, { targetType: "receipt", targetId: r.id }, tx);
      return { message: t("costs.toast.deleted") };
    },
    { revalidate: PATHS },
  );
  if (res.ok && blob) await discardBlob(blob);
  return res;
}
