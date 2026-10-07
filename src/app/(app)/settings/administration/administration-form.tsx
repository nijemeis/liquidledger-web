"use client";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";
import { Modal, SubmitButton, useAction } from "@/components/client";
import { deleteAdministration, updateAdministration, type AdministrationInput } from "./actions";

type Values = {
  legalName: string;
  addressLine: string;
  postcode: string;
  city: string;
  email: string;
  cocNumber: string;
  vatNumber: string;
  iban: string;
  exciseLicenceNo: string;
  exciseAuthority: string;
  vatPeriod: "MONTHLY" | "QUARTERLY";
  invoicePrefix: string;
  ledgerLanguage: "nl" | "en";
  fiscalYearStart: number;
};

export function AdministrationForm({ initial, canEdit, months, vatExample }: { initial: Values; canEdit: boolean; months: { value: number; label: string }[]; vatExample: string }) {
  const { t } = useI18n();
  const [v, setV] = useState(initial);
  const [run, pending] = useAction(updateAdministration);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const text = (k: keyof Values, label: string, opts: { placeholder?: string; hint?: string; wide?: boolean; mono?: boolean; type?: string } = {}) => (
    <label className="field" style={opts.wide ? { gridColumn: "1 / -1" } : undefined}>
      {label}
      <input
        className={`input${opts.mono ? " n" : ""}`}
        type={opts.type ?? "text"}
        value={v[k] as string}
        disabled={!canEdit}
        placeholder={opts.placeholder}
        onChange={(e) => setV({ ...v, [k]: e.target.value })}
      />
      {opts.hint ? <span className="field-label">{opts.hint}</span> : null}
    </label>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(v as AdministrationInput);
      }}
      style={{ display: "flex", flexDirection: "column", gap: 18 }}
    >
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="section-label" style={{ fontWeight: 600, color: "#14171f", fontSize: 13.5, marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid #eef0f3" }}>{t("settings.admin.company")}</div>
        <div className="form-grid">
          {text("legalName", t("settings.admin.legalName"), { wide: true })}
          {text("addressLine", t("settings.admin.address"), { wide: true })}
          {text("postcode", t("settings.admin.postcode"))}
          {text("city", t("settings.admin.city"))}
          {text("email", t("settings.admin.email"), { type: "email", hint: t("settings.admin.emailHint") })}
        </div>
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="section-label" style={{ fontWeight: 600, color: "#14171f", fontSize: 13.5, marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid #eef0f3" }}>{t("settings.admin.registration")}</div>
        <div className="form-grid">
          {text("cocNumber", t("settings.admin.coc"), { mono: true })}
          {text("vatNumber", t("settings.admin.vatNumber"), { mono: true, placeholder: vatExample })}
          {text("iban", t("settings.admin.iban"), { mono: true, placeholder: "NL00 BANK 0123 4567 89" })}
          {text("exciseLicenceNo", t("settings.admin.exciseLicence"), { mono: true })}
          {text("exciseAuthority", t("settings.admin.exciseAuthority"))}
        </div>
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="section-label" style={{ fontWeight: 600, color: "#14171f", fontSize: 13.5, marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid #eef0f3" }}>{t("settings.admin.bookkeeping")}</div>
        <div className="form-grid">
          <label className="field">
            {t("settings.admin.vatPeriod")}
            <select className="select" value={v.vatPeriod} disabled={!canEdit} onChange={(e) => setV({ ...v, vatPeriod: e.target.value as Values["vatPeriod"] })}>
              <option value="MONTHLY">{t("settings.admin.monthly")}</option>
              <option value="QUARTERLY">{t("settings.admin.quarterly")}</option>
            </select>
          </label>
          {text("invoicePrefix", t("settings.admin.invoicePrefix"), { mono: true, hint: t("settings.admin.invoicePrefixHint", { example: `${v.invoicePrefix || "INV"}-2026-0042` }) })}
          <label className="field">
            {t("settings.admin.ledgerLanguage")}
            <select className="select" value={v.ledgerLanguage} disabled={!canEdit} onChange={(e) => setV({ ...v, ledgerLanguage: e.target.value as Values["ledgerLanguage"] })}>
              <option value="nl">Nederlands</option>
              <option value="en">English</option>
            </select>
            <span className="field-label">{t("settings.admin.ledgerLanguageHint")}</span>
          </label>
          <label className="field">
            {t("settings.admin.fiscalYearStart")}
            <select className="select" value={v.fiscalYearStart} disabled={!canEdit} onChange={(e) => setV({ ...v, fiscalYearStart: Number(e.target.value) })}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
      {canEdit ? (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" disabled={!dirty || pending} onClick={() => setV(initial)}>
            {t("common.cancel")}
          </button>
          <SubmitButton pending={pending} disabled={!dirty} icon="Check">
            {t("common.save")}
          </SubmitButton>
        </div>
      ) : null}
    </form>
  );
}

export function DangerZone({ legalName, canDelete }: { legalName: string; canDelete: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [run, pending] = useAction(deleteAdministration, {
    refresh: false,
    onDone: (r) => {
      if (r.ok) window.location.href = "/login";
    },
  });
  return (
    <section className="card card-pad">
      <div className="card-title" style={{ marginBottom: 4 }}>{t("settings.admin.data")}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "12px 0", borderBottom: "1px solid #eef0f3" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 500 }}>{t("settings.admin.export")}</div>
          <div className="muted" style={{ fontSize: 13 }}>{t("settings.admin.exportText")}</div>
        </div>
        <form method="post" action="/api/me/export">
          <button className="btn" type="submit">
            <Icon name="DownloadSimple" size={16} />
            {t("settings.admin.exportBtn")}
          </button>
        </form>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", paddingTop: 12 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 500, color: "#b42318" }}>{t("settings.admin.delete")}</div>
          <div className="muted" style={{ fontSize: 13 }}>{t("settings.admin.deleteText")}</div>
        </div>
        <button className="btn btn-danger" disabled={!canDelete} onClick={() => setOpen(true)}>
          <Icon name="Trash" size={16} />
          {t("settings.admin.deleteBtn")}
        </button>
      </div>
      {open ? (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={t("settings.admin.deleteTitle")}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
              <button className="btn btn-primary" style={{ background: "#b42318", borderColor: "#b42318" }} disabled={pending || confirm.trim() !== legalName} onClick={() => run({ confirm })}>
                {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Trash" size={16} />}
                {t("settings.admin.deleteBtn")}
              </button>
            </>
          }
        >
          <div className="banner banner-error">
            <Icon name="Warning" size={17} />
            {t("settings.admin.deleteWarning")}
          </div>
          <label className="field">
            {t("settings.admin.deleteConfirm", { name: legalName })}
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus autoComplete="off" />
          </label>
        </Modal>
      ) : null}
    </section>
  );
}
