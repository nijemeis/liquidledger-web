import type { Metadata } from "next";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Icon } from "@/components/icon";
import { PageHead, Pill } from "@/components/ui";
import { filedReturns, monthOf, parsePeriod, previousPeriod, quarterOf, vatChecks, vatReturn, type Period } from "@/lib/domain/returns";
import { ParamSelect } from "../reports/_components/nav";
import { FileReturn, type Figure } from "../reports/_components/file-return";
import { fileVat } from "./actions";

export const metadata: Metadata = { title: "VAT return" };

const COLS = "46px minmax(0,1fr) 130px 120px";

const PORTAL: Record<string, { name: string; url: string }> = {
  NL: { name: "Mijn Belastingdienst Zakelijk", url: "https://mijn.belastingdienst.nl/" },
};

export default async function VatPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const ctx = await requireApp("fileVat");
  const { t, fmt, locale } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const A = ctx.administration.id;
  const monthly = ctx.administration.vatPeriod === "MONTHLY";
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const asked = parsePeriod(sp.period);
  const period = asked && asked.key.includes("Q") !== monthly && asked.start <= today ? asked : previousPeriod(today, monthly);
  const lang = locale === "nl" ? "nl" : "en";

  const d = await tenant(ctx, async (tx) => {
    const ret = await vatReturn(tx, A, period);
    const [checks, history] = await Promise.all([vatChecks(tx, A, period, ret.icp), filedReturns(tx, A, "VAT", 8)]);
    const filer = ret.filed?.filedById ? await tx.membership.findFirst({ where: { administrationId: A, userId: ret.filed.filedById }, select: { user: { select: { name: true } } } }) : null;
    return { ret, checks, history, filerName: filer?.user.name ?? null };
  });
  const { ret } = d;

  const label = (p: { key: string; start: Date }) => (p.key.includes("Q") ? p.key.replace(/^(\d{4})-Q(\d)$/, t("vat.quarter", { q: "$2", y: "$1" })) : fmt.monthLong(p.start));
  const range = (p: Period) => (p.key.includes("Q") ? `${fmt.month(p.start).replace("Sept", "Sep")}–${fmt.month(p.end).replace("Sept", "Sep")}` : fmt.monthLong(p.start));
  const options = (
    monthly
      ? Array.from({ length: 18 }, (_, i) => monthOf(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1))))
      : Array.from({ length: 8 }, (_, i) => quarterOf(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i * 3, 1))))
  ).map((p) => ({ value: p.key, label: label(p) + (p.end >= today ? ` · ${t("vat.inProgress")}` : "") }));
  const country = new Intl.DisplayNames([locale], { type: "region" }).of(ctx.administration.country) ?? ctx.administration.country;
  const ended = period.end < today;
  const filed = ret.filed?.status === "FILED" && ret.filed.filedRef ? { ref: ret.filed.filedRef, at: fmt.dateMed(ret.filed.filedAt ?? today), by: d.filerName ?? undefined } : null;
  const pay = ret.payableCents >= 0;

  const base = (c: number | null) => (c === null ? "" : fmt.money(c, { decimals: 0 }));
  const vat = (c: number | null, input?: boolean) => (c === null ? "" : fmt.money(input ? -c : c));

  const figures: Figure[] = [];
  for (const r of ret.rows) {
    if (r.section) figures.push({ label: r.section[lang], value: "", section: true });
    if (r.kind === "total") continue;
    const parts = [r.baseCents !== null ? `${t("vat.turnover")} ${base(r.baseCents)}` : null, r.vatCents !== null ? `${t("vat.vat")} ${vat(r.vatCents, r.kind === "input")}` : null].filter(Boolean);
    figures.push({ label: `${r.box} · ${r.label[lang]}`, value: parts.join(" · ") });
  }
  figures.push({ label: `5g · ${t(pay ? "vat.toPay" : "vat.toReclaim")}`, value: fmt.money(Math.abs(ret.payableCents)), strong: true });
  if (ret.icp.length) {
    figures.push({ label: t("vat.icpTitle"), value: "", section: true });
    for (const c of ret.icp) figures.push({ label: c.name, sub: c.vatNumber, value: fmt.money(c.amountCents) });
  }

  const checkLabel = (c: (typeof d.checks)[number]) => {
    const per = label(period);
    const v = { ...c.vars, period: per } as Record<string, string | number>;
    if (c.key === "import") v.amount = fmt.money(Number(c.vars.cents));
    if (c.key === "invoices" && c.variant === "open") {
      const parts = [];
      if (Number(c.vars.purchases)) parts.push(t("vat.check.invoicesPurch", { n: c.vars.purchases }));
      if (Number(c.vars.drafts)) parts.push(t("vat.check.invoicesDrafts", { n: c.vars.drafts }));
      return t("vat.check.invoicesOpen", { list: parts.join(t("vat.and")), period: per });
    }
    return t(`vat.check.${c.key}.${c.variant}`, v);
  };

  const csvHref = `/export/vat?period=${period.key}`;

  return (
    <>
      <PageHead
        eyebrow={t("common.group.accounting")}
        title={t("vat.titleFor", { period: label(period) })}
        actions={
          <>
            <span className="pill pill-gray" style={{ fontSize: 12.5, padding: "3px 9px", color: "#3a4250" }}>
              {country} · {range(period)}
            </span>
            <ParamSelect param="period" value={period.key} options={options} label={t("vat.period")} width={200} />
            <a className="btn" href={csvHref} download>
              <Icon name="DownloadSimple" size={16} />
              {t("vat.export")}
            </a>
            <FileReturn
              kind="vat"
              period={period.key}
              periodLabel={label(period)}
              filed={filed}
              canFile={canEditIn(ctx, "fileVat")}
              ended={ended}
              figures={figures}
              csvHref={csvHref}
              authority={t("vat.authority")}
              portal={PORTAL[ctx.administration.country] ?? { name: t("vat.authority"), url: "https://taxation-customs.ec.europa.eu/" }}
              action={fileVat}
            />
          </>
        }
      />

      <div className="card card-clip">
        <div className="tbl">
          <div style={{ minWidth: 560 }}>
            <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 12 }}>
              <div>{t("vat.box")}</div>
              <div>{t("vat.description")}</div>
              <div style={{ textAlign: "right" }}>{t("vat.turnover")}</div>
              <div style={{ textAlign: "right" }}>{t("vat.vat")}</div>
            </div>
            {ret.rows.map((r) => (
              <div key={r.box}>
                {r.section && r.kind !== "due" ? (
                  <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "8px 16px", fontSize: 13.5, fontWeight: 600, background: "#f9fafb", borderBottom: "1px solid #eef0f3" }}>
                    <div />
                    <div>{r.section[lang]}</div>
                  </div>
                ) : null}
                {r.kind === "total" ? null : (
                  <div className="n" style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "11px 16px", alignItems: "center", fontSize: 13.5, borderBottom: "1px solid #eef0f3", fontWeight: r.kind ? 600 : 400 }}>
                    <div style={{ color: "#5b6474" }}>{r.box}</div>
                    <div>{r.label[lang]}</div>
                    <div style={{ textAlign: "right" }}>{base(r.baseCents)}</div>
                    <div style={{ textAlign: "right" }}>{vat(r.vatCents, r.kind === "input")}</div>
                  </div>
                )}
              </div>
            ))}
            <div className="n" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 140px", gap: 12, padding: "14px 16px", fontSize: 15, fontWeight: 600, background: "#f8e9ee", color: "#7a1f3d" }}>
              <div>{t(pay ? "vat.toPayBy" : "vat.toReclaimBy", { date: fmt.dateLong(ret.due).replace(/^\S+,?\s/, "") })}</div>
              <div style={{ textAlign: "right" }}>{fmt.money(Math.abs(ret.payableCents))}</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", gap: 16, marginTop: 16 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{t("vat.icpTitle")}</div>
          <div style={{ fontSize: 13, color: "#5b6474", marginBottom: 10 }}>{t("vat.icpSub")}</div>
          {ret.icp.length ? (
            ret.icp.map((c) => (
              <div key={c.relationId} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderTop: "1px solid #f0f2f5", fontSize: 13.5, alignItems: "center" }}>
                <span style={{ minWidth: 0 }}>
                  {c.name}{" "}
                  <span className="n" style={{ color: "#5b6474", fontSize: 12.5 }}>
                    {c.vatNumber}
                  </span>{" "}
                  {c.viesValid === true ? (
                    <span title={t("vat.viesOk")} style={{ verticalAlign: "-2px" }}>
                      <Icon name="SealCheck" size={14} color="#157347" />
                    </span>
                  ) : (
                    <Pill tone={c.viesValid === false ? "red" : "amber"}>{c.viesValid === false ? t("vat.viesInvalid") : t("vat.viesUnchecked")}</Pill>
                  )}
                </span>
                <span className="n" style={{ fontWeight: 500 }}>
                  {fmt.money(c.amountCents)}
                </span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13.5, color: "#5b6474", padding: "7px 0", borderTop: "1px solid #f0f2f5" }}>{t("vat.icpEmpty")}</div>
          )}
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>{t("vat.checksTitle")}</div>
          {d.checks.map((c) => (
            <div key={c.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", fontSize: 13.5 }}>
              <Icon name={c.state === "ok" ? "CheckCircle" : "Warning"} size={18} color={c.state === "ok" ? "#157347" : "#9a5b00"} />
              <span>{checkLabel(c)}</span>
            </div>
          ))}
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>{t("vat.historyTitle")}</div>
          {d.history.length ? (
            d.history.map((h) => {
              const p = { key: monthly ? monthOf(h.periodStart).key : quarterOf(h.periodStart).key, start: h.periodStart };
              return (
                <div key={h.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, padding: "7px 0", borderTop: "1px solid #f0f2f5", fontSize: 13.5 }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 500 }}>{label(p)}</span>{" "}
                    <span className="n" style={{ color: "#5b6474", fontSize: 12.5 }}>
                      {h.filedRef} · {h.filedAt ? fmt.dateMed(h.filedAt) : "—"}
                    </span>
                  </span>
                  <span className="n" style={{ fontWeight: 500 }}>
                    {fmt.money(h.totalCents)}
                  </span>
                </div>
              );
            })
          ) : (
            <div style={{ fontSize: 13.5, color: "#5b6474", padding: "7px 0", borderTop: "1px solid #f0f2f5" }}>{t("vat.historyEmpty")}</div>
          )}
        </div>
      </div>
    </>
  );
}
