"use server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { appAction, auditApp, canEditIn, getAppContext } from "@/lib/app-context";
import { cleanFilename, createDocument, deleteDocument, discardBlob, DocumentError, putBlob, validateUpload, type StoredBlob } from "@/lib/documents/storage";
import { getI18n } from "@/i18n/server";
import { PostingError } from "@/lib/domain/ledger";
import { dueDateFor, exciseReturn, markFiled, parsePeriod } from "@/lib/domain/returns";
import { makeFormatters } from "@/lib/format";

const FileInput = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), reference: z.string().trim().min(3).max(80) });

/** Record the excise return as filed in the Customs portal (we don't submit it ourselves yet). */
export async function fileExcise(input: { period: string; reference: string }) {
  return appAction("fileExcise", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const parsed = FileInput.safeParse(input);
    if (!parsed.success) throw new PostingError(t("excise.err.reference"));
    const p = parsePeriod(parsed.data.period);
    if (!p) throw new PostingError(t("excise.err.period"));
    const today = new Date();
    if (p.end.getTime() >= Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) throw new PostingError(t("excise.err.notEnded"));
    const A = ctx.administration.id;
    const ret = await exciseReturn(tx, A, p);
    const before = ret.filed?.status === "FILED" ? ret.filed.filedRef : null;
    const rec = await markFiled(tx, {
      administrationId: A,
      type: "EXCISE",
      period: p,
      boxes: {
        rows: ret.rows.map((r) => ({ sku: r.sku, name: r.name, category: r.category, units: r.units, hl: r.hl, basis: r.basis, exciseCents: r.exciseCents })),
        releasedUnits: ret.releasedUnits,
        shippedSuspendedUnits: ret.shippedSuspendedUnits,
        licence: ret.licence,
      },
      totalCents: ret.totalCents,
      reference: parsed.data.reference,
      userId: ctx.userId ?? "",
    });
    const en = makeFormatters("en");
    await auditApp(
      ctx,
      "excise.file",
      before
        ? `Excise return ${p.key}: filing reference changed from ${before} to ${parsed.data.reference}`
        : `Excise return ${p.key} recorded as filed with Customs · ${en.money(ret.totalCents)} · ref ${parsed.data.reference}`,
      { targetType: "tax_return", targetId: rec.id, before: before ? { filedRef: before } : undefined, after: { period: p.key, totalCents: ret.totalCents, filedRef: parsed.data.reference } },
      tx,
    );
    return {
      message: before
        ? t("excise.toast.refChanged", { ref: parsed.data.reference })
        : t("excise.toast.filed", { period: fmt.monthLong(p.start), amount: fmt.money(ret.totalCents), date: fmt.dateMed(dueDateFor(p)), ref: parsed.data.reference }),
    };
  });
}

const DocInput = z.object({
  id: z.string().optional(),
  type: z.enum(["IMPORT_DECLARATION", "EXPORT_DECLARATION", "E_AD", "T1", "OTHER"]),
  reference: z.string().trim().max(80).optional().default(""),
  shipmentId: z.string().optional().default(""),
  status: z.enum(["DRAFT", "AWAITING", "ACCEPTED", "RELEASED", "MISSING", "REJECTED"]),
  notes: z.string().trim().max(500).optional().default(""),
});

