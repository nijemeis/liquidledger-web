import type { Metadata } from "next";
import Link from "next/link";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Empty, PageHead, Stat, TabLinks, type Tone } from "@/components/ui";
import { seesFinancials } from "@/lib/permissions";
import { ratesOn } from "@/lib/domain/excise";
import { daysOverdue, isCreditNote, peekInvoiceNumber } from "@/lib/domain/sales";
import { stockLevels } from "@/lib/domain/stock";
import { InvoiceDetail, InvoiceEditor, SalesActions, type DetailData, type EditorData } from "./sales-client";

export const metadata: Metadata = { title: "Sales invoices" };

type TabKey = "all" | "draft" | "open" | "overdue" | "paid";
const TABS: TabKey[] = ["all", "draft", "open", "overdue", "paid"];
const COLS = "130px minmax(0,1.6fr) 80px 80px 110px 120px 130px";

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ tab?: string; id?: string; new?: string; customer?: string }> }) {
  const ctx = await requireApp("sales");
  const { t, fmt, locale } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const A = ctx.administration.id;
  const canEdit = canEditIn(ctx, "sales");
  const fin = seesFinancials(ctx.role);
  const tab: TabKey = TABS.includes(sp.tab as TabKey) ? (sp.tab as TabKey) : "all";
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const lastMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const lastMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));

  const d = await tenant(ctx, async (tx) => {
    const [invoices, customers] = await Promise.all([
      tx.salesInvoice.findMany({ where: { administrationId: A }, orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }] }),
      tx.relation.findMany({ where: { administrationId: A, kind: { in: ["CUSTOMER", "BOTH"] }, archivedAt: null }, orderBy: { name: "asc" } }),
    ]);
    const selected = sp.id ? invoices.find((i) => i.id === sp.id) ?? null : null;
    const wantEditor = canEdit && (sp.new === "1" || selected?.status === "DRAFT");

    let editor: Omit<EditorData, "customers" | "adminCountry"> | null = null;
    if (wantEditor) {
      const [products, warehouses, rates, levels, nextNumber, usage, draft] = await Promise.all([
        tx.product.findMany({ where: { administrationId: A, archivedAt: null }, include: { prices: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
        tx.warehouse.findMany({ where: { administrationId: A, archivedAt: null }, orderBy: { name: "asc" } }),
        ratesOn(tx, ctx.administration.country, today),
        stockLevels(tx, A),
        peekInvoiceNumber(tx, A, today.getUTCFullYear(), ctx.administration.invoicePrefix),
        tx.salesInvoice.groupBy({ by: ["customerId"], where: { administrationId: A }, _count: { _all: true }, orderBy: { _count: { customerId: "desc" } }, take: 8 }),
        selected?.status === "DRAFT" ? tx.salesInvoiceLine.findMany({ where: { invoiceId: selected.id }, orderBy: { sort: "asc" } }) : Promise.resolve(null),
      ]);
      const stock: Record<string, Record<string, number>> = {};
      for (const [pid, m] of levels) stock[pid] = Object.fromEntries(m);
      editor = {
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          category: p.category,
          volumeMl: p.volumeMl,
          abvBp: p.abvBp,
          platoTenths: p.platoTenths,
          depositCents: p.depositCents,
          unitsPerCase: p.unitsPerCase,
          prices: p.prices.map((x) => ({ list: x.list, unitPriceCents: x.unitPriceCents, validFrom: x.validFrom })),
        })),
        warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, kind: w.kind })),
        rates: [...rates.values()].map((r) => ({ country: r.country, category: r.category, basis: r.basis, rateCents: r.rateCents, validFrom: r.validFrom })),
        stock,
        nextNumber,
        topCustomerIds: usage.map((u) => u.customerId),
        today: today.toISOString().slice(0, 10),
        draft:
          selected?.status === "DRAFT" && draft
            ? {
                id: selected.id,
                customerId: selected.customerId,
                issueDate: selected.issueDate.toISOString().slice(0, 10),
                dueDate: selected.dueDate.toISOString().slice(0, 10),
                warehouseId: selected.warehouseId,
                reference: selected.reference,
                lines: draft.map((l) => ({ productId: l.productId ?? "", qtyUnits: l.qtyUnits, unitPriceCents: l.unitPriceCents })),
              }
            : null,
      };
    }

    let detail: Omit<DetailData, "customer"> & { customerId: string } | null = null;
    if (selected && selected.status !== "DRAFT") {
      const [lines, payments, customs, banks, related] = await Promise.all([
        tx.salesInvoiceLine.findMany({ where: { invoiceId: selected.id }, orderBy: { sort: "asc" } }),
        selected.number
          ? tx.journalLine.findMany({
              where: { administrationId: A, accountCode: "1300", description: selected.number, creditCents: { gt: 0 }, entry: { source: "BANK" } },
              include: { entry: { select: { date: true, title: true, sourceId: true } } },
              orderBy: { entry: { date: "asc" } },
            })
          : Promise.resolve([]),
        tx.customsDocument.findMany({ where: { administrationId: A, salesInvoiceId: selected.id } }),
        tx.bankAccount.findMany({ where: { administrationId: A, archivedAt: null, currency: ctx.administration.baseCurrency }, orderBy: { createdAt: "asc" } }),
        isCreditNote(selected)
          ? tx.salesInvoice.findFirst({ where: { administrationId: A, number: selected.reference ?? "-" }, select: { id: true, number: true } })
          : tx.salesInvoice.findFirst({ where: { administrationId: A, reference: selected.number ?? "-", number: { startsWith: "CN-" } }, select: { id: true, number: true } }),
      ]);
      const products = await tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId).filter((x): x is string => Boolean(x)) } }, select: { id: true, sku: true, unitsPerCase: true } });
      const wh = selected.warehouseId ? await tx.warehouse.findUnique({ where: { id: selected.warehouseId }, select: { name: true } }) : null;
      detail = {
        customerId: selected.customerId,
        invoice: {
          id: selected.id,
          number: selected.number ?? "",
          status: selected.status,
          creditNote: isCreditNote(selected),
          overdueDays: daysOverdue(selected, now),
          taxRegime: selected.taxRegime,
          issueDate: selected.issueDate,
          dueDate: selected.dueDate,
          netCents: selected.netCents,
          exciseCents: selected.exciseCents,
          depositCents: selected.depositCents,
          vatCents: selected.vatCents,
          totalCents: selected.totalCents,
          paidCents: selected.paidCents,
          paidAt: selected.paidAt,
          sentAt: selected.sentAt,
          lastReminderAt: selected.lastReminderAt,
          reference: selected.reference,
          notes: selected.notes,
          warehouse: wh?.name ?? null,
        },
        lines: lines.map((l) => {
          const p = products.find((x) => x.id === l.productId);
          return { id: l.id, description: l.description, sku: p?.sku ?? null, unitsPerCase: p?.unitsPerCase ?? 1, qtyUnits: l.qtyUnits, unitPriceCents: l.unitPriceCents, netCents: l.netCents, exciseCents: l.exciseCents, exciseFormula: l.exciseFormula, depositCents: l.depositCents, vatRateBp: l.vatRateBp, vatCents: l.vatCents };
        }),
        payments: payments.map((p) => ({ id: p.id, date: p.entry.date, amountCents: p.creditCents, viaBank: p.entry.sourceId !== selected.id })),
        customs: customs.map((c) => ({ id: c.id, type: c.type, status: c.status, reference: c.reference })),
        banks: banks.map((b) => ({ id: b.id, name: b.name, iban: b.iban })),
        related: related?.id && related.id !== selected.id ? { id: related.id, number: related.number ?? "" } : null,
      };
    }
    return { invoices, customers, editor, detail, selected };
  });

  // ── Lists & summaries ─────────────────────────────────────────────────────
  const custById = new Map(d.customers.map((c) => [c.id, c]));
  const missing = d.invoices.filter((i) => !custById.has(i.customerId));
  if (missing.length) {
    // Archived or non-customer relations still show on old invoices.
    const extra = await tenant(ctx, (tx) => tx.relation.findMany({ where: { administrationId: A, id: { in: [...new Set(missing.map((i) => i.customerId))] } } }));
    for (const r of extra) custById.set(r.id, r);
  }
  const isOverdue = (i: (typeof d.invoices)[number]) => i.status === "OPEN" && i.dueDate < today;
  const statusOf = (i: (typeof d.invoices)[number]): TabKey | "credited" => (i.status === "DRAFT" ? "draft" : i.status === "PAID" ? "paid" : i.status === "CREDITED" ? "credited" : isOverdue(i) ? "overdue" : "open");
  const counts = Object.fromEntries(TABS.map((k) => [k, k === "all" ? d.invoices.length : d.invoices.filter((i) => statusOf(i) === k).length])) as Record<TabKey, number>;
  const shown = tab === "all" ? d.invoices : d.invoices.filter((i) => statusOf(i) === tab);

  const open = d.invoices.filter((i) => i.status === "OPEN");
  const openSum = open.reduce((a, i) => a + i.totalCents - i.paidCents, 0);
  const overdueSum = open.filter(isOverdue).reduce((a, i) => a + i.totalCents - i.paidCents, 0);
  const invoicedLastMonth = d.invoices
    .filter((i) => (i.status === "OPEN" || i.status === "PAID") && i.issueDate >= lastMonthStart && i.issueDate <= lastMonthEnd)
    .reduce((a, i) => a + i.totalCents, 0);
  const since = new Date(today.getTime() - 90 * 86400_000);
  const paidRecent = d.invoices.filter((i) => i.status === "PAID" && i.paidAt && i.paidAt >= since);
  const avgDays = paidRecent.length ? Math.round(paidRecent.reduce((a, i) => a + (i.paidAt!.getTime() - i.issueDate.getTime()) / 86400_000, 0) / paidRecent.length) : null;
  const monthName = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, { month: "long", timeZone: "UTC" }).format(lastMonthStart);

  const pill = (i: (typeof d.invoices)[number]): { tone: Tone; label: string } => {
    if (isCreditNote(i)) return { tone: "gray", label: t("sales.status.creditNote") };
    const s = statusOf(i);
    if (s === "overdue") return { tone: "red", label: t("sales.status.overdueD", { n: daysOverdue(i, now) }) };
    const map: Record<string, Tone> = { draft: "gray", open: "blue", paid: "green", credited: "gray" };
    return { tone: map[s] ?? "gray", label: t(`sales.status.${s}`) };
  };
  const href = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    if (tab !== "all") q.set("tab", tab);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const s = q.toString();
    return `/sales${s ? `?${s}` : ""}`;
  };
  const closeHref = href({});

  const customersForClient = d.customers.map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    country: c.country,
    vatNumber: c.vatNumber,
    taxRegimeOverride: c.taxRegimeOverride,
    paymentTermsDays: c.paymentTermsDays,
    defaultPriceList: c.defaultPriceList,
    email: c.email,
  }));

  return (
    <>
      <PageHead eyebrow={t("common.group.daily")} title={t("common.nav.sales")} actions={canEdit ? <SalesActions newHref={href({ new: "1" })} /> : null} />

      {fin ? (
        <div className="grid-cards">
          <Stat label={t("sales.cards.open")} value={fmt.money(openSum)} />
          <Stat label={t("sales.cards.overdue")} value={fmt.money(overdueSum)} valueColor="#b42318" />
          <Stat label={t("sales.cards.invoiced", { month: monthName })} value={fmt.money(invoicedLastMonth)} />
          <Stat label={t("sales.cards.avgDays")} value={avgDays === null ? "—" : t("sales.cards.days", { n: avgDays })} />
        </div>
      ) : null}

      <div className="card card-clip">
        <TabLinks active={tab} tabs={TABS.map((k) => ({ key: k, label: t(`sales.tabs.${k}`), count: counts[k], href: k === "all" ? "/sales" : `/sales?tab=${k}` }))} />
        {shown.length ? (
          <div className="tbl">
            <div style={{ minWidth: 860 }}>
              <div className="tbl-head" style={{ gridTemplateColumns: COLS }}>
                <div>{t("sales.col.number")}</div>
                <div>{t("sales.col.customer")}</div>
                <div>{t("common.date")}</div>
                <div>{t("common.due")}</div>
                <div className="right">{fin ? t("sales.col.excise") : ""}</div>
                <div className="right">{fin ? t("common.total") : ""}</div>
                <div>{t("common.status")}</div>
              </div>
              {shown.map((i) => {
                const c = custById.get(i.customerId);
                const p = pill(i);
                return (
                  <Link key={i.id} href={href({ id: i.id })} scroll={false} className="tbl-row" style={{ gridTemplateColumns: COLS }}>
                    <div className="n" style={{ color: "#7a1f3d", fontWeight: 500 }}>{i.number ?? t("sales.draftNo")}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="cell-main truncate">{c?.name ?? "—"}</div>
                      <div className="cell-sub truncate">{[c?.city, c?.country].filter(Boolean).join(", ")}</div>
                    </div>
                    <div className="n muted">{fmt.date(i.issueDate)}</div>
                    <div className="n muted">{fmt.date(i.dueDate)}</div>
                    <div className="n right muted">{fin ? (i.exciseCents ? fmt.money(i.exciseCents) : "—") : ""}</div>
                    <div className="n right" style={{ fontWeight: 600 }}>{fin ? fmt.money(i.totalCents) : ""}</div>
                    <div>
                      <span className={`pill pill-${p.tone}`}>{p.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : (
          <Empty icon={tab === "overdue" ? "Confetti" : "FileText"} color={tab === "overdue" ? "#157347" : "#8a93a3"} title={tab === "overdue" ? t("sales.empty.overdue") : t("sales.empty.title")}>
            {tab === "all" && canEdit ? <div style={{ marginTop: 10 }}><Link className="btn btn-primary" href={href({ new: "1" })}>{t("sales.newInvoice")}</Link></div> : null}
          </Empty>
        )}
      </div>

      {d.editor ? (
        <InvoiceEditor
          key={d.editor.draft?.id ?? "new"}
          data={{ ...d.editor, customers: customersForClient, adminCountry: ctx.administration.country, preselect: sp.customer ?? null }}
          closeHref={closeHref}
        />
      ) : null}
      {d.detail ? (
        <InvoiceDetail
          key={d.detail.invoice.id}
          data={{ ...d.detail, customer: customersForClient.find((c) => c.id === d.detail!.customerId) ?? { id: d.detail.customerId, name: custById.get(d.detail.customerId)?.name ?? "—", city: null, country: "", vatNumber: null, taxRegimeOverride: null, paymentTermsDays: 0, defaultPriceList: null, email: null } }}
          canEdit={canEdit}
          fin={fin}
          closeHref={closeHref}
          relatedHref={d.detail.related ? href({ id: d.detail.related.id }) : null}
        />
      ) : null}
    </>
  );
}
