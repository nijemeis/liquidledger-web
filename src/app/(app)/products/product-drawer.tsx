"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { Drawer, useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { CATEGORY_STYLE } from "@/components/ui";
import { duplicateProduct, saveProduct, setProductArchived } from "./actions";

export type ProductView = {
  id: string;
  name: string;
  sub: string;
  category: string;
  catLabel: string;
  archived: boolean;
  sku: string;
  facts: { l: string; v: string }[];
  lists: { name: string; btl: string; cs: string; m: string }[];
  cost: string | null;
  exBtl: string;
  exCase: string;
  deposit: string;
  exFormula: string;
  stock: { l: string; v: string }[];
  reorder: string;
  low: boolean;
  sold: string;
  rev: string | null;
  top: string;
};

export type ProductEdit = {
  id: string | null;
  sku: string;
  name: string;
  producer: string;
  region: string;
  originCountry: string;
  category: "WINE" | "BEER" | "SPIRITS" | "FORTIFIED" | "WATER" | "SOFT";
  volumeL: string;
  abv: string;
  plato: string;
  vintage: string;
  unitsPerCase: string;
  casesPerPallet: string;
  ean: string;
  cnCode: string;
  emcsCode: string;
  deposit: string;
  reorderLevel: string;
  cost: string;
  prices: Record<string, string>;
};

const CATS = ["WINE", "BEER", "SPIRITS", "FORTIFIED", "WATER", "SOFT"] as const;

