"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Relation } from "@prisma/client";
import { useI18n } from "@/i18n/client";
import { Drawer, useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { checkViesNumber, saveRelation, setArchived } from "./actions";

export type RelationData = Omit<Relation, "viesCheckedAt" | "archivedAt" | "createdAt"> & {
  viesCheckedAt: string | null;
  archived: boolean;
  invoices: { id: string; kind: "sales" | "purchase"; number: string; date: string; total: string; status: string }[];
};

type Form = {
  kind: "CUSTOMER" | "SUPPLIER" | "BOTH";
  name: string;
  typeLabel: string;
  country: string;
  addressLine: string;
  postcode: string;
  city: string;
  email: string;
  phone: string;
  vatNumber: string;
  exciseStatus: string;
  exciseNumber: string;
  paymentTermsDays: string;
  defaultPriceList: string;
  taxRegimeOverride: "" | "DOMESTIC" | "EU_B2B" | "EXPORT";
  iban: string;
  notes: string;
};

function toForm(r: RelationData | null, kind: Form["kind"], country: string): Form {
  return {
    kind: r?.kind ?? kind,
    name: r?.name ?? "",
    typeLabel: r?.typeLabel ?? "",
    country: r?.country ?? country,
    addressLine: r?.addressLine ?? "",
    postcode: r?.postcode ?? "",
    city: r?.city ?? "",
    email: r?.email ?? "",
    phone: r?.phone ?? "",
    vatNumber: r?.vatNumber ?? "",
    exciseStatus: r?.exciseStatus ?? "",
    exciseNumber: r?.exciseNumber ?? "",
    paymentTermsDays: String(r?.paymentTermsDays ?? (kind === "SUPPLIER" ? 30 : 14)),
    defaultPriceList: r?.defaultPriceList ?? "",
    taxRegimeOverride: r?.taxRegimeOverride ?? "",
    iban: r?.iban ?? "",
    notes: r?.notes ?? "",
  };
}

export function RelationDrawer({
  open,
  relation,
  defaultKind,
  closeHref,
  countries,
  adminCountry,
  canEditCustomers,
  canEditSuppliers,
}: {
  open: boolean;
  relation: RelationData | null;
  defaultKind: "CUSTOMER" | "SUPPLIER";
  closeHref: string;
  countries: { code: string; label: string }[];
  adminCountry: string;
  canEditCustomers: boolean;
  canEditSuppliers: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [f, setF] = useState<Form>(() => toForm(relation, defaultKind, adminCountry));
  const [vies, setVies] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    setF(toForm(relation, defaultKind, adminCountry));
    setVies(null);
  }, [relation, defaultKind, adminCountry, open]);

  const close = () => router.push(closeHref, { scroll: false });
  const [save, saving] = useAction(saveRelation, {
    onDone: (r) => {
      if (r.ok && !relation) router.push(`${closeHref}${closeHref.includes("?") ? "&" : "?"}id=${(r as { id?: string }).id}`, { scroll: false });
    },
  });
  const [check, checking] = useAction(checkViesNumber, {
    refresh: true,
    onDone: (r) => setVies(r.ok ? { tone: "ok", text: String(r.message ?? "") } : { tone: "error", text: r.error }),
  });
  const [archive, archiving] = useAction(setArchived, { onDone: (r) => r.ok && close() });

  const kindEditable = (k: Form["kind"]) => (k === "CUSTOMER" ? canEditCustomers : k === "SUPPLIER" ? canEditSuppliers : canEditCustomers && canEditSuppliers);
  const editable = kindEditable(f.kind);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const field = (k: keyof Form, label: string, opts: { type?: string; hint?: string; span?: boolean; mono?: boolean } = {}) => (
    <label className="field" style={opts.span ? { gridColumn: "1 / -1" } : undefined}>
      {label}
      <input className={`input${opts.mono ? " n" : ""}`} type={opts.type ?? "text"} value={f[k]} onChange={set(k)} placeholder={opts.hint} disabled={!editable} />
    </label>
  );

  return (
    <Drawer
      open={open}
      onClose={close}
      width={660}
      title={relation ? relation.name : t("relations.drawerNew")}
      subtitle={relation ? `${t(`relations.kind${relation.kind}`)}${relation.archived ? ` · ${t("relations.archived")}` : ""}` : undefined}
      footer={
        editable ? (
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 8 }}>
            {relation ? (
              <button className="btn btn-ghost btn-danger" disabled={archiving} onClick={() => archive(relation.id, !relation.archived)}>
                <Icon name="Archive" size={16} />
                {relation.archived ? t("relations.unarchive") : t("relations.archive")}
              </button>
            ) : (
              <span />
            )}
            <button
              className="btn btn-primary"
              disabled={saving}
              onClick={() =>
                save({
                  ...f,
                  id: relation?.id ?? null,
                  paymentTermsDays: Number(f.paymentTermsDays) || 0,
                  taxRegimeOverride: f.taxRegimeOverride || null,
                })
              }
            >
              {saving ? <Icon name="CircleNotch" className="spin" /> : <Icon name="FloppyDisk" />}
              {t("relations.save")}
            </button>
          </div>
        ) : null
      }
    >
      {!editable ? (
        <div className="banner banner-info">
          <Icon name="Info" size={17} />
          {t("relations.readOnly")}
        </div>
      ) : null}
      <div>
        <div className="section-label">{t("relations.kind")}</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {(["CUSTOMER", "SUPPLIER", "BOTH"] as const).map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={f.kind === k} disabled={!editable || !kindEditable(k)} onClick={() => setF((s) => ({ ...s, kind: k }))}>
              {t(`relations.kind${k}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="form-grid">
        {field("name", t("relations.name"), { span: true })}
        {field("typeLabel", t("relations.typeLabel"), { hint: t("relations.typeLabelHint") })}
        <label className="field">
          {t("relations.country")}
          <select className="select" value={f.country} onChange={set("country")} disabled={!editable}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {field("addressLine", t("relations.address"), { span: true })}
        {field("postcode", t("relations.postcode"))}
        {field("city", t("relations.city"))}
        {field("email", t("relations.email"), { type: "email" })}
        {field("phone", t("relations.phone"), { type: "tel" })}
      </div>

      <div>
        <div className="form-grid" style={{ alignItems: "end" }}>
          {field("vatNumber", t("relations.vatNumber"), { mono: true })}
          <div>
            <button
              type="button"
              className="btn"
              disabled={checking || !f.vatNumber.trim()}
              onClick={() => {
                setVies(null);
                check({ id: relation?.id ?? null, country: f.country, vatNumber: f.vatNumber });
              }}
            >
              {checking ? <Icon name="CircleNotch" className="spin" /> : <Icon name="SealCheck" />}
              {checking ? t("relations.viesChecking") : t("relations.checkVies")}
            </button>
          </div>
        </div>
        {vies ? (
          <div className={`banner banner-${vies.tone === "ok" ? "ok" : "warn"}`} style={{ marginTop: 8 }}>
            <Icon name={vies.tone === "ok" ? "CheckCircle" : "Warning"} size={17} />
            {vies.text}
          </div>
        ) : relation?.vatNumber ? (
          <div style={{ fontSize: 12.5, marginTop: 6, color: relation.viesValid ? "#157347" : relation.viesValid === false ? "#b42318" : "#9a5b00" }}>
            {relation.viesValid ? t("relations.viesOk", { name: relation.viesName ? ` · ${relation.viesName}` : "" }) : relation.viesValid === false ? t("relations.viesInvalid") : t("relations.viesNotChecked")}
          </div>
        ) : null}
      </div>

      <div className="form-grid">
        {field("exciseStatus", t("relations.exciseStatus"), { hint: t("relations.exciseStatusHint") })}
        {field("exciseNumber", t("relations.exciseNumber"), { mono: true })}
        {field("paymentTermsDays", t("relations.terms"), { type: "number" })}
        <label className="field">
          {t("relations.priceList")}
          <select className="select" value={f.defaultPriceList} onChange={set("defaultPriceList")} disabled={!editable}>
            <option value="">—</option>
            {["Horeca", "Wholesale", "Export"].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          {t("relations.regime")}
          <select className="select" value={f.taxRegimeOverride} onChange={set("taxRegimeOverride")} disabled={!editable}>
            <option value="">{t("relations.regimeAuto")}</option>
            {(["DOMESTIC", "EU_B2B", "EXPORT"] as const).map((r) => (
              <option key={r} value={r}>
                {t(`relations.regime${r}`)}
              </option>
            ))}
          </select>
        </label>
        {field("iban", t("relations.iban"), { mono: true, span: true })}
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          {t("relations.notes")}
          <textarea className="textarea" value={f.notes} onChange={set("notes")} disabled={!editable} />
        </label>
      </div>

      {relation ? (
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{t("relations.recent")}</div>
          {relation.invoices.length ? (
            <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
              {relation.invoices.map((i) => (
                <Link
                  key={i.id}
                  href={i.kind === "sales" ? `/sales?id=${i.id}` : `/purchases?id=${i.id}`}
                  className="tbl-row"
                  style={{ gridTemplateColumns: "minmax(0,1fr) 110px 110px 100px", padding: "9px 12px" }}
                >
                  <span className="n" style={{ color: "#7a1f3d", fontWeight: 500 }}>
                    {i.number}
                  </span>
                  <span className="muted">{i.date}</span>
                  <span className="n right">{i.total}</span>
                  <span className="right muted" style={{ fontSize: 12.5 }}>
                    {t(`relations.status${i.status}`)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="muted">{t("relations.noInvoices")}</div>
          )}
        </div>
      ) : null}
    </Drawer>
  );
}
