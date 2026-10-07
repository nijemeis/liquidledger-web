"use client";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { Icon, type IconName } from "@/components/icon";
import { Empty } from "@/components/ui";
import { Modal, useAction } from "@/components/client";
import { deleteRule, updateRule } from "./actions";

export type RuleRow = {
  id: string;
  matchType: "supplier" | "iban" | "description";
  pattern: string;
  categoryKey: string | null;
  category: string | null;
  icon: string;
  accountCode: string | null;
  account: string;
  vatRateBp: number | null;
  vat: string;
  timesUsed: number;
  created: string;
};

const COLS = "96px minmax(110px,1fr) minmax(190px,1.6fr) 90px 48px 92px";

export function RulesClient({ rows, canEdit, categories, accounts }: { rows: RuleRow[]; canEdit: boolean; categories: { key: string; label: string; account: string }[]; accounts: { code: string; name: string }[] }) {
  const { t } = useI18n();
  const [edit, setEdit] = useState<RuleRow | null>(null);
  const [del, setDel] = useState<RuleRow | null>(null);
  return (
    <>
      <section className="card card-clip">
        <div className="card-pad" style={{ paddingBottom: 14 }}>
          <div className="card-title">{t("settings.rules.title")}</div>
          <div className="muted" style={{ fontSize: 13 }}>{t("settings.rules.text")}</div>
        </div>
        {rows.length ? (
          <div className="tbl">
            <div className="tbl-head" style={{ gridTemplateColumns: COLS, minWidth: 700 }}>
              <span>{t("settings.rules.match")}</span>
              <span>{t("settings.rules.pattern")}</span>
              <span>{t("settings.rules.bookAs")}</span>
              <span>{t("settings.rules.vat")}</span>
              <span className="right">{t("settings.rules.used")}</span>
              <span />
            </div>
            {rows.map((r) => (
              <div key={r.id} className="tbl-row" style={{ gridTemplateColumns: COLS, minWidth: 700 }}>
                <span>
                  <span className="pill pill-gray">{t(`settings.rules.type.${r.matchType}`)}</span>
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="cell-main truncate n" style={{ display: "block" }}>{r.pattern}</span>
                  <span className="cell-sub n">{t("settings.rules.created")} {r.created}</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span className="tile" style={{ width: 28, height: 28, background: "#f9eef2", color: "#7a1f3d" }}>
                    <Icon name={r.icon as IconName} size={15} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ display: "block", fontWeight: 500 }}>{r.category ?? r.account}</span>
                    {r.category ? <span className="cell-sub truncate n" style={{ display: "block" }}>{r.account}</span> : null}
                  </span>
                </span>
                <span className="n muted">{r.vat}</span>
                <span className="n right">{t("settings.rules.times", { n: r.timesUsed })}</span>
                <span style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
                  {canEdit ? (
                    <>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEdit(r)}>
                        {t("common.edit")}
                      </button>
                      <button className="btn btn-sm btn-ghost btn-danger" aria-label={t("common.delete")} onClick={() => setDel(r)}>
                        <Icon name="Trash" size={15} />
                      </button>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="MagicWand" title={t("settings.rules.empty")} color="#7a1f3d">
            <div style={{ fontSize: 13, marginTop: 4 }}>{t("settings.rules.emptyText")}</div>
          </Empty>
        )}
      </section>
      {edit ? <EditRule rule={edit} categories={categories} accounts={accounts} onClose={() => setEdit(null)} /> : null}
      {del ? <DeleteRule rule={del} onClose={() => setDel(null)} /> : null}
    </>
  );
}

function EditRule({ rule, categories, accounts, onClose }: { rule: RuleRow; categories: { key: string; label: string; account: string }[]; accounts: { code: string; name: string }[]; onClose: () => void }) {
  const { t } = useI18n();
  const [v, setV] = useState({ matchType: rule.matchType, pattern: rule.pattern, categoryKey: rule.categoryKey ?? "", accountCode: rule.accountCode ?? "", vat: rule.vatRateBp === null ? "" : String(rule.vatRateBp) });
  const [run, pending] = useAction(updateRule, { onDone: (r) => r.ok && onClose() });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("settings.rules.editTitle")}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" type="submit" form="rule-form" disabled={pending || !v.pattern.trim()}>
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Check" size={16} />}
            {t("common.save")}
          </button>
        </>
      }
    >
      <form
        id="rule-form"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          run({ id: rule.id, matchType: v.matchType, pattern: v.pattern, categoryKey: v.categoryKey || null, accountCode: v.accountCode || null, vatRateBp: v.vat === "" ? null : Number(v.vat) });
        }}
      >
        <div className="form-grid">
          <label className="field">
            {t("settings.rules.match")}
            <select className="select" value={v.matchType} onChange={(e) => setV({ ...v, matchType: e.target.value as RuleRow["matchType"] })}>
              {(["supplier", "iban", "description"] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`settings.rules.type.${m}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("settings.rules.pattern")}
            <input className="input" value={v.pattern} maxLength={120} onChange={(e) => setV({ ...v, pattern: e.target.value })} />
          </label>
        </div>
        <label className="field">
          {t("settings.rules.category")}
          <select className="select" value={v.categoryKey} onChange={(e) => setV({ ...v, categoryKey: e.target.value, accountCode: "" })}>
            <option value="">{t("settings.rules.noCategory")}</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} · {c.account}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label className="field">
            {t("settings.rules.account")}
            <select className="select" value={v.accountCode} onChange={(e) => setV({ ...v, accountCode: e.target.value })}>
              <option value="">{v.categoryKey ? t("settings.rules.fromCategory") : t("settings.rules.pick")}</option>
              {accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("settings.rules.vat")}
            <select className="select" value={v.vat} onChange={(e) => setV({ ...v, vat: e.target.value })}>
              <option value="">{t("settings.rules.vatDefault")}</option>
              <option value="2100">21%</option>
              <option value="900">9%</option>
              <option value="0">0%</option>
            </select>
          </label>
        </div>
        <div className="field-label">{t("settings.rules.editNote")}</div>
      </form>
    </Modal>
  );
}

function DeleteRule({ rule, onClose }: { rule: RuleRow; onClose: () => void }) {
  const { t } = useI18n();
  const [run, pending] = useAction(deleteRule, { onDone: (r) => r.ok && onClose() });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("settings.rules.deleteTitle")}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" style={{ background: "#b42318", borderColor: "#b42318" }} disabled={pending} onClick={() => run({ id: rule.id })}>
            <Icon name="Trash" size={16} />
            {t("common.delete")}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 13.5, color: "#3a4250" }}>{t("settings.rules.deleteText", { pattern: rule.pattern, n: rule.timesUsed })}</p>
    </Modal>
  );
}
