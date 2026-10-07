import { prisma } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { requireStaff } from "@/lib/admin/staff";
import { countryOf } from "@/lib/admin/data";
import { CategoryTile, Pill } from "@/components/ui";
import { AddRateButton } from "./rates-client";

const COLS = "120px minmax(0,1.2fr) minmax(0,1.4fr) 140px 120px 130px minmax(0,1.4fr)";

export default async function RatesPage() {
  await requireStaff("rates.write");
  const { t, fmt } = await getI18n();
  const rows = await prisma.exciseRate.findMany({ orderBy: [{ country: "asc" }, { category: "asc" }, { validFrom: "desc" }] });
  const now = new Date();
  // The rate in force today per country+category; later rows are scheduled, earlier ones superseded.
  const inForce = new Map<string, string>();
  for (const r of rows) {
    const k = `${r.country}:${r.category}`;
    if (!inForce.has(k) && r.validFrom <= now) inForce.set(k, r.id);
  }
  const state = (r: (typeof rows)[number]) => (r.validFrom > now ? "scheduled" : inForce.get(`${r.country}:${r.category}`) === r.id ? "current" : "superseded");

  return (
    <>
      <div className="page-head" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">{t("admin.rates.eyebrow")}</div>
          <h1>{t("admin.rates.title")}</h1>
          <p style={{ margin: "6px 0 0", color: "#5b6474", maxWidth: "72ch" }}>{t("admin.rates.lede")}</p>
        </div>
        <AddRateButton />
      </div>
      <div className="card card-clip">
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 980 }}>
            <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 12 }}>
              <div>{t("admin.rates.col.country")}</div>
              <div>{t("admin.rates.col.category")}</div>
              <div>{t("admin.rates.col.basis")}</div>
              <div style={{ textAlign: "right" }}>{t("admin.rates.col.rate")}</div>
              <div>{t("admin.rates.col.validFrom")}</div>
              <div>{t("admin.rates.col.state")}</div>
              <div>{t("admin.rates.col.note")}</div>
            </div>
            {rows.length === 0 ? <div className="empty">{t("admin.rates.empty")}</div> : null}
            {rows.map((r) => {
              const s = state(r);
              return (
                <div key={r.id} style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "10px 16px", alignItems: "center", fontSize: 13.5, borderBottom: "1px solid #eef0f3", color: s === "superseded" ? "#8a93a3" : undefined }}>
                  <div>
                    {countryOf(r.country).flag} {r.country}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <CategoryTile category={r.category} size={26} />
                    {t(`admin.rates.cat.${r.category}`)}
                  </div>
                  <div>{t(`admin.rates.basis.${r.basis}`)}</div>
                  <div className="n" style={{ textAlign: "right", fontWeight: 500 }}>{r.basis === "NONE" ? "—" : fmt.money(r.rateCents)}</div>
                  <div className="n">{fmt.dateMed(r.validFrom)}</div>
                  <div>
                    <Pill tone={s === "current" ? "green" : s === "scheduled" ? "blue" : "gray"}>{t(`admin.rates.state.${s}`)}</Pill>
                  </div>
                  <div className="truncate" style={{ color: "#5b6474", fontSize: 12.5 }} title={r.note ?? ""}>
                    {r.note ?? ""}
                    {r.createdBy ? <span style={{ color: "#8a93a3" }}> · {r.createdBy}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
