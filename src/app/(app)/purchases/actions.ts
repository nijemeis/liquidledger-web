"use server";
import { z } from "zod";
import { appAction, auditApp, canEditIn, getAppContext, type ActionResult, type AppContext } from "@/lib/app-context";
import type { Tx } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { STOCK_ACCOUNT } from "@/lib/domain/chart";
import { PostingError } from "@/lib/domain/ledger";
import { bookPurchase, calcPurchase } from "@/lib/domain/purchases";
import { aiEnabled, loadProposalRefs, proposeFromExtraction, readInvoice } from "@/lib/documents/extract";
import { ecbRate } from "@/lib/documents/fx";
import { cleanFilename, createDocument, deleteDocument, discardBlob, DocumentError, putBlob, validateUpload, type StoredBlob } from "@/lib/documents/storage";

const PATHS = ["/purchases", "/dashboard", "/stock"];
const NEW = "__new";

// ── Upload ───────────────────────────────────────────────────────────────────

/**
 * Upload one purchase invoice (PDF/photo), read it with AI when configured and
 * save a TO_APPROVE booking proposal. Never books.
 */
export async function uploadPurchaseDocument(form: FormData): Promise<ActionResult<{ id?: string }>> {
  const ctx = await getAppContext();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  if (!canEditIn(ctx, "purchases")) return { ok: false, error: "Your role doesn't allow this change." };
  const { t, fmt } = await getI18n(ctx.locale);
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: t("purchases.err.noFile") };
  const filename = cleanFilename(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let check: ReturnType<typeof validateUpload>;
  try {
    check = validateUpload(bytes, filename);
  } catch (e) {
    if (e instanceof DocumentError) return { ok: false, error: t(`purchases.err.file.${e.code}`, { file: filename }) };
    throw e;
  }

  // Slow work (AI, ECB, object storage) happens outside the database transaction.
  const read = aiEnabled() ? await readInvoice(bytes, check.mime) : ({ ok: false, reason: "no_key" } as const);
  const extraction = read.ok ? read.data : null;
  const cur = extraction?.currency?.toUpperCase().slice(0, 3);
  const fx = cur && cur !== "EUR" ? await ecbRate(cur) : null;
  let blob: StoredBlob;
  try {
    blob = await putBlob(ctx.administration.id, bytes, check.mime);
  } catch (e) {
    console.error("[purchases.upload] storage", e);
    return { ok: false, error: t("purchases.err.storage") };
  }

  const res = await appAction<{ id?: string }>(
    "purchases",
    async (ctx, tx) => {
      const A = ctx.administration.id;
      const dup = await tx.document.findFirst({ where: { administrationId: A, sha256: check.sha256, kind: "purchase_invoice" }, select: { filename: true, createdAt: true } });
      if (dup) throw new PostingError(t("purchases.err.duplicate", { file: filename, date: fmt.dateMed(dup.createdAt) }));
      const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

      if (!extraction) {
        const doc = await createDocument(tx, {
          administrationId: A, kind: "purchase_invoice", filename, mime: check.mime, size: bytes.length, sha256: check.sha256, blob,
          uploadedById: ctx.userId, status: read.ok ? "PROCESSED" : read.reason === "no_key" ? "UPLOADED" : "FAILED", error: read.ok ? null : read.reason,
        });
        const inv = await tx.purchaseInvoice.create({
          data: {
            administrationId: A, supplierName: "", number: "", issueDate: today, status: "TO_APPROVE", documentId: doc.id,
            warning: read.ok ? null : t(read.reason === "unsupported" ? "purchases.warn.heic" : "purchases.warn.manual"),
          },
        });
        await auditApp(ctx, "purchases.upload", `Uploaded ${filename} (not read automatically)`, { targetType: "purchase_invoice", targetId: inv.id }, tx);
        return { id: inv.id, message: t("purchases.toast.uploadedManual", { file: filename }) };
      }

      const refs = await loadProposalRefs(tx, A, ctx.administration.country);
      const p = proposeFromExtraction(extraction, refs, fx, t, today);
      const calc = calcPurchase({ fxRate: p.fxRate, treatment: p.vatTreatment, lines: p.lines });
      const doc = await createDocument(tx, {
        administrationId: A, kind: "purchase_invoice", filename, mime: check.mime, size: bytes.length, sha256: check.sha256, blob,
        uploadedById: ctx.userId, status: "PROCESSED", extraction: { ...extraction, model: read.ok ? read.model : null, newSupplier: p.newSupplier },
      });
      const inv = await tx.purchaseInvoice.create({
        data: {
          administrationId: A,
          supplierId: p.supplierId,
          supplierName: p.supplierName,
          supplierCountry: p.supplierCountry,
          number: p.number,
          issueDate: p.issueDate,
          dueDate: p.dueDate,
          currency: p.currency,
          fxRate: p.fxRate,
          fxDate: p.fxDate,
          vatTreatment: p.vatTreatment,
          warehouseId: p.warehouseId,
          shipmentId: p.shipmentId,
          orderRef: p.orderRef,
          documentId: doc.id,
          ocrConfidence: p.ocrConfidence,
          warning: p.warnings.join(" ") || null,
          status: "TO_APPROVE",
          netCents: calc.netCents,
          vatCents: calc.vatCents,
          totalCents: calc.totalCents,
          totalSourceCents: calc.totalSourceCents,
          lines: { create: calc.lines.map(({ description, productId, accountCode, qty, unitPriceSrcCents, amountSrcCents, amountCents, vatRateBp, vatCents, sort }) => ({ administrationId: A, description, productId, accountCode, qty, unitPriceSrcCents, amountSrcCents, amountCents, vatRateBp, vatCents, sort })) },
        },
      });
      await auditApp(ctx, "purchases.upload", `Uploaded and read ${filename} · ${p.supplierName} ${p.number}`, { targetType: "purchase_invoice", targetId: inv.id }, tx);
      return { id: inv.id, message: t("purchases.toast.uploaded", { file: filename, supplier: p.supplierName || "—", conf: p.ocrConfidence }) };
    },
    { revalidate: PATHS },
  );
  if (!res.ok) await discardBlob(blob);
  return res;
}

