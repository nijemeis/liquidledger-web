"use client";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { AdminModal, ChoiceChip } from "../ui";
import { COUNTRY_CODES, COUNTRY_FLAGS } from "../clients/shared";
import { deleteRateVersion, saveRateVersion } from "./actions";

const CATEGORIES = ["WINE", "BEER", "SPIRITS", "FORTIFIED", "WATER", "SOFT"] as const;
const BASES = ["HL_PRODUCT", "HL_PER_ABV", "HL_PER_PLATO", "HL_PURE_ALCOHOL", "NONE"] as const;
type Category = (typeof CATEGORIES)[number];
type Basis = (typeof BASES)[number];

export type BandData = { basis: Basis; rate: string; abvMin: string; abvMax: string; platoMin: string; platoMax: string; sparkling: "any" | "still" | "sparkling" };
export type VersionData = { country: string; category: Category; validFrom: string; started: boolean; note: string; bands: BandData[] };

const b = (basis: Basis, extra: Partial<BandData> = {}): BandData => ({ basis, rate: "", abvMin: "", abvMax: "", platoMin: "", platoMax: "", sparkling: "any", ...extra });

/** Starting bands per category, following the Dutch structure (amounts are entered by staff). */
const TEMPLATE: Record<Category, BandData[]> = {
  WINE: [
    b("HL_PRODUCT", { abvMax: "8,5", sparkling: "still" }),
    b("HL_PRODUCT", { abvMin: "8,5", sparkling: "still" }),
    b("HL_PRODUCT", { abvMax: "8,5", sparkling: "sparkling" }),
    b("HL_PRODUCT", { abvMin: "8,5", sparkling: "sparkling" }),
  ],
  FORTIFIED: [b("HL_PRODUCT", { abvMax: "15" }), b("HL_PRODUCT", { abvMin: "15" })],
  BEER: [b("HL_PRODUCT", { platoMax: "7" }), b("HL_PRODUCT", { platoMin: "7", platoMax: "11" }), b("HL_PRODUCT", { platoMin: "11", platoMax: "15" }), b("HL_PRODUCT", { platoMin: "15" })],
  SPIRITS: [b("HL_PURE_ALCOHOL")],
  WATER: [b("NONE")],
  SOFT: [b("NONE")],
};

function nextYearStart() {
  return `${new Date().getUTCFullYear() + 1}-01-01`;
}
const todayIso = () => new Date().toISOString().slice(0, 10);

