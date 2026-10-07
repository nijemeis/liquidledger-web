import type { Metadata } from "next";
import Link from "next/link";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Icon } from "@/components/icon";
import { Empty, PageHead, Pill, Stat, type Tone } from "@/components/ui";
import { canView } from "@/lib/permissions";
import { exciseReturn, monthOf, parsePeriod } from "@/lib/domain/returns";
import { ParamSelect } from "../reports/_components/nav";
import { FileReturn, type Figure } from "../reports/_components/file-return";
import { fileExcise } from "./actions";
import { CustomsDocDrawer } from "./customs-doc";

export const metadata: Metadata = { title: "Excise & customs" };

const COLS = "minmax(0,2fr) 120px 90px 90px minmax(0,1.6fr) 120px";
const DOC_COLS = "160px minmax(0,1.5fr) minmax(0,1.4fr) 200px";

const STATUS_TONE: Record<string, Tone> = { RELEASED: "green", ACCEPTED: "green", AWAITING: "blue", DRAFT: "blue", MISSING: "red", REJECTED: "red" };
const STATUS_ORDER: Record<string, number> = { MISSING: 0, REJECTED: 1, DRAFT: 2, AWAITING: 3, ACCEPTED: 4, RELEASED: 5 };

const PORTAL: Record<string, { name: string; url: string }> = {
  NL: { name: "Douane — Mijn Douane / EMCS", url: "https://www.belastingdienst.nl/wps/wcm/connect/nl/douane_voor_bedrijven/content/accijns-aangifte-doen" },
};

