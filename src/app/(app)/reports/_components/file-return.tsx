"use client";
// "File with Customs" / "Submit return". Liquid Ledger can't submit to the
// authorities itself yet (Digipoort / EMCS are later milestones), so this says
// so plainly, shows the figures to enter in the official portal, offers the
// return as CSV and records the reference the user received.
import { useState } from "react";
import { Modal, useAction, type ActionResult } from "@/components/client";
import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n/client";

export interface Figure {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
  section?: boolean;
}

export function FileReturn({
  kind,
  period,
  periodLabel,
  filed,
  canFile,
  ended,
  figures,
  csvHref,
  authority,
  portal,
  action,
}: {
  kind: "excise" | "vat";
  period: string;
  periodLabel: string;
  filed: { ref: string; at: string; by?: string } | null;
  canFile: boolean;
  ended: boolean;
  figures: Figure[];
  csvHref: string;
  authority: string;
  portal: { name: string; url: string };
  action: (input: { period: string; reference: string }) => Promise<ActionResult>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [run, pending] = useAction(action, { onDone: (r) => r.ok && (setOpen(false), setRef("")) });
  const k = (s: string) => t(`reports.filing.${kind}.${s}`);
  const blockedReason = !canFile ? t("reports.filing.noPermission") : !ended ? t("reports.filing.notEnded") : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ref.trim()) void run({ period, reference: ref.trim() });
  };

  return (
    <>
      {filed ? (
        <button type="button" className="btn" onClick={() => setOpen(true)} style={{ borderColor: "#bfe5cf", color: "#157347", background: "#f3fbf6" }}>
          <Icon name="CheckCircle" size={16} weight="fill" />
          {k("filedLabel")} · {filed.ref}
        </button>
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} disabled={!canFile} title={!canFile ? t("reports.filing.noPermission") : undefined}>
          <Icon name="PaperPlaneTilt" size={16} />
          {k("button")}
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={600}
        title={t(`reports.filing.${kind}.${filed ? "filedTitle" : "title"}`, { period: periodLabel })}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, width: "100%" }}>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              {t("common.close")}
            </button>
            {canFile && (filed || ended) ? (
              <button type="submit" form={`file-${kind}`} className="btn btn-primary" disabled={pending || !ref.trim()}>
                {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="CheckCircle" size={16} />}
                {filed ? t("reports.filing.saveRef") : t("reports.filing.record")}
              </button>
            ) : null}
          </div>
        }
      >
        {filed ? (
          <div className="banner banner-ok">
            <Icon name="CheckCircle" size={17} style={{ marginTop: 1 }} />
            <div>{t("reports.filing.recorded", { date: filed.at, ref: filed.ref, by: filed.by ?? "—" })}</div>
          </div>
        ) : (
          <div className="banner banner-info">
            <Icon name="Info" size={17} style={{ marginTop: 1 }} />
            <div>{t("reports.filing.notYet", { authority, portal: portal.name })}</div>
          </div>
        )}

        {!filed ? (
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, color: "#3a4250", display: "flex", flexDirection: "column", gap: 4 }}>
            <li>{t("reports.filing.step1")}</li>
            <li>{t("reports.filing.step2", { portal: portal.name })}</li>
            <li>{t("reports.filing.step3")}</li>
          </ol>
        ) : null}

        <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "8px 14px", fontSize: 12, fontWeight: 500, color: "#5b6474", background: "#f9fafb", borderBottom: "1px solid #e4e7ec", display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>{k("figures")}</span>
            <span>{periodLabel}</span>
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {figures.map((f, i) =>
              f.section ? (
                <div key={i} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#5b6474", background: "#fcfcfd", borderBottom: "1px solid #f0f2f5" }}>
                  {f.label}
                </div>
              ) : (
                <div key={i} className="n" style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 14px", fontSize: 13.5, borderBottom: "1px solid #f0f2f5", fontWeight: f.strong ? 600 : 400, background: f.strong ? "#f8e9ee" : undefined, color: f.strong ? "#7a1f3d" : undefined }}>
                  <span style={{ minWidth: 0 }}>
                    {f.label}
                    {f.sub ? <span style={{ color: "#8a93a3", fontSize: 12.5 }}> · {f.sub}</span> : null}
                  </span>
                  <span style={{ whiteSpace: "nowrap" }}>{f.value}</span>
                </div>
              ),
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn btn-sm" href={csvHref} download>
            <Icon name="DownloadSimple" size={15} />
            {t("reports.filing.download")}
          </a>
          <a className="btn btn-sm" href={portal.url} target="_blank" rel="noopener noreferrer">
            <Icon name="ArrowSquareOut" size={15} />
            {t("reports.filing.openPortal", { portal: portal.name })}
          </a>
        </div>

        {blockedReason && !filed ? (
          <div className="banner banner-warn">
            <Icon name="Warning" size={17} style={{ marginTop: 1 }} />
            <div>{blockedReason}</div>
          </div>
        ) : canFile ? (
          <form id={`file-${kind}`} onSubmit={submit}>
            <label className="field">
              {filed ? t("reports.filing.correctRef") : k("refLabel")}
              <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={k("refPlaceholder")} maxLength={80} autoFocus={!filed} />
              <span className="field-label">{k("refHint")}</span>
            </label>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