function RateVersionModal({ open, onClose, mode, initial }: { open: boolean; onClose: () => void; mode: "add" | "edit" | "copy"; initial: VersionData | null }) {
  const { t } = useI18n();
  const [country, setCountry] = useState(initial?.country ?? "NL");
  const [category, setCategory] = useState<Category>(initial?.category ?? "SPIRITS");
  const [validFrom, setValidFrom] = useState(mode === "edit" ? initial!.validFrom : nextYearStart());
  const [bands, setBands] = useState<BandData[]>(initial?.bands.map((x) => ({ ...x })) ?? TEMPLATE.SPIRITS.map((x) => ({ ...x })));
  const [note, setNote] = useState(mode === "edit" ? (initial?.note ?? "") : "");
  const [reason, setReason] = useState("");
  const [run, pending] = useAction(saveRateVersion, { onDone: (r) => r.ok && onClose() });

  // Changing anything on or before today recalculates history: that needs a reason.
  const touchesPast = validFrom <= todayIso() || (mode === "edit" && initial!.started);
  const set = (i: number, patch: Partial<BandData>) => setBands((bs) => bs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const showAbv = category !== "WATER" && category !== "SOFT";
  const showPlato = category === "BEER";
  const showSparkling = category === "WINE" || category === "FORTIFIED";
  const valid = !!validFrom && bands.length > 0 && bands.every((x) => x.basis === "NONE" || x.rate.trim()) && (!touchesPast || reason.trim().length >= 5);

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      width={760}
      title={t(mode === "edit" ? "admin.rates.editTitle" : "admin.rates.addTitle")}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={pending || !valid}
            onClick={() => run({ country, category, validFrom, replaces: mode === "edit" ? initial!.validFrom : null, bands: bands.map((x) => (x.basis === "NONE" ? { ...x, rate: "0" } : x)), note, reason })}
          >
            {t(mode === "edit" ? "admin.rates.save" : "admin.rates.addSubmit")}
          </button>
        </>
      }
    >
      {mode === "edit" ? (
        <div style={{ fontWeight: 500 }}>
          {COUNTRY_FLAGS[country as keyof typeof COUNTRY_FLAGS]} {country} · {t(`admin.rates.cat.${category}`)}
        </div>
      ) : (
        <>
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
          <label className="field" style={{ maxWidth: 260 }}>
            {t("admin.rates.col.category")}
            <select
              className="select"
              value={category}
              onChange={(e) => {
                const c = e.target.value as Category;
                setCategory(c);
                if (mode === "add") setBands(TEMPLATE[c].map((x) => ({ ...x })));
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`admin.rates.cat.${c}`)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#3a4250", marginBottom: 4 }}>{t("admin.rates.col.bands")}</div>
        <div style={{ fontSize: 12.5, color: "#5b6474", marginBottom: 8 }}>{t("admin.rates.bandHelp")}</div>
        <div style={{ display: "grid", gap: 8 }}>
          {bands.map((x, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(150px,1.3fr) 110px" + (showAbv ? " 70px 70px" : "") + (showPlato ? " 70px 70px" : "") + (showSparkling ? " 110px" : "") + " 34px", gap: 6, alignItems: "end" }}>
              <label className="field">
                {i === 0 ? t("admin.rates.col.basis") : null}
                <select className="select" value={x.basis} onChange={(e) => set(i, { basis: e.target.value as Basis })}>
                  {BASES.map((bs) => (
                    <option key={bs} value={bs}>
                      {t(`admin.rates.basis.${bs}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {i === 0 ? t("admin.rates.rateEur") : null}
                <input className="input n" inputMode="decimal" value={x.basis === "NONE" ? "" : x.rate} disabled={x.basis === "NONE"} onChange={(e) => set(i, { rate: e.target.value })} placeholder="98,00" />
              </label>
              {showAbv ? (
                <>
                  <label className="field">
                    {i === 0 ? t("admin.rates.abvAbove") : null}
                    <input className="input n" inputMode="decimal" value={x.abvMin} onChange={(e) => set(i, { abvMin: e.target.value })} placeholder="—" />
                  </label>
                  <label className="field">
                    {i === 0 ? t("admin.rates.abvUpTo") : null}
                    <input className="input n" inputMode="decimal" value={x.abvMax} onChange={(e) => set(i, { abvMax: e.target.value })} placeholder="—" />
                  </label>
                </>
              ) : null}
              {showPlato ? (
                <>
                  <label className="field">
                    {i === 0 ? t("admin.rates.platoAbove") : null}
                    <input className="input n" inputMode="decimal" value={x.platoMin} onChange={(e) => set(i, { platoMin: e.target.value })} placeholder="—" />
                  </label>
                  <label className="field">
                    {i === 0 ? t("admin.rates.platoUpTo") : null}
                    <input className="input n" inputMode="decimal" value={x.platoMax} onChange={(e) => set(i, { platoMax: e.target.value })} placeholder="—" />
                  </label>
                </>
              ) : null}
              {showSparkling ? (
                <label className="field">
                  {i === 0 ? t("admin.rates.kind") : null}
                  <select className="select" value={x.sparkling} onChange={(e) => set(i, { sparkling: e.target.value as BandData["sparkling"] })}>
                    <option value="any">{t("admin.rates.any")}</option>
                    <option value="still">{t("admin.rates.still")}</option>
                    <option value="sparkling">{t("admin.rates.sparkling")}</option>
                  </select>
                </label>
              ) : null}
              <button type="button" className="btn btn-ghost" aria-label={t("admin.rates.removeBand")} disabled={bands.length === 1} onClick={() => setBands((bs) => bs.filter((_, j) => j !== i))} style={{ padding: "0 8px", height: 38 }}>
                <Icon name="Trash" size={16} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => setBands((bs) => [...bs, b(bs[bs.length - 1]?.basis ?? "HL_PRODUCT")])}>
          <Icon name="Plus" size={16} />
          {t("admin.rates.addBand")}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "180px minmax(0,1fr)", gap: 12 }}>
        <label className="field">
          {t("admin.rates.col.validFrom")}
          <input className="input n" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </label>
        <label className="field">
          {t("admin.rates.col.note")}
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("admin.rates.notePh")} maxLength={300} />
        </label>
      </div>
      {touchesPast ? (
        <>
          <div className="banner banner-warn" style={{ fontSize: 13 }}>
            <Icon name="Warning" size={16} />
            {t("admin.rates.pastWarning")}
          </div>
          <label className="field">
            {t("admin.rates.reason")}
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("admin.rates.reasonPh")} maxLength={300} />
          </label>
        </>
      ) : (
        <div style={{ display: "flex", gap: 8, fontSize: 12.5, color: "#5b6474" }}>
          <Icon name="Info" size={15} style={{ marginTop: 1, flex: "none" }} />
          {t("admin.rates.versionNote")}
        </div>
      )}
    </AdminModal>
  );
}

export function AddRateButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  return (
    <>
      <button
        className="btn btn-primary"
        onClick={() => {
          setN((x) => x + 1);
          setOpen(true);
        }}
      >
        <Icon name="Plus" size={16} />
        {t("admin.rates.add")}
      </button>
      {open ? <RateVersionModal key={n} open onClose={() => setOpen(false)} mode="add" initial={null} /> : null}
    </>
  );
}

export function VersionActions({ version }: { version: VersionData }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"edit" | "copy" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const [del, deleting] = useAction(deleteRateVersion, { onDone: (r) => r.ok && setMode(null) });
  return (
    <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
      <button className="btn btn-ghost" style={{ padding: "0 6px" }} title={t("admin.rates.edit")} aria-label={t("admin.rates.edit")} onClick={() => setMode("edit")}>
        <Icon name="PencilSimple" size={16} />
      </button>
      <button className="btn btn-ghost" style={{ padding: "0 6px" }} title={t("admin.rates.copy")} aria-label={t("admin.rates.copy")} onClick={() => setMode("copy")}>
        <Icon name="Copy" size={16} />
      </button>
      <button className="btn btn-ghost btn-danger" style={{ padding: "0 6px" }} title={t("admin.rates.delete")} aria-label={t("admin.rates.delete")} onClick={() => (setReason(""), setMode("delete"))}>
        <Icon name="Trash" size={16} />
      </button>
      {mode === "edit" || mode === "copy" ? <RateVersionModal open onClose={() => setMode(null)} mode={mode} initial={version} /> : null}
      <AdminModal
        open={mode === "delete"}
        onClose={() => setMode(null)}
        title={t("admin.rates.deleteTitle")}
        footer={
          <>
            <button className="btn" onClick={() => setMode(null)}>
              {t("common.cancel")}
            </button>
            <button
              className="btn btn-primary btn-danger"
              disabled={deleting || (version.started && reason.trim().length < 5)}
              onClick={() => del({ country: version.country, category: version.category, validFrom: version.validFrom, reason })}
            >
              {t("admin.rates.delete")}
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }}>{t(version.started ? "admin.rates.deleteStarted" : "admin.rates.deleteScheduled", { date: version.validFrom })}</p>
        {version.started ? (
          <label className="field">
            {t("admin.rates.reason")}
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("admin.rates.reasonPh")} maxLength={300} />
          </label>
        ) : null}
      </AdminModal>
    </div>
  );
}