// ── Proposal edits ───────────────────────────────────────────────────────────

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ProposalInput = z.object({
  id: z.string().min(1),
  supplierId: z.string().nullable(),
  supplierName: z.string().trim().max(160),
  supplierCountry: z.string().trim().max(2).nullable(),
  number: z.string().trim().max(60),
  issueDate: day,
  dueDate: day.nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  fxRate: z.number().min(0).max(100000),
  vatTreatment: z.enum(["DOMESTIC", "EU_ACQUISITION", "IMPORT", "EU_SERVICES", "NONE"]),
  warehouseId: z.string().nullable(),
  shipmentId: z.string().nullable(),
  orderRef: z.string().trim().max(120).nullable(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(200),
        productId: z.string().nullable(),
        accountCode: z.string().trim().max(10),
        qty: z.number().int().min(1).max(10_000_000),
        unitPriceSrcCents: z.number().int().min(0).max(10_000_000_000),
        vatRateBp: z.number().int().min(0).max(10_000),
      }),
    )
    .max(200),
});
export type ProposalInput = z.infer<typeof ProposalInput>;

const asDate = (s: string) => new Date(`${s}T00:00:00Z`);

async function applyProposal(ctx: AppContext, tx: Tx, input: ProposalInput) {
  const A = ctx.administration.id;
  const { t } = await getI18n(ctx.locale);
  const inv = await tx.purchaseInvoice.findFirst({ where: { id: input.id, administrationId: A } });
  if (!inv) throw new PostingError(t("purchases.err.notFound"));
  if (inv.status !== "TO_APPROVE") throw new PostingError(t("purchases.err.alreadyBooked"));

  let supplierId: string | null = null;
  let supplierName = input.supplierName;
  let supplierCountry = input.supplierCountry?.toUpperCase() || null;
  if (input.supplierId && input.supplierId !== NEW) {
    const s = await tx.relation.findFirst({ where: { id: input.supplierId, administrationId: A } });
    if (!s) throw new PostingError(t("purchases.err.supplier"));
    supplierId = s.id;
    supplierName = s.name;
    supplierCountry = s.country;
  }

  const warehouse = input.warehouseId ? await tx.warehouse.findFirst({ where: { id: input.warehouseId, administrationId: A } }) : null;
  if (input.warehouseId && !warehouse) throw new PostingError(t("purchases.err.warehouse"));
  const productIds = [...new Set(input.lines.map((l) => l.productId).filter(Boolean))] as string[];
  if (productIds.length) {
    const n = await tx.product.count({ where: { id: { in: productIds }, administrationId: A } });
    if (n !== productIds.length) throw new PostingError(t("purchases.err.product"));
  }
  const shipment = input.shipmentId ? await tx.shipment.findFirst({ where: { id: input.shipmentId, administrationId: A }, select: { id: true } }) : null;

  const fxRate = input.currency === ctx.administration.baseCurrency ? 1 : input.fxRate;
  const lines = input.lines.map((l) => ({
    ...l,
    accountCode: l.productId ? STOCK_ACCOUNT[warehouse?.kind ?? "BONDED"] : l.accountCode || "4900",
  }));
  const calc = calcPurchase({ fxRate, treatment: input.vatTreatment, lines });
  await tx.purchaseInvoiceLine.deleteMany({ where: { invoiceId: inv.id, administrationId: A } });
  if (calc.lines.length) {
    await tx.purchaseInvoiceLine.createMany({
      data: calc.lines.map(({ description, productId, accountCode, qty, unitPriceSrcCents, amountSrcCents, amountCents, vatRateBp, vatCents, sort }) => ({
        administrationId: A, invoiceId: inv.id, description, productId, accountCode, qty, unitPriceSrcCents, amountSrcCents, amountCents, vatRateBp, vatCents, sort,
      })),
    });
  }
  const fxChanged = fxRate !== Number(inv.fxRate) || input.currency !== inv.currency;
  return tx.purchaseInvoice.update({
    where: { id: inv.id },
    data: {
      supplierId,
      supplierName,
      supplierCountry,
      number: input.number,
      issueDate: asDate(input.issueDate),
      dueDate: input.dueDate ? asDate(input.dueDate) : null,
      currency: input.currency,
      fxRate,
      fxDate: fxChanged ? (input.currency === ctx.administration.baseCurrency ? null : asDate(input.issueDate)) : inv.fxDate,
      vatTreatment: input.vatTreatment,
      // A "couldn't read automatically" note is resolved once someone has filled the invoice in.
      warning: inv.ocrConfidence === null ? null : inv.warning,
      warehouseId: warehouse?.id ?? null,
      shipmentId: shipment?.id ?? null,
      orderRef: input.orderRef || null,
      netCents: calc.netCents,
      vatCents: calc.vatCents,
      totalCents: calc.totalCents,
      totalSourceCents: calc.totalSourceCents,
    },
  });
}

