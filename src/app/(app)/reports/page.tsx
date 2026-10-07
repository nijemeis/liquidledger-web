import type { Metadata } from "next";
import { requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Icon } from "@/components/icon";
import { Banner, PageHead, TabLinks } from "@/components/ui";
import { balanceSheet, fiscalYearOf, profitAndLoss } from "@/lib/domain/reports";
import { monthOf, parsePeriod } from "@/lib/domain/returns";
import { ParamSelect } from "./_components/nav";
import { ExportMenu } from "./_components/export-menu";

export const metadata: Metadata = { title: "Reports" };

const COLS = "minmax(0,1fr) 120px 120px 80px 130px";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string }> }) {
  const ctx = await requireApp("reports");
  const { t, fmt, locale } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const A = ctx.administration.id;
  const tab = sp.tab === "bs" ? "bs" : "pl";
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const asked = parsePeriod(sp.month);
  const month = asked && !asked.key.includes("Q") && asked.start <= today ? asked : monthOf(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)));
  const fy = fiscalYearOf(month.start, ctx.administration.fiscalYearStart);
  const lang = locale === "nl" ? "nl" : "en";

  const d = await tenant(ctx, async (tx) => {
    if (tab === "pl") {
      const [pl, excise] = await Promise.all([
        profitAndLoss(tx, A, month.start, ctx.administration.fiscalYearStart),
        tx.salesInvoice.aggregate({ where: { administrationId: A, status: { in: ["OPEN", "PAID"] }, issueDate: { gte: month.start, lte: month.end } }, _sum: { exciseCents: true } }),
      ]);
      return { pl, exciseCents: excise._sum.exciseCents ?? 0, bs: null };
    }
    return { pl: null, exciseCents: 0, bs: await balanceSheet(tx, A, month.end) };
  });

  const options = Array.from({ length: 24 }, (_, i) => monthOf(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)))).map((p) => ({
    value: p.key,
    label: fmt.monthLong(p.start) + (p.end >= today ? ` · ${t("reports.inProgress")}` : ""),
  }));
  const eur0 = (c: number) => fmt.money(c, { decimals: 0 });
  const monthKey = month.key;
  const tabHref = (k: string) => `/reports?tab=${k}&month=${monthKey}`;
  const prevStart = new Date(Date.UTC(month.start.getUTCFullYear(), month.start.getUTCMonth() - 1, 1));

  return (
    <>
      <PageHead
        eyebrow={t("common.group.accounting")}
        title={t("common.nav.reports")}
        actions={
          <>
            <ParamSelect param="month" value={month.key} options={options} label={t("reports.month")} width={215} />
            <ExportMenu from={fy.start.toISOString().slice(0, 10)} to={(month.end < today ? month.end : today).toISOString().slice(0, 10)} month={month.key} />
          </>
        }
      />
      <div className="card card-clip">
        <div style={{ padding: "0 12px", borderBottom: "1px solid #e4e7ec" }}>
          <TabLinks
            active={tab}
            tabs={[
              { key: "pl", label: t("reports.pl"), href: tabHref("pl") },
              { key: "bs", label: t("reports.bs"), href: tabHref("bs") },
            ]}
          />
        </div>

        {d.pl ? (
          <>
            <div className="tbl">
              <div style={{ minWidth: 640 }}>
                <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 12 }}>
                  <div />
                  <div style={{ textAlign: "right", textTransform: "capitalize" }}>{fmt.monthLong(month.start).replace(/^(\S{3})\S*/, "$1")}</div>
                  <div style={{ textAlign: "right", textTransform: "capitalize" }}>{fmt.monthLong(prevStart).replace(/^(\S{3})\S*/, "$1")}</div>
                  <div style={{ textAlign: "right" }}>{t("reports.change")}</div>
                  <div style={{ textAlign: "right" }}>{t("reports.ytd")}</div>
                </div>
                {d.pl.lines.map((r) => {
                  const dlt = r.prev ? ((Math.abs(r.cur) - Math.abs(r.prev)) / Math.abs(r.prev)) * 100 : null;
                  const flat = dlt === null || Math.abs(dlt) < 0.5;
                  // Green when the change helps profit: more revenue/profit, or less cost.
                  const color = flat ? "#8a93a3" : (r.cur > 0 || (r.cur === 0 && r.prev > 0)) === dlt! > 0 ? "#157347" : "#b42318";
                  return (
                    <div
                      key={r.key}
                      className="n"
                      style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "11px 16px", fontSize: 13.5, borderBottom: "1px solid #eef0f3", fontWeight: r.level ? 600 : 400, background: r.level === 2 ? "#f8e9ee" : r.level ? "#f9fafb" : "#fff" }}
                    >
                      <div>{r.label[lang]}</div>
                      <div style={{ textAlign: "right" }}>{eur0(r.cur)}</div>
                      <div style={{ textAlign: "right", color: "#5b6474" }}>{eur0(r.prev)}</div>
                      <div style={{ textAlign: "right", color }}>{flat ? "—" : `${dlt! > 0 ? "+" : "−"}${fmt.int(Math.abs(dlt!))}%`}</div>
                      <div style={{ textAlign: "right" }}>{eur0(r.ytd)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ padding: "12px 16px", fontSize: 12.5, color: "#5b6474", display: "flex", gap: 8, alignItems: "center" }}>
              <Icon name="Info" />
              {t("reports.exciseNote", { amount: eur0(d.exciseCents), month: fmt.month(month.start).replace("Sept", "Sep") })}
            </div>
          </>
        ) : null}

        {d.bs ? (
          <>
            {d.bs.totalAssets !== d.bs.totalLiabilities ? (
              <Banner tone="error" style={{ margin: 16 }}>
                {t("reports.unbalanced", { diff: fmt.money(d.bs.totalAssets - d.bs.totalLiabilities) })}
              </Banner>
            ) : null}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))" }}>
              {[
                { label: t("reports.assets"), rows: d.bs.assets, total: d.bs.totalAssets },
                { label: t("reports.equityLiabilities"), rows: d.bs.liabilities, total: d.bs.totalLiabilities },
              ].map((side) => (
                <div key={side.label} style={{ borderRight: "1px solid #eef0f3", display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, color: "#5b6474", background: "#f9fafb", borderBottom: "1px solid #e4e7ec" }}>{side.label}</div>
                  {side.rows
                    .filter((r) => r.cents !== 0 || ["bank", "receivables", "stock", "equity", "profit", "payables", "taxes"].includes(r.key))
                    .map((r) => (
                      <div key={r.key} className="n" style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 16px", fontSize: 13.5, borderBottom: "1px solid #f0f2f5" }}>
                        <span>{r.label[lang]}</span>
                        <span>{eur0(r.cents)}</span>
                      </div>
                    ))}
                  <div className="n" style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", fontWeight: 600, fontSize: 14.5, marginTop: "auto" }}>
                    <span>{t("common.total")}</span>
                    <span>{eur0(side.total)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: "12px 16px", fontSize: 12.5, color: "#5b6474", display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid #eef0f3" }}>
              <Icon name="Info" />
              {t("reports.bsNote", { date: fmt.dateMed(month.end) })}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