export default async function ExcisePage({ searchParams }: { searchParams: Promise<{ period?: string; doc?: string; docs?: string }> }) {
  const ctx = await requireApp("fileExcise");
  const { t, fmt, locale } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const A = ctx.administration.id;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const lastMonth = monthOf(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)));
  const asked = parsePeriod(sp.period);
  const period = asked && !asked.key.includes("Q") && asked.start <= today ? asked : lastMonth;
  const showDocs = canView(ctx.role, "customs");
  const canDocs = canEditIn(ctx, "customs");

  const d = await tenant(ctx, async (tx) => {
    const ret = await exciseReturn(tx, A, period);
    const [docs, shipments] = showDocs
      ? await Promise.all([
          tx.customsDocument.findMany({ where: { administrationId: A }, orderBy: { createdAt: "desc" } }),
          tx.shipment.findMany({ where: { administrationId: A }, orderBy: { createdAt: "desc" }, select: { id: true, ref: true, origin: true, destination: true, direction: true } }),
        ])
      : [[], []];
    const invIds = docs.map((x) => x.salesInvoiceId).filter((x): x is string => !!x);
    const invoices = invIds.length ? await tx.salesInvoice.findMany({ where: { administrationId: A, id: { in: invIds } }, select: { id: true, number: true, customerId: true } }) : [];
    const customers = invoices.length ? await tx.relation.findMany({ where: { administrationId: A, id: { in: invoices.map((i) => i.customerId) } }, select: { id: true, name: true, city: true } }) : [];
    const fileIds = docs.map((x) => x.documentId).filter((x): x is string => !!x);
    const files = fileIds.length ? await tx.document.findMany({ where: { administrationId: A, id: { in: fileIds } }, select: { id: true, filename: true } }) : [];
    const filer = ret.filed?.filedById ? await tx.membership.findFirst({ where: { administrationId: A, userId: ret.filed.filedById }, select: { user: { select: { name: true } } } }) : null;
    return { ret, docs, shipments, invoices, customers, files, filerName: filer?.user.name ?? null };
  });
  const { ret } = d;

  const monthName = (dt: Date) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, { month: "long", timeZone: "UTC" }).format(dt);
  const periodLabel = fmt.monthLong(period.start);
  const options = Array.from({ length: 18 }, (_, i) => monthOf(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)))).map((p) => ({
    value: p.key,
    label: fmt.monthLong(p.start) + (p.end >= today ? ` · ${t("excise.inProgress")}` : ""),
  }));
  const ended = period.end < today;
  const filed = ret.filed?.status === "FILED" && ret.filed.filedRef ? { ref: ret.filed.filedRef, at: fmt.dateMed(ret.filed.filedAt ?? today), by: d.filerName ?? undefined } : null;

  const eur = (cents: number) => fmt.money(cents);
  const basisText = (r: (typeof ret.rows)[number]) => {
    const hl = fmt.num(r.hl, 2);
    switch (r.basisKind) {
      case "HL_PRODUCT":
        return t("excise.basis.product", { hl, rate: eur(r.rateCents) });
      case "HL_PER_ABV":
        return t("excise.basis.abv", { hl, abv: fmt.num(r.abvBp / 100, r.abvBp % 100 ? 1 : 0), rate: eur(r.rateCents) });
      case "HL_PER_PLATO":
        return t("excise.basis.plato", { hl, plato: fmt.num((r.platoTenths ?? 0) / 10, 1), rate: eur(r.rateCents) });
      case "HL_PURE_ALCOHOL":
        return t("excise.basis.alcohol", { hl: fmt.num(r.alcoholHl, 3), rate: eur(r.rateCents) });
      default:
        return "—";
    }
  };

  const figures: Figure[] = [
    { label: t("excise.fig.licence"), value: ret.licence ?? "—" },
    { label: t("excise.fig.period"), value: `${fmt.date(period.start)} – ${fmt.dateMed(period.end)}` },
    { label: t("excise.fig.byCategory"), value: "", section: true },
    ...Object.entries(
      ret.rows.reduce<Record<string, { hl: number; alc: number; cents: number; units: number }>>((acc, r) => {
        const c = (acc[r.category] ??= { hl: 0, alc: 0, cents: 0, units: 0 });
        c.hl += r.hl;
        c.alc += r.alcoholHl;
        c.cents += r.exciseCents;
        c.units += r.units;
        return acc;
      }, {}),
    ).map(([cat, v]) => ({
      label: t(`excise.cat.${cat}`),
      sub: cat === "SPIRITS" ? t("excise.fig.hlAlc", { hl: fmt.num(v.alc, 3) }) : t("excise.fig.hl", { hl: fmt.num(v.hl, 2) }),
      value: eur(v.cents),
    })),
    { label: t("excise.fig.suspended"), value: t("excise.btl", { n: fmt.int(ret.shippedSuspendedUnits) }) },
    { label: t("excise.fig.total"), value: eur(ret.totalCents), strong: true },
  ];

  const shipmentById = new Map(d.shipments.map((s) => [s.id, s]));
  const invById = new Map(d.invoices.map((i) => [i.id, i]));
  const custById = new Map(d.customers.map((c) => [c.id, c]));
  const fileById = new Map(d.files.map((f) => [f.id, f.filename]));
  const docs = [...d.docs].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.createdAt.getTime() - a.createdAt.getTime());
  const DOC_LIMIT = 8;
  const allDocs = sp.docs === "all";
  const shownDocs = allDocs ? docs : docs.slice(0, DOC_LIMIT);
  const editing = sp.doc === "new" ? "new" : sp.doc ? d.docs.find((x) => x.id === sp.doc) : undefined;
  const csvHref = `/export/excise?period=${period.key}`;

  return (
    <>
      <PageHead
        eyebrow={t("common.group.trade")}
        title={t("common.nav.excise")}
        actions={
          <>
            <ParamSelect param="period" value={period.key} options={options} label={t("excise.period")} width={215} />
            <a className="btn" href={csvHref} download>
              <Icon name="DownloadSimple" size={16} />
              {t("excise.export")}
            </a>
            <FileReturn
              kind="excise"
              period={period.key}
              periodLabel={periodLabel}
              filed={filed}
              canFile={canEditIn(ctx, "fileExcise")}
              ended={ended}
              figures={figures}
              csvHref={csvHref}
              authority={ctx.administration.exciseAuthority ?? t("excise.customs")}
              portal={PORTAL[ctx.administration.country] ?? { name: ctx.administration.exciseAuthority ?? t("excise.customs"), url: "https://taxation-customs.ec.europa.eu/" }}
              action={fileExcise}
            />
          </>
        }
      />

      <div className="grid-cards">
        <Stat
          label={t("excise.due", { month: monthName(period.start) })}
          value={eur(ret.totalCents)}
          note={filed ? t("excise.dueFiled", { date: fmt.dateMed(ret.due) }) : t("excise.payBy", { date: fmt.dateMed(ret.due) })}
        />
        <Stat
          label={t("excise.released")}
          value={t("excise.btl", { n: fmt.int(ret.releasedUnits) })}
          note={ret.releasedFrom.length ? t("excise.releasedFrom", { names: ret.releasedFrom.join(", ") }) : t("excise.noReleases")}
        />
        <Stat label={t("excise.suspended")} value={t("excise.btl", { n: fmt.int(ret.shippedSuspendedUnits) })} note={t("excise.suspendedNote")} />
        <div className="card stat">
          <div className="stat-label">{t("excise.licence")}</div>
          <div className="n" style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{ret.licence ?? "—"}</div>
          <div className="stat-note">{ret.licence ? t("excise.licenceNote") : <Link href="/settings">{t("excise.addLicence")}</Link>}</div>
        </div>
      </div>

      <div className="card card-clip" style={{ marginBottom: 20 }}>
        <div style={{ padding: "14px 16px", fontWeight: 600, fontSize: 15, borderBottom: "1px solid #e4e7ec", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span>{t("excise.returnTitle", { month: monthName(period.start) })}</span>
          {filed ? <Pill tone="green" icon="CheckCircle">{t("excise.filedPill", { ref: filed.ref })}</Pill> : !ended ? <Pill tone="amber">{t("excise.inProgress")}</Pill> : null}
        </div>
        {ret.rows.length ? (
          <div className="tbl">
            <div style={{ minWidth: 860 }}>
              <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 12 }}>
                <div>{t("excise.col.product")}</div>
                <div>{t("excise.col.category")}</div>
                <div style={{ textAlign: "right" }}>{t("excise.col.bottles")}</div>
                <div style={{ textAlign: "right" }}>{t("excise.col.hl")}</div>
                <div>{t("excise.col.calc")}</div>
                <div style={{ textAlign: "right" }}>{t("excise.col.excise")}</div>
              </div>
              {ret.rows.map((r) => (
                <div key={r.productId} className="tbl-row n" style={{ gridTemplateColumns: COLS, gap: 12, padding: "11px 16px", borderBottom: "1px solid #eef0f3" }}>
                  <div style={{ fontWeight: 500, minWidth: 0 }} className="truncate" title={`${r.sku} · ${r.name}`}>
                    {r.name}
                  </div>
                  <div style={{ color: "#5b6474" }}>{t(`excise.cat.${r.category}`)}</div>
                  <div style={{ textAlign: "right" }}>{fmt.int(r.units)}</div>
                  <div style={{ textAlign: "right" }}>{fmt.num(r.hl, 2)}</div>
                  <div style={{ fontSize: 12.5, color: "#5b6474" }}>{basisText(r)}</div>
                  <div style={{ textAlign: "right", fontWeight: 600 }}>{eur(r.exciseCents)}</div>
                </div>
              ))}
              <div className="n" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 120px", gap: 12, padding: "13px 16px", fontSize: 14.5, fontWeight: 600, background: "#f9fafb" }}>
                <div>{t("common.total")}</div>
                <div style={{ textAlign: "right" }}>{eur(ret.totalCents)}</div>
              </div>
            </div>
          </div>
        ) : (
          <Empty icon="SealCheck" title={t("excise.emptyTitle")} color="#8a93a3">
            <div style={{ fontSize: 13.5 }}>{t("excise.emptyText", { month: periodLabel })}</div>
          </Empty>
        )}
      </div>

      {showDocs ? (
        <div className="card card-clip">
          <div style={{ padding: "10px 16px", minHeight: 50, fontWeight: 600, fontSize: 15, borderBottom: "1px solid #e4e7ec", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span>{t("excise.docsTitle")}</span>
            {canDocs ? (
              <Link href={`/excise?period=${period.key}${allDocs ? "&docs=all" : ""}&doc=new`} scroll={false} className="btn btn-sm">
                <Icon name="Plus" size={15} />
                {t("excise.addDoc")}
              </Link>
            ) : null}
          </div>
          {docs.length ? (
            <div className="tbl">
              <div style={{ minWidth: 820 }}>
                <div className="tbl-head" style={{ gridTemplateColumns: DOC_COLS, gap: 12 }}>
                  <div>{t("excise.col.document")}</div>
                  <div>{t("excise.col.reference")}</div>
                  <div>{t("excise.col.shipment")}</div>
                  <div>{t("common.status")}</div>
                </div>
                {shownDocs.map((doc) => {
                  const s = doc.shipmentId ? shipmentById.get(doc.shipmentId) : undefined;
                  const inv = doc.salesInvoiceId ? invById.get(doc.salesInvoiceId) : undefined;
                  const cust = inv ? custById.get(inv.customerId) : undefined;
                  const where = s
                    ? `${s.ref} · ${doc.notes && !doc.notes.startsWith("Drafted") ? doc.notes : s.direction === "IMPORT" ? s.origin : s.destination}`
                    : inv
                      ? `${inv.number ?? t("excise.draftInvoice")} · ${cust?.name ?? ""}${cust?.city ? `, ${cust.city}` : ""}`
                      : (doc.notes ?? "—");
                  const statusText = doc.status === "DRAFT" && doc.salesInvoiceId ? t("excise.docStatus.DRAFT_AUTO") : doc.status === "MISSING" ? t("excise.docStatus.MISSING_LONG") : doc.status === "AWAITING" && doc.type === "E_AD" ? t("excise.docStatus.AWAITING_RECEIPT") : t(`excise.docStatus.${doc.status}`);
                  const inner = (
                    <>
                      <div style={{ fontWeight: 500 }}>{t(`excise.docType.${doc.type}`)}</div>
                      <div className="n truncate" style={{ fontSize: 13, color: "#3a4250", display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="truncate">{doc.reference ?? "—"}</span>
                        {doc.documentId ? (
                          <span title={fileById.get(doc.documentId) ?? ""} style={{ display: "inline-flex" }}>
                            <Icon name="Paperclip" size={14} color="#5b6474" />
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate">{where}</div>
                      <div>
                        <Pill tone={STATUS_TONE[doc.status] ?? "gray"}>{statusText}</Pill>
                      </div>
                    </>
                  );
                  return canDocs ? (
                    <Link key={doc.id} href={`/excise?period=${period.key}${allDocs ? "&docs=all" : ""}&doc=${doc.id}`} scroll={false} className="tbl-row" style={{ gridTemplateColumns: DOC_COLS, gap: 12, borderBottom: "1px solid #eef0f3" }}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={doc.id} className="tbl-row" style={{ gridTemplateColumns: DOC_COLS, gap: 12, borderBottom: "1px solid #eef0f3" }}>
                      {inner}
                    </div>
                  );
                })}
              </div>
              {docs.length > DOC_LIMIT ? (
                <div style={{ padding: "10px 16px", fontSize: 13, borderTop: "1px solid #eef0f3" }}>
                  <Link href={`/excise?period=${period.key}${allDocs ? "" : "&docs=all"}`} scroll={false} style={{ fontWeight: 500 }}>
                    {allDocs ? t("excise.showFewer") : t("excise.showAllDocs", { n: docs.length })}
                  </Link>
                </div>
              ) : null}
            </div>
          ) : (
            <Empty icon="FileText" title={t("excise.noDocs")} color="#8a93a3" />
          )}
        </div>
      ) : null}

      {editing && canDocs ? (
        <CustomsDocDrawer
          doc={
            editing === "new"
              ? null
              : {
                  id: editing.id,
                  type: editing.type,
                  reference: editing.reference ?? "",
                  shipmentId: editing.shipmentId ?? "",
                  status: editing.status,
                  notes: editing.notes ?? "",
                  invoice: editing.salesInvoiceId ? (invById.get(editing.salesInvoiceId)?.number ?? null) : null,
                  file: editing.documentId ? { id: editing.documentId, name: fileById.get(editing.documentId) ?? "document" } : null,
                }
          }
          shipments={d.shipments.map((s) => ({ id: s.id, label: `${s.ref} · ${s.origin} → ${s.destination}` }))}
        />
      ) : null}
    </>
  );
}