export async function savePurchase(raw: ProposalInput) {
  const parsed = ProposalInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Check the highlighted fields." };
  return appAction(
    "purchases",
    async (ctx, tx) => {
      const { t } = await getI18n(ctx.locale);
      const inv = await applyProposal(ctx, tx, parsed.data);
      await auditApp(ctx, "purchases.update", `Edited booking proposal ${inv.number || inv.id}`, { targetType: "purchase_invoice", targetId: inv.id }, tx);
      return { message: t("purchases.toast.saved") };
    },
    { revalidate: PATHS },
  );
}

/** Fetch the latest ECB reference rate for a currency (used by the proposal form). */
export async function lookupFxRate(currency: string): Promise<ActionResult<{ rate?: number; date?: string }>> {
  const ctx = await getAppContext();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  const { t } = await getI18n(ctx.locale);
  if (!/^[A-Za-z]{3}$/.test(currency)) return { ok: false, error: t("purchases.err.currency") };
  const r = await ecbRate(currency);
  if (!r) return { ok: false, error: t("purchases.err.fxUnavailable") };
  return { ok: true, rate: r.rate, date: r.date.toISOString().slice(0, 10) };
}

export async function approvePurchase(raw: ProposalInput & { schedulePayment?: boolean }) {
  const parsed = ProposalInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Check the highlighted fields." };
  const schedule = Boolean(raw.schedulePayment);
  return appAction(
    "purchases",
    async (ctx, tx) => {
      const { t, fmt } = await getI18n(ctx.locale);
      const A = ctx.administration.id;
      const input = parsed.data;
      if (!input.number) throw new PostingError(t("purchases.err.number"));
      if (!input.lines.length) throw new PostingError(t("purchases.err.lines"));
      if (input.currency !== ctx.administration.baseCurrency && !(input.fxRate > 0)) throw new PostingError(t("purchases.err.fx"));
      if (!input.supplierId && !input.supplierName) throw new PostingError(t("purchases.err.supplier"));
      let inv = await applyProposal(ctx, tx, input);

      // A proposed new supplier becomes a relation when the user approves.
      let created: string | null = null;
      if (!inv.supplierId) {
        if (!inv.supplierName) throw new PostingError(t("purchases.err.supplier"));
        const doc = inv.documentId ? await tx.document.findFirst({ where: { id: inv.documentId, administrationId: A }, select: { extraction: true } }) : null;
        const ns = (doc?.extraction as { newSupplier?: { vatNumber?: string | null; iban?: string | null } } | null)?.newSupplier;
        const existing = await tx.relation.findFirst({ where: { administrationId: A, name: { equals: inv.supplierName, mode: "insensitive" }, kind: { in: ["SUPPLIER", "BOTH"] } } });
        const rel =
          existing ??
          (await tx.relation.create({
            data: {
              administrationId: A,
              kind: "SUPPLIER",
              name: inv.supplierName,
              country: inv.supplierCountry || ctx.administration.country,
              vatNumber: ns?.vatNumber ?? null,
              iban: ns?.iban ?? null,
              paymentTermsDays: inv.dueDate ? Math.max(0, Math.round((inv.dueDate.getTime() - inv.issueDate.getTime()) / 86400_000)) : 30,
            },
          }));
        if (!existing) {
          created = rel.name;
          await auditApp(ctx, "relations.create", `Added supplier ${rel.name} from purchase invoice ${inv.number}`, { targetType: "relation", targetId: rel.id }, tx);
        }
        inv = await tx.purchaseInvoice.update({ where: { id: inv.id }, data: { supplierId: rel.id, supplierCountry: rel.country } });
      }

      const r = await bookPurchase(tx, { administrationId: A, invoiceId: inv.id, userId: ctx.userId, schedulePayment: schedule });
      await auditApp(ctx, "purchases.book", `Booked purchase ${inv.number} · ${inv.supplierName} · ${fmt.money(r.invoice.totalCents)}${schedule ? " · payment scheduled" : ""}`, { targetType: "purchase_invoice", targetId: inv.id }, tx);

      const amount = fmt.money(r.invoice.totalCents);
      const due = r.invoice.dueDate ? fmt.date(r.invoice.dueDate) : null;
      const parts: string[] = [];
      if (r.units && r.warehouse) parts.push(t("purchases.toast.stock", { n: fmt.int(r.units), warehouse: r.warehouse.name, kind: t(`purchases.kindStock.${r.warehouse.kind}`) }));
      parts.push(schedule ? t("purchases.toast.scheduled", { amount, date: due ?? t("purchases.today") }) : due ? t("purchases.toast.toPay", { amount, date: due }) : t("purchases.toast.toPayNoDate", { amount }));
      if (created) parts.push(t("purchases.toast.newSupplier", { name: created }));
      return { message: `${t("purchases.toast.booked")} · ${parts.join("; ")}.` };
    },
    { revalidate: PATHS },
  );
}

export async function deletePurchase(id: string) {
  let blob: StoredBlob | null = null;
  const res = await appAction(
    "purchases",
    async (ctx, tx) => {
      const { t } = await getI18n(ctx.locale);
      const inv = await tx.purchaseInvoice.findFirst({ where: { id, administrationId: ctx.administration.id } });
      if (!inv) throw new PostingError(t("purchases.err.notFound"));
      if (inv.status !== "TO_APPROVE") throw new PostingError(t("purchases.err.deleteBooked"));
      await tx.purchaseInvoice.delete({ where: { id: inv.id } });
      if (inv.documentId) blob = await deleteDocument(tx, ctx.administration.id, inv.documentId);
      await auditApp(ctx, "purchases.delete", `Deleted purchase invoice ${inv.number || "(unread)"} · ${inv.supplierName || "—"}`, { targetType: "purchase_invoice", targetId: inv.id }, tx);
      return { message: t("purchases.toast.deleted") };
    },
    { revalidate: PATHS },
  );
  if (res.ok && blob) await discardBlob(blob);
  return res;
}
