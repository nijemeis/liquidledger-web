"use server";
import { z } from "zod";
import type { ShipmentStage } from "@prisma/client";
import { appAction, auditApp, getAppContext, type AppContext } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { PostingError } from "@/lib/domain/ledger";
import { transferStock } from "@/lib/domain/stock";
import { canEdit, seesFinancials } from "@/lib/permissions";
import { cleanFilename, createDocument, discardBlob, DocumentError, MAX_DOCUMENT_BYTES, putBlob, sniffType, validateUpload } from "@/lib/documents/storage";
import type { Tx } from "@/lib/db";
import { nextShipmentRef, pendingArrival, STAGES } from "./arrival";

const id = z.string().min(1).max(40);
const opt = (max: number) => z.string().trim().max(max).optional().default("");

async function getShipment(tx: Tx, ctx: AppContext, shipmentId: string) {
  const s = await tx.shipment.findFirst({ where: { id: shipmentId, administrationId: ctx.administration.id } });
  if (!s) {
    const { t } = await getI18n(ctx.locale);
    throw new PostingError(t("shipments.err.notFound"));
  }
  return s;
}

function todayUtc() {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

const ShipmentInput = z.object({
  id: z.string().max(40).optional().default(""),
  ref: opt(30),
  direction: z.enum(["IMPORT", "EXPORT", "EU", "DOMESTIC"]),
  origin: z.string().trim().min(1).max(80),
  destination: z.string().trim().min(1).max(80),
  mode: z.string().trim().min(1).max(80),
  goods: z.string().trim().min(1).max(160),
  eta: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional().default(""),
  relationId: opt(40),
  notes: opt(2000),
});

/** Create or edit an order / shipment. */
export async function saveShipment(input: z.input<typeof ShipmentInput>) {
  return appAction("customs", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const p = ShipmentInput.safeParse(input);
    if (!p.success) throw new PostingError(t("shipments.err.required"));
    const d = p.data;
    const A = ctx.administration.id;
    const relationId = d.relationId ? ((await tx.relation.findFirst({ where: { id: d.relationId, administrationId: A }, select: { id: true } }))?.id ?? null) : null;
    const eta = d.eta ? new Date(`${d.eta}T00:00:00Z`) : null;
    const data = { direction: d.direction, origin: d.origin, destination: d.destination, mode: d.mode, goods: d.goods, eta, relationId, notes: d.notes || null };
    const route = `${d.origin} → ${d.destination}`;

    if (d.id) {
      const s = await getShipment(tx, ctx, d.id);
      const ref = d.ref ? d.ref.toUpperCase() : s.ref;
      if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(ref)) throw new PostingError(t("shipments.err.ref"));
      if (ref !== s.ref && (await tx.shipment.findFirst({ where: { administrationId: A, ref } }))) throw new PostingError(t("shipments.err.duplicate", { ref }));
      await tx.shipment.update({ where: { id: s.id }, data: { ...data, ref } });
      await auditApp(ctx, "shipment.update", `Edited shipment ${ref} · ${route}`, { targetType: "shipment", targetId: s.id, before: { ref: s.ref, origin: s.origin, destination: s.destination, eta: s.eta, goods: s.goods }, after: { ref, ...data } }, tx);
      return { message: t("shipments.toast.saved", { ref }), id: s.id };
    }

    const ref = d.ref ? d.ref.toUpperCase() : await nextShipmentRef(tx, A);
    if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(ref)) throw new PostingError(t("shipments.err.ref"));
    if (await tx.shipment.findFirst({ where: { administrationId: A, ref } })) throw new PostingError(t("shipments.err.duplicate", { ref }));
    const s = await tx.shipment.create({ data: { administrationId: A, ref, ...data, stage: "BOOKED", stageNote: t("shipments.defaultNote.BOOKED") } });
    await auditApp(ctx, "shipment.create", `Created shipment ${ref} · ${d.direction} · ${route}`, { targetType: "shipment", targetId: s.id, after: { ref, ...data } }, tx);
    return { message: t("shipments.toast.created", { ref, route }), id: s.id };
  });
}

const StageInput = z.object({ id, stage: z.enum(STAGES), note: opt(120) });