/** Add or edit a customs document; an attached file (PDF/photo) is stored as a document. */
export async function saveCustomsDoc(form: FormData) {
  const ctx = await getAppContext();
  const { t } = await getI18n(ctx?.locale);
  const parsed = DocInput.safeParse({
    id: form.get("id") || undefined,
    type: form.get("type"),
    reference: form.get("reference") ?? "",
    shipmentId: form.get("shipmentId") ?? "",
    status: form.get("status"),
    notes: form.get("notes") ?? "",
  });
  if (!parsed.success) return { ok: false as const, error: t("excise.err.doc") };
  const file = form.get("file");
  let upload: { filename: string; bytes: Uint8Array; mime: string; sha256: string; blob: StoredBlob } | null = null;
  if (file instanceof File && file.size > 0) {
    if (!ctx || !canEditIn(ctx, "customs")) return { ok: false as const, error: t("common.notAllowed") };
    const filename = cleanFilename(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const check = validateUpload(bytes, filename);
      const blob = await putBlob(ctx.administration.id, bytes, check.mime);
      upload = { filename, bytes, mime: check.mime, sha256: check.sha256, blob };
    } catch (e) {
      if (e instanceof DocumentError) return { ok: false as const, error: t(`excise.err.file.${e.code}`, { file: filename }) };
      console.error("[customs.upload] storage", e);
      return { ok: false as const, error: t("excise.err.file.storage", { file: filename }) };
    }
  }
  let oldBlob: StoredBlob | null = null;
  const res = await appAction("customs", async (ctx, tx) => {
    const d = parsed.data;
    const A = ctx.administration.id;
    if (d.shipmentId) {
      const s = await tx.shipment.findFirst({ where: { id: d.shipmentId, administrationId: A } });
      if (!s) throw new PostingError(t("excise.err.shipment"));
    }
    if ((d.status === "ACCEPTED" || d.status === "RELEASED") && !d.reference) throw new PostingError(t("excise.err.refNeeded"));
    const data: Prisma.CustomsDocumentUncheckedUpdateInput = { type: d.type, reference: d.reference || null, shipmentId: d.shipmentId || null, status: d.status, notes: d.notes || null };
    if (upload) {
      const doc = await createDocument(tx, { administrationId: A, kind: "customs", filename: upload.filename, mime: upload.mime, size: upload.bytes.length, sha256: upload.sha256, blob: upload.blob, uploadedById: ctx.userId });
      data.documentId = doc.id;
    }
    const typeLabel = t(`excise.docType.${d.type}`);
    const fileNote = upload ? ` · file ${upload.filename}` : "";
    if (d.id) {
      const prev = await tx.customsDocument.findFirst({ where: { id: d.id, administrationId: A } });
      if (!prev) throw new PostingError(t("excise.err.notFound"));
      await tx.customsDocument.update({ where: { id: prev.id }, data });
      if (upload && prev.documentId) oldBlob = await deleteDocument(tx, A, prev.documentId);
      await auditApp(ctx, "customs.document.update", `Updated ${d.type} ${d.reference || "(no reference)"} · ${prev.status} → ${d.status}${fileNote}`, { targetType: "customs_document", targetId: prev.id, before: { reference: prev.reference, status: prev.status }, after: { ...data, file: upload?.filename } as object }, tx);
      return { message: t(upload ? "excise.toast.docSavedFile" : "excise.toast.docSaved", { type: typeLabel, status: t(`excise.docStatus.${d.status}`), file: upload?.filename ?? "" }) };
    }
    const doc = await tx.customsDocument.create({ data: { ...(data as Prisma.CustomsDocumentUncheckedCreateInput), administrationId: A } });
    await auditApp(ctx, "customs.document.create", `Added ${d.type} ${d.reference || "(no reference)"} · ${d.status}${fileNote}`, { targetType: "customs_document", targetId: doc.id, after: { ...data, file: upload?.filename } as object }, tx);
    return { message: t("excise.toast.docAdded", { type: typeLabel }) };
  });
  if (!res.ok && upload) await discardBlob(upload.blob);
  if (res.ok && oldBlob) await discardBlob(oldBlob);
  return res;
}

export async function deleteCustomsDoc(input: { id: string }) {
  let blob: StoredBlob | null = null;
  const res = await appAction("customs", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const prev = await tx.customsDocument.findFirst({ where: { id: String(input.id), administrationId: ctx.administration.id } });
    if (!prev) throw new PostingError(t("excise.err.notFound"));
    await tx.customsDocument.delete({ where: { id: prev.id } });
    if (prev.documentId) blob = await deleteDocument(tx, ctx.administration.id, prev.documentId);
    await auditApp(ctx, "customs.document.delete", `Removed ${prev.type} ${prev.reference ?? "(no reference)"}`, { targetType: "customs_document", targetId: prev.id, before: { type: prev.type, reference: prev.reference, status: prev.status } }, tx);
    return { message: t("excise.toast.docDeleted", { type: t(`excise.docType.${prev.type}`) }) };
  });
  if (res.ok && blob) await discardBlob(blob);
  return res;
}
