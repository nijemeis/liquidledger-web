import { prisma } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { requireStaff } from "@/lib/admin/staff";
import { countryOf } from "@/lib/admin/data";
import { bandLabel } from "@/lib/domain/excise";
import { CategoryTile, Pill } from "@/components/ui";
import { AddRateButton, VersionActions, type VersionData } from "./rates-client";

const COLS = "110px minmax(0,1fr) minmax(0,2.4fr) 120px 110px minmax(0,1.2fr) 92px";

/** Cents → "98,00" (what the rate input accepts back). */
const amount = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const pct = (n: number | null, f: number) => (n === null ? "" : String(n / f).replace(".", ","));

export default async function RatesPage() {
  await requireStaff("rates.write");
  const { t, fmt } = await getI18n();
  const rows = await prisma.exciseRate.findMany({ orderBy: [{ country: "asc" }, { category: "asc" }, { validFrom: "desc" }, { sparkling: { sort: "asc", nulls: "first" } }, { abvMinBp: { sort: "asc", nulls: "first" } }, { platoMinTenths: { sort: "asc", nulls: "first" } }] });
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // One version = all bands of a country + category with the same start date.
  const versions: (VersionData & { key: string; rows: typeof rows })[] = [];
  for (const r of rows) {
    const key = `${r.country}:${r.category}:${r.validFrom.toISOString().slice(0, 10)}`;
    let v = versions.find((x) => x.key === key);
    if (!v) {
      v = {
        key,
        country: r.country,
        category: r.category,
        validFrom: r.validFrom.toISOString().slice(0, 10),
        started: r.validFrom <= today,
        note: r.note ?? "",
        bands: [],
        rows: [],
      };
      versions.push(v);
    }
    v.rows.push(r);
    v.bands.push({
      basis: r.basis,
      rate: r.basis === "NONE" ? "" : amount(r.rateCents),
      abvMin: pct(r.abvMinBp, 100),
      abvMax: pct(r.abvMaxBp, 100),
      platoMin: pct(r.platoMinTenths, 10),
      platoMax: pct(r.platoMaxTenths, 10),
      sparkling: r.sparkling === null ? "any" : r.sparkling ? "sparkling" : "still",
    });
  }
  // In force today per country+category; later versions are scheduled, earlier ones superseded.
  const inForce = new Map<string, string>();
  for (const v of versions) {
    const k = `${v.country}:${v.category}`;
    if (!inForce.has(k) && v.started) inForce.set(k, v.key);
  }
  const state = (v: (typeof versions)[number]) => (!v.started ? "scheduled" : inForce.get(`${v.country}:${v.category}`) === v.key ? "current" : "superseded");
  const words = { sparkling: t("admin.rates.sparkling"), still: t("admin.rates.still") };

  return (
    <>
      <div className="page-head" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">{t("admin.rates.eyebrow")}</div>
          <h1>{t("admin.rates.title")}</h1>
          <p style={{ margin: "6px 0 0", color: "#5b6474", maxWidth: "76ch" }}>{t("admin.rates.lede")}</p>
        </div>
        <AddRateButton />
      </div>
      <div className="card card-clip">
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 1040 }}>
            <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 12 }}>
              <div>{t("admin.rates.col.country")}</div>
              <div>{t("admin.rates.col.category")}</div>
              <div>{t("admin.rates.col.bands")}</div>
              <div>{t("admin.rates.col.validFrom")}</div>
              <div>{t("admin.rates.col.state")}</div>
              <div>{t("admin.rates.col.note")}</div>
              <div />
            </div>
            {versions.length === 0 ? <div className="empty">{t("admin.rates.empty")}</div> : null}
            {versions.map((v) => {
              const s = state(v);
              return (
                <div key={v.key} style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "10px 16px", alignItems: "center", fontSize: 13.5, borderBottom: "1px solid #eef0f3", color: s === "superseded" ? "#8a93a3" : undefined }}>
                  <div>
                    {countryOf(v.country).flag} {v.country}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <CategoryTile category={v.category} size={26} />
                    {t(`admin.rates.cat.${v.category}`)}
                  </div>
                  <div style={{ display: "grid", gap: 3 }}>
                    {v.rows.map((r) => (
                      <div key={r.id} style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                        <span className="muted" style={{ fontSize: 12.5 }}>
                          {bandLabel(r, words) || t("admin.rates.allProducts")} · {t(`admin.rates.basis.${r.basis}`)}
                        </span>
                        <span className="n" style={{ fontWeight: 500 }}>
                          {r.basis === "NONE" ? "—" : fmt.money(r.rateCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="n">{fmt.dateMed(new Date(v.validFrom + "T00:00:00Z"))}</div>
                  <div>
                    <Pill tone={s === "current" ? "green" : s === "scheduled" ? "blue" : "gray"}>{t(`admin.rates.state.${s}`)}</Pill>
                  </div>
                  <div className="truncate" style={{ color: "#5b6474", fontSize: 12.5 }} title={v.note}>
                    {v.note}
                    {v.rows[0]!.createdBy ? <span style={{ color: "#8a93a3" }}> · {v.rows[0]!.createdBy}</span> : null}
                  </div>
                  <VersionActions version={{ country: v.country, category: v.category, validFrom: v.validFrom, started: v.started, note: v.note, bands: v.bands }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