export function ProductDrawer({
  open,
  view,
  edit,
  startEditing,
  canEdit,
  closeHref,
  baseHref,
  countries,
}: {
  open: boolean;
  view: ProductView | null;
  edit: ProductEdit | null;
  startEditing: boolean;
  canEdit: boolean;
  closeHref: string;
  baseHref: string;
  countries: { code: string; label: string }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState(startEditing);
  const [f, setF] = useState<ProductEdit | null>(edit);
  useEffect(() => {
    setEditing(startEditing);
    setF(edit);
  }, [edit, startEditing, open]);
  const goTo = (id: string) => router.push(`${baseHref}${baseHref.includes("?") ? "&" : "?"}id=${id}`, { scroll: false });
  const close = () => router.push(closeHref, { scroll: false });

  const [save, saving] = useAction(saveProduct, {
    onDone: (r) => {
      if (!r.ok) return;
      setEditing(false);
      if (!view) goTo((r as { id: string }).id);
    },
  });
  const [dup, duplicating] = useAction(duplicateProduct, { onDone: (r) => r.ok && router.push(`${baseHref}${baseHref.includes("?") ? "&" : "?"}id=${(r as { id: string }).id}&edit=1`, { scroll: false }) });
  const [archive, archiving] = useAction(setProductArchived);

  if (!open) return null;

  // ── Edit form ──────────────────────────────────────────────────────────────
  if (editing && f) {
    const set = (k: keyof ProductEdit) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => (s ? { ...s, [k]: e.target.value } : s));
    const input = (k: Exclude<keyof ProductEdit, "prices" | "id" | "category">, label: string, opts: { hint?: string; mode?: "decimal" | "numeric"; span?: boolean } = {}) => (
      <label className="field" style={opts.span ? { gridColumn: "1 / -1" } : undefined}>
        {label}
        <input className="input" value={f[k]} onChange={set(k)} inputMode={opts.mode} />
        {opts.hint ? <span className="field-label">{opts.hint}</span> : null}
      </label>
    );
    return (
      <Drawer
        open
        onClose={close}
        width={660}
        title={f.id ? t("products.editTitle") : t("products.newTitle")}
        subtitle={f.id ? `${f.sku} · ${f.name}` : undefined}
        footer={
          <>
            {view ? (
              <button className="btn" onClick={() => (setEditing(false), setF(edit))}>
                {t("products.cancel")}
              </button>
            ) : null}
            <button className="btn btn-primary" disabled={saving} onClick={() => save({ ...f, unitsPerCase: Number(f.unitsPerCase) || 1 })}>
              {saving ? <Icon name="CircleNotch" className="spin" /> : <Icon name="FloppyDisk" />}
              {t("products.save")}
            </button>
          </>
        }
      >
        <div>
          <div className="section-label">{t("products.fCategory")}</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {CATS.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={f.category === c} onClick={() => setF((s) => (s ? { ...s, category: c } : s))}>
                {t(`products.cat${c}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="form-grid">
          {input("name", t("products.fName"), { span: true })}
          {input("sku", t("products.fSku"))}
          {input("ean", t("products.fEan"), { mode: "numeric" })}
          {input("producer", t("products.fProducer"))}
          {input("region", t("products.fRegion"))}
          <label className="field">
            {t("products.fOrigin")}
            <select className="select" value={f.originCountry} onChange={set("originCountry")}>
              <option value="">—</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {input("vintage", t("products.fVintage"))}
          {input("volumeL", t("products.fVolume"), { mode: "decimal" })}
          {input("abv", t("products.fAbv"), { mode: "decimal" })}
          {f.category === "BEER" ? input("plato", t("products.fPlato"), { mode: "decimal" }) : null}
          {input("unitsPerCase", t("products.fUnitsPerCase"), { mode: "numeric" })}
          {input("casesPerPallet", t("products.fCasesPerPallet"), { mode: "numeric" })}
          {input("cnCode", t("products.fCn"))}
          {input("emcsCode", t("products.fEmcs"))}
          {input("deposit", t("products.fDeposit"), { mode: "decimal" })}
          {input("reorderLevel", t("products.fReorder"), { mode: "numeric" })}
          {!f.id ? input("cost", t("products.fCost"), { mode: "decimal", hint: t("products.fCostHint") }) : null}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{t("products.fPrices")}</div>
          <div className="form-grid">
            {Object.keys(f.prices).map((l) => (
              <label key={l} className="field">
                {l}
                <input
                  className="input n"
                  inputMode="decimal"
                  value={f.prices[l]}
                  onChange={(e) => setF((s) => (s ? { ...s, prices: { ...s.prices, [l]: e.target.value } } : s))}
                />
              </label>
            ))}
          </div>
        </div>
      </Drawer>
    );
  }

  if (!view) return null;
  const st = CATEGORY_STYLE[view.category]!;
  const pill = (bg: string, fg: string, text: string, n = false) => (
    <span className={n ? "n" : undefined} style={{ fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 999, background: bg, color: fg }}>
      {text}
    </span>
  );

  // ── Product view (prototype product drawer) ────────────────────────────────
  return (
    <Drawer
      open
      onClose={close}
      width={660}
      header={
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flex: 1, minWidth: 0 }}>
          <div style={{ width: 60, height: 78, flex: "none", borderRadius: 8, border: "1.5px dashed #d5d9e0", background: "#fafbfc", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, color: "#8a93a3", fontSize: 10 }}>
            <Icon name="Image" size={20} />
            {t("products.photo")}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 18, lineHeight: 1.25 }}>{view.name}</div>
            <div style={{ fontSize: 13, color: "#5b6474", marginTop: 2 }}>{view.sub}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {pill(st.bg, st.fg, view.catLabel)}
              {view.archived ? pill("#f0f2f5", "#4b5563", t("products.archived")) : pill("#e6f6ee", "#157347", t("products.active"))}
              {pill("#f0f2f5", "#4b5563", view.sku, true)}
            </div>
          </div>
        </div>
      }
      footer={
        canEdit ? (
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between", width: "100%" }}>
            <button className="btn btn-ghost btn-danger" disabled={archiving} onClick={() => archive(view.id, !view.archived)}>
              {view.archived ? t("products.unarchive") : t("products.archive")}
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" disabled={duplicating} onClick={() => dup(view.id)}>
                {t("products.duplicate")}
              </button>
              <button className="btn btn-primary" onClick={() => setEditing(true)}>
                <Icon name="PencilSimple" size={16} />
                {t("products.edit")}
              </button>
            </div>
          </div>
        ) : null
      }
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{t("products.facts")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: "12px 18px" }}>
          {view.facts.map((x) => (
            <div key={x.l}>
              <div style={{ fontSize: 12, color: "#5b6474" }}>{x.l}</div>
              <div className="n" style={{ fontSize: 14, fontWeight: 500 }}>{x.v}</div>
            </div>
          ))}
        </div>
      </div>
      {view.cost !== null ? (
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{t("products.priceLists")}</div>
          <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 100px 100px 80px", gap: 10, padding: "8px 12px", fontSize: 12, fontWeight: 500, color: "#5b6474", background: "#f9fafb", borderBottom: "1px solid #e4e7ec" }}>
              <div>{t("products.list")}</div>
              <div className="right">{t("products.perBottle")}</div>
              <div className="right">{t("products.perCase")}</div>
              <div className="right">{t("products.margin")}</div>
            </div>
            {view.lists.length ? (
              view.lists.map((l) => (
                <div key={l.name} className="n" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 100px 100px 80px", gap: 10, padding: "9px 12px", fontSize: 13.5, borderBottom: "1px solid #f0f2f5" }}>
                  <span>{l.name}</span>
                  <span className="right" style={{ fontWeight: 500 }}>{l.btl}</span>
                  <span className="right">{l.cs}</span>
                  <span className="right" style={{ color: "#157347" }}>{l.m}</span>
                </div>
              ))
            ) : (
              <div style={{ padding: "9px 12px", fontSize: 13.5, color: "#5b6474" }}>{t("products.noPrices")}</div>
            )}
            <div className="n" style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", fontSize: 12.5, color: "#5b6474", background: "#fafbfc" }}>
              <span>{t("products.costLine")}</span>
              <span>{view.cost}</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#5b6474", marginTop: 6 }}>{t("products.priceNote")}</div>
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{t("products.exciseDeposit")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 13.5, padding: "12px 14px", borderRadius: 10, background: "#fcf5f7" }}>
            <span className="muted">{t("products.perBottle")}</span>
            <span className="n right" style={{ fontWeight: 600 }}>{view.exBtl}</span>
            <span className="muted">{t("products.perCase")}</span>
            <span className="n right">{view.exCase}</span>
            <span className="muted">{t("products.deposit")}</span>
            <span className="n right">{view.deposit}</span>
            <span style={{ gridColumn: "span 2", fontSize: 12, color: "#7a1f3d" }}>{view.exFormula}</span>
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{t("products.stock")}</div>
          {view.stock.map((s) => (
            <div key={s.l} className="n" style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: "1px solid #f0f2f5", fontSize: 13.5 }}>
              <span>{s.l}</span>
              <span style={{ fontWeight: 500 }}>{s.v}</span>
            </div>
          ))}
          <div style={{ fontSize: 12.5, color: view.low ? "#9a5b00" : "#5b6474", marginTop: 6 }}>{view.reorder}</div>
        </div>
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{t("products.last90")}</div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${view.rev !== null ? 3 : 2},1fr)`, gap: 10 }}>
          <div style={{ padding: 12, border: "1px solid #e4e7ec", borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: "#5b6474" }}>{t("products.sold")}</div>
            <div className="n" style={{ fontSize: 18, fontWeight: 600 }}>{view.sold}</div>
          </div>
          {view.rev !== null ? (
            <div style={{ padding: 12, border: "1px solid #e4e7ec", borderRadius: 10 }}>
              <div style={{ fontSize: 12, color: "#5b6474" }}>{t("products.revenue")}</div>
              <div className="n" style={{ fontSize: 18, fontWeight: 600 }}>{view.rev}</div>
            </div>
          ) : null}
          <div style={{ padding: 12, border: "1px solid #e4e7ec", borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: "#5b6474" }}>{t("products.topCustomer")}</div>
            <div className="truncate" style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>{view.top}</div>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
