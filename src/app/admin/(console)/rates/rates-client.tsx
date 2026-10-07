"use client";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { AdminModal, ChoiceChip } from "../ui";
import { COUNTRY_CODES, COUNTRY_FLAGS } from "../clients/shared";
import { addExciseRate } from "./actions";

const CATEGORIES = ["WINE", "BEER", "SPIRITS", "FORTIFIED", "WATER", "SOFT"] as const;
const BASES = ["HL_PRODUCT", "HL_PER_ABV", "HL_PER_PLATO", "HL_PURE_ALCOHOL", "NONE"] as const;
const DEFAULT_BASIS: Record<(typeof CATEGORIES)[number], (typeof BASES)[number]> = { WINE: "HL_PRODUCT", BEER: "HL_PER_ABV", SPIRITS: "HL_PURE_ALCOHOL", FORTIFIED: "HL_PRODUCT", WATER: "NONE", SOFT: "NONE" };

function nextYearStart() {
  return `${new Date().getUTCFullYear() + 1}-01-01`;
}

export function AddRateButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState<string>("NL");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("SPIRITS");
  const [basis, setBasis] = useState<(typeof BASES)[number]>("HL_PURE_ALCOHOL");
  const [rate, setRate] = useState("");
  const [validFrom, setValidFrom] = useState(nextYearStart());
  const [note, setNote] = useState("");
  const [run, pending] = useAction(addExciseRate, { onDone: (r) => r.ok && (setOpen(false), setRate(""), setNote("")) });
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <Icon name="Plus" size={16} />
        {t("admin.rates.add")}
      </button>
      <AdminModal
        open={open}
        onClose={() => setOpen(false)}
        width={540}
        title={t("admin.rates.addTitle")}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </button>
            <button className="btn btn-primary" disabled={pending || (basis !== "NONE" && !rate.trim()) || !validFrom} onClick={() => run({ country, category, basis, rate: basis === "NONE" ? "0" : rate, validFrom, note })}>
              {t("admin.rates.addSubmit")}
            </button>
          </>
        }
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#3a4250", marginBottom: 6 }}>{t("admin.rates.col.country")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {COUNTRY_CODES.map((cc) => (
              <ChoiceChip key={cc} on={country === cc} onClick={() => setCountry(cc)}>
                {COUNTRY_FLAGS[cc]} {cc}
              </ChoiceChip>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <label className="field">
            {t("admin.rates.col.category")}
            <select
              className="select"
              value={category}
              onChange={(e) => {
                const c = e.target.value as (typeof CATEGORIES)[number];
                setCategory(c);
                setBasis(DEFAULT_BASIS[c]);
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`admin.rates.cat.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("admin.rates.col.basis")}
            <select className="select" value={basis} onChange={(e) => setBasis(e.target.value as (typeof BASES)[number])}>
              {BASES.map((b) => (
                <option key={b} value={b}>
                  {t(`admin.rates.basis.${b}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("admin.rates.rateEur")}
            <input className="input n" inputMode="decimal" value={basis === "NONE" ? "" : rate} disabled={basis === "NONE"} onChange={(e) => setRate(e.target.value)} placeholder="1.991,00" />
          </label>
          <label className="field">
            {t("admin.rates.col.validFrom")}
            <input className="input n" type="date" min={tomorrow} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </label>
        </div>
        <label className="field">
          {t("admin.rates.col.note")}
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("admin.rates.notePh")} maxLength={300} />
        </label>
        <div style={{ display: "flex", gap: 8, fontSize: 12.5, color: "#5b6474" }}>
          <Icon name="Info" size={15} style={{ marginTop: 1, flex: "none" }} />
          {t("admin.rates.versionNote")}
        </div>
      </AdminModal>
    </>
  );
}
