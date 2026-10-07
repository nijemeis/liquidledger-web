"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n/client";
import { UrlDrawer, useHref } from "../reports/_components/nav";
import { deleteCustomsDoc, saveCustomsDoc } from "./actions";

const TYPES = ["IMPORT_DECLARATION", "EXPORT_DECLARATION", "E_AD", "T1", "OTHER"] as const;
const STATUSES = ["DRAFT", "AWAITING", "ACCEPTED", "RELEASED", "MISSING", "REJECTED"] as const;

type Doc = { id: string; type: string; reference: string; shipmentId: string; status: string; notes: string; invoice: string | null; file: { id: string; name: string } | null };

export function CustomsDocDrawer({ doc, shipments }: { doc: Doc | null; shipments: { id: string; label: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const href = useHref();
  const close = () => router.push(href({ doc: null }), { scroll: false });
  const [f, setF] = useState({ type: doc?.type ?? "T1", reference: doc?.reference ?? "", shipmentId: doc?.shipmentId ?? "", status: doc?.status ?? "AWAITING", notes: doc?.notes ?? "" });
  const [fileName, setFileName] = useState<string | null>(null);
  const [save, saving] = useAction(saveCustomsDoc, { onDone: (r) => r.ok && close() });
  const [del, deleting] = useAction(deleteCustomsDoc, { onDone: (r) => r.ok && close() });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <UrlDrawer
      close={["doc"]}
      width={520}
      title={doc ? t(`excise.docType.${doc.type}`) : t("excise.addDoc")}
      subtitle={doc?.reference || (doc?.invoice ? t("excise.fromInvoice", { number: doc.invoice }) : undefined)}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, width: "100%" }}>
          <div>
            {doc ? (
              <button type="button" className="btn btn-ghost" style={{ color: "#b42318" }} disabled={deleting} onClick={() => confirm(t("excise.confirmDelete")) && del({ id: doc.id })}>
                <Icon name="Trash" size={16} />
                {t("common.delete")}
              </button>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={close}>
              {t("common.cancel")}
            </button>
            <button type="submit" form="customs-doc" className="btn btn-primary" disabled={saving}>
              {saving ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Check" size={16} />}
              {t("common.save")}
            </button>
          </div>
        </div>
      }
    >
      <form
        id="customs-doc"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          if (doc) fd.set("id", doc.id);
          for (const [k, v] of Object.entries(f)) fd.set(k, v);
          void save(fd);
        }}
      >
        {doc?.invoice ? (
          <div className="banner banner-info">
            <Icon name="Info" size={17} style={{ marginTop: 1 }} />
            <div>{t("excise.draftedInfo", { number: doc.invoice })}</div>
          </div>
        ) : null}
        <div className="form-grid">
          <label className="field">
            {t("excise.f.type")}
            <select className="select" value={f.type} onChange={set("type")}>
              {TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`excise.docType.${x}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("common.status")}
            <select className="select" value={f.status} onChange={set("status")}>
              {STATUSES.map((x) => (
                <option key={x} value={x}>
                  {t(`excise.docStatus.${x}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          {t("excise.f.reference")}
          <input className="input n" value={f.reference} onChange={set("reference")} placeholder={f.type === "E_AD" ? "ARC 26NL…" : "MRN 26NL…"} maxLength={80} />
          <span className="field-label">{t("excise.f.referenceHint")}</span>
        </label>
        <label className="field">
          {t("excise.f.shipment")}
          <select className="select" value={f.shipmentId} onChange={set("shipmentId")}>
            <option value="">{t("excise.f.noShipment")}</option>
            {shipments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          {t("excise.f.file")}
          {doc?.file ? (
            <a href={`/api/documents/${doc.file.id}`} target="_blank" rel="noopener noreferrer" className="infobox" style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, textDecoration: "none", color: "inherit" }}>
              <Icon name="Paperclip" size={16} />
              <span className="truncate" style={{ flex: 1 }}>{doc.file.name}</span>
              <Icon name="ArrowSquareOut" size={15} color="#5b6474" />
            </a>
          ) : null}
          <label className="btn btn-sm" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
            <Icon name="UploadSimple" size={15} />
            {fileName ?? (doc?.file ? t("excise.f.replaceFile") : t("excise.f.addFile"))}
            <input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" style={{ display: "none" }} onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} />
          </label>
          <span className="field-label">{t("excise.f.fileHint")}</span>
        </div>
        <label className="field">
          {t("excise.f.notes")}
          <textarea className="textarea" value={f.notes} onChange={set("notes")} maxLength={500} />
        </label>
      </form>
    </UrlDrawer>
  );
}