/** Move a shipment to a stage (next stage, or any stage set by hand). */
export async function setShipmentStage(input: z.input<typeof StageInput>) {
  return appAction("customs", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const p = StageInput.safeParse(input);
    if (!p.success) throw new PostingError(t("shipments.err.notFound"));
    const s = await getShipment(tx, ctx, p.data.id);
    const stage = p.data.stage as ShipmentStage;
    const note = p.data.note || t(`shipments.defaultNote.${stage}`);
    await tx.shipment.update({ where: { id: s.id }, data: { stage, stageNote: note } });
    await auditApp(ctx, "shipment.stage", `${s.ref}: stage ${s.stage} → ${stage} · ${note}`, { targetType: "shipment", targetId: s.id, before: { stage: s.stage, stageNote: s.stageNote }, after: { stage, stageNote: note } }, tx);
    if (stage === "ARRIVED" && s.direction === "IMPORT") {
      const pending = await pendingArrival(tx, ctx.administration.id, s.id, ctx.administration.country);
      const n = pending.reduce((a, l) => a + l.qty, 0);
      if (n) return { message: t("shipments.toast.stageArrival", { ref: s.ref, n: fmt.int(n) }) };
    }
    return { message: t("shipments.toast.stage", { ref: s.ref, stage: t(`shipments.stage.${stage}`) }) };
  });
}

const BlockInput = z.object({ id, reason: z.string().trim().min(2).max(120) });

export async function blockShipment(input: z.input<typeof BlockInput>) {
  return appAction("customs", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const p = BlockInput.safeParse(input);
    if (!p.success) throw new PostingError(t("shipments.err.reason"));
    const s = await getShipment(tx, ctx, p.data.id);
    const note = t("shipments.held", { reason: p.data.reason });
    await tx.shipment.update({ where: { id: s.id }, data: { blocked: true, blockReason: p.data.reason, stageNote: note } });
    await auditApp(ctx, "shipment.block", `${s.ref} held · ${p.data.reason}`, { targetType: "shipment", targetId: s.id, after: { blocked: true, blockReason: p.data.reason } }, tx);
    return { message: t("shipments.toast.blocked", { ref: s.ref, reason: p.data.reason }) };
  });
}

export async function unblockShipment(input: { id: string }) {
  return appAction("customs", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const s = await getShipment(tx, ctx, String(input?.id ?? ""));
    await tx.shipment.update({ where: { id: s.id }, data: { blocked: false, blockReason: null, stageNote: t(`shipments.defaultNote.${s.stage}`) } });
    await auditApp(ctx, "shipment.unblock", `${s.ref} released · hold "${s.blockReason ?? ""}" removed`, { targetType: "shipment", targetId: s.id, before: { blocked: s.blocked, blockReason: s.blockReason }, after: { blocked: false } }, tx);
    return { message: t("shipments.toast.unblocked", { ref: s.ref }) };
  });
}

/**
 * Upload the T1 transit document and its MRN: stores the file, marks the T1 as
 * accepted and releases the held shipment.
 */
export async function uploadT1(form: FormData) {
  const ctx = await getAppContext();
  const { t } = await getI18n(ctx?.locale);
  const shipmentId = String(form.get("shipmentId") ?? "");
  const mrn = String(form.get("mrn") ?? "").toUpperCase().replace(/^\s*MRN\s*/, "").replace(/\s+/g, "");
  const file = form.get("file");
  if (!ctx) return { ok: false as const, error: "Your session has ended. Sign in again." };
  if (!/^[A-Z0-9]{8,30}$/.test(mrn)) return { ok: false as const, error: t("shipments.err.mrn") };
  if (!(file instanceof File) || !file.size) return { ok: false as const, error: t("shipments.err.file") };
  const filename = cleanFilename(file.name || "T1.pdf");
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false as const, error: t("shipments.err.fileSize", { name: filename }) };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffType(bytes)) return { ok: false as const, error: t("shipments.err.fileType", { name: filename }) };
  let meta: { mime: string; sha256: string };
  try {
    meta = validateUpload(bytes, filename);
  } catch (e) {
    return { ok: false as const, error: e instanceof DocumentError ? e.message : t("shipments.err.file") };
  }
  if (ctx.readOnly || !canEdit(ctx.role, "customs")) return { ok: false as const, error: "Your role doesn't allow this change." };

  const blob = await putBlob(ctx.administration.id, bytes, meta.mime);
  const reference = `MRN ${mrn}`;
  const res = await appAction("customs", async (ctx, tx) => {
    const A = ctx.administration.id;
    const s = await getShipment(tx, ctx, shipmentId);
    const doc = await createDocument(tx, { administrationId: A, kind: "customs", filename, mime: meta.mime, size: bytes.length, sha256: meta.sha256, blob, uploadedById: ctx.userId });
    const existing = await tx.customsDocument.findFirst({ where: { administrationId: A, shipmentId: s.id, type: "T1" }, orderBy: { createdAt: "desc" } });
    const cd = existing
      ? await tx.customsDocument.update({ where: { id: existing.id }, data: { reference, status: "ACCEPTED", documentId: doc.id } })
      : await tx.customsDocument.create({ data: { administrationId: A, type: "T1", reference, shipmentId: s.id, status: "ACCEPTED", documentId: doc.id, notes: `${s.goods}, ${s.origin}` } });
    const note = t("shipments.t1.released");
    await tx.shipment.update({ where: { id: s.id }, data: { blocked: false, blockReason: null, stageNote: note, eta: s.eta ?? todayUtc() } });
    await auditApp(ctx, "customs.t1", `T1 for ${s.ref} uploaded · ${reference} · ${filename}`, { targetType: "customs_document", targetId: cd.id, before: existing ? { status: existing.status, reference: existing.reference } : undefined, after: { status: "ACCEPTED", reference, documentId: doc.id } }, tx);
    await auditApp(ctx, "shipment.unblock", `${s.ref} released after T1 upload`, { targetType: "shipment", targetId: s.id, before: { blocked: s.blocked, blockReason: s.blockReason }, after: { blocked: false, stageNote: note } }, tx);
    return { message: t("shipments.toast.t1", { ref: s.ref }) };
  });
  if (!res.ok) await discardBlob(blob);
  return res;
}

