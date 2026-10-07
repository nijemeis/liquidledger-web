"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n/client";
import { uploadT1 } from "./actions";

/** A table row that opens the shipment drawer; inner links and buttons keep their own behaviour. */
export function RowLink({ href, cols, children, testId }: { href: string; cols: string; children: React.ReactNode; testId?: string }) {
  const router = useRouter();
  return (
    <div
      className="tbl-row"
      role="link"
      tabIndex={0}
      data-testid={testId}
      style={{ gridTemplateColumns: cols, gap: 12, padding: "12px 16px", cursor: "pointer" }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,[data-stop],.modal,.backdrop")) return;
        router.push(href, { scroll: false });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) router.push(href, { scroll: false });
      }}
    >
      {children}
    </div>
  );
}

export function T1Button({ shipmentId, shipmentRef, size = "sm" }: { shipmentId: string; shipmentRef: string; size?: "sm" | "md" }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <span data-stop="1">
      <button type="button" className={`btn btn-primary${size === "sm" ? " btn-sm" : ""}`} onClick={() => setOpen(true)}>
        <Icon name="UploadSimple" size={size === "sm" ? 15 : 16} />
        {t("shipments.uploadT1")}
      </button>
      {open ? <T1Modal shipmentId={shipmentId} shipmentRef={shipmentRef} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

export function T1Modal({ shipmentId, shipmentRef, onClose }: { shipmentId: string; shipmentRef: string; onClose: () => void }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [run, pending] = useAction(uploadT1, { onDone: (r) => (r.ok ? onClose() : setError(r.error)) });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("shipments.t1.title", { ref: shipmentRef })}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" type="submit" form="t1-form" disabled={pending}>
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="PaperPlaneTilt" size={16} />}
            {t("shipments.t1.confirm")}
          </button>
        </>
      }
    >
      <form
        id="t1-form"
        className="stack"
        style={{ textAlign: "left" }}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const f = new FormData(e.currentTarget);
          f.set("shipmentId", shipmentId);
          run(f);
        }}
      >
        <div style={{ fontSize: 13.5, color: "#3a4250" }}>{t("shipments.t1.intro", { ref: shipmentRef })}</div>
        <label className="field">
          {t("shipments.t1.file")}
          <input className="input" type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" required style={{ paddingTop: 6 }} />
        </label>
        <label className="field">
          {t("shipments.t1.mrn")}
          <input className="input n" name="mrn" required maxLength={40} placeholder={t("shipments.t1.mrnPh")} autoComplete="off" />
        </label>
        {error ? (
          <div className="banner banner-error">
            <Icon name="WarningCircle" size={17} />
            <div>{error}</div>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