const ArrivalInput = z.object({ id, warehouseId: id });

/** Move an import shipment's units from In transit into the warehouse they arrived in. */
export async function bookArrival(input: z.input<typeof ArrivalInput>) {
  return appAction("customs", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    if (!canEdit(ctx.role, "stock")) throw new PostingError("Your role doesn't allow this change.");
    const p = ArrivalInput.safeParse(input);
    if (!p.success) throw new PostingError(t("shipments.err.warehouse"));
    const A = ctx.administration.id;
    const s = await getShipment(tx, ctx, p.data.id);
    if (s.stage !== "ARRIVED") throw new PostingError(t("shipments.err.notArrived"));
    const wh = await tx.warehouse.findFirst({ where: { id: p.data.warehouseId, administrationId: A, archivedAt: null } });
    if (!wh || wh.kind === "IN_TRANSIT") throw new PostingError(t("shipments.err.warehouse"));
    const lines = await pendingArrival(tx, A, s.id, ctx.administration.country);
    if (!lines.length) throw new PostingError(t("shipments.err.noArrival"));
    const fromNames = await tx.warehouse.findMany({ where: { administrationId: A, id: { in: [...new Set(lines.map((l) => l.fromWarehouseId))] } }, select: { name: true } });
    let n = 0, excise = 0;
    for (const l of lines) {
      const r = await transferStock(tx, {
        administrationId: A,
        productId: l.productId,
        fromWarehouseId: l.fromWarehouseId,
        toWarehouseId: wh.id,
        qty: l.qty,
        country: ctx.administration.country,
        createdById: ctx.userId,
        documentType: "shipment",
        documentId: s.id,
        documentRef: s.ref,
        note: `Arrival ${s.ref}`,
      });
      n += l.qty;
      excise += r.exciseCents;
    }
    await tx.shipment.update({ where: { id: s.id }, data: { stageNote: t("shipments.defaultNote.ARRIVED_STOCK") } });
    await auditApp(
      ctx,
      "shipment.arrival",
      `${s.ref} arrival booked · ${n} bottles from ${fromNames.map((w) => w.name).join(", ")} to ${wh.name}${excise ? ` · excise €${(excise / 100).toFixed(2)} payable` : ""}`,
      { targetType: "shipment", targetId: s.id, after: { warehouse: wh.name, units: n, exciseCents: excise, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })) } },
      tx,
    );
    const vars = { n: fmt.int(n), ref: s.ref, wh: wh.name, from: fromNames.map((w) => w.name).join(", "), amount: fmt.money(excise) };
    const message = wh.kind === "DUTY_PAID" ? (excise && seesFinancials(ctx.role) ? t("shipments.toast.arrivalExcise", vars) : t("shipments.toast.arrivalRelease", vars)) : t("shipments.toast.arrival", vars);
    return { message };
  });
}
