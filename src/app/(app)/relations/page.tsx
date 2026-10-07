import type { Metadata } from "next";
import Link from "next/link";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Icon } from "@/components/icon";
import { Empty, PageHead, TabLinks } from "@/components/ui";
import { seesFinancials } from "@/lib/permissions";
import { countryName, flag, COUNTRY_CODES } from "@/lib/countries";
import { initials } from "@/lib/format";
import { RelationDrawer, type RelationData } from "./relation-drawer";

export const metadata: Metadata = { title: "Relations" };

type SP = { tab?: string; q?: string; id?: string; new?: string; archived?: string };

export default async function RelationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp();
  const { t, fmt, locale } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const tab = sp.tab === "suppliers" ? "suppliers" : "customers";
  const q = (sp.q ?? "").trim();
  const showArchived = sp.archived === "1";
  const A = ctx.administration.id;
  const money = seesFinancials(ctx.role);

  const data = await tenant(ctx, async (tx) => {
    const all = await tx.relation.findMany({ where: { administrationId: A }, orderBy: { name: "asc" } });
    const [sales, purchases] = await Promise.all([
      tx.salesInvoice.groupBy({ by: ["customerId"], where: { administrationId: A, status: "OPEN" }, _sum: { totalCents: true, paidCents: true } }),
      tx.purchaseInvoice.groupBy({ by: ["supplierId"], where: { administrationId: A, status: "BOOKED" }, _sum: { totalCents: true, paidCents: true } }),
    ]);
    let selected: RelationData | null = null;
    if (sp.id) {
      const r = all.find((x) => x.id === sp.id);
      if (r) {
        const [si, pi] = await Promise.all([
          tx.salesInvoice.findMany({ where: { administrationId: A, customerId: r.id }, orderBy: { issueDate: "desc" }, take: 8 }),
          tx.purchaseInvoice.findMany({ where: { administrationId: A, supplierId: r.id }, orderBy: { issueDate: "desc" }, take: 8 }),
        ]);
        selected = {
          ...r,
          viesCheckedAt: r.viesCheckedAt?.toISOString() ?? null,
          archived: Boolean(r.archivedAt),
          invoices: [
            ...si.map((i) => ({ id: i.id, kind: "sales" as const, number: i.number ?? t("relations.statusDRAFT"), date: fmt.dateMed(i.issueDate), total: fmt.money(i.totalCents), status: i.status, sort: i.issueDate.getTime() })),
            ...pi.map((i) => ({ id: i.id, kind: "purchase" as const, number: i.number, date: fmt.dateMed(i.issueDate), total: fmt.money(i.totalCents), status: i.status, sort: i.issueDate.getTime() })),
          ]
            .sort((a, b) => b.sort - a.sort)
            .slice(0, 8),
        };
      }
    }
    return { all, sales, purchases, selected };
  });

  const openOf = (r: (typeof data.all)[number]) => {
    let s = 0;
    if (r.kind !== "SUPPLIER") {
      const x = data.sales.find((g) => g.customerId === r.id);
      s += (x?._sum.totalCents ?? 0) - (x?._sum.paidCents ?? 0);
    }
    if (r.kind !== "CUSTOMER") {
      const x = data.purchases.find((g) => g.supplierId === r.id);
      s += (x?._sum.totalCents ?? 0) - (x?._sum.paidCents ?? 0);
    }
    return s;
  };
  const visible = data.all.filter((r) => showArchived || !r.archivedAt);
  const inTab = (r: (typeof data.all)[number], k: string) => r.kind === "BOTH" || (k === "customers" ? r.kind === "CUSTOMER" : r.kind === "SUPPLIER");
  const ql = q.toLowerCase();
  const rows = visible.filter((r) => inTab(r, tab) && (!ql || `${r.name} ${r.vatNumber ?? ""} ${r.city ?? ""} ${r.typeLabel ?? ""}`.toLowerCase().includes(ql)));
  const href = (p: Partial<SP>) => {
    const u = new URLSearchParams();
    const merged = { tab, q: q || undefined, archived: showArchived ? "1" : undefined, ...p };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    return `/relations?${u.toString()}`;
  };
  const cols = `minmax(0,1.5fr) 130px 190px minmax(0,1.3fr) 90px${money ? " 120px" : ""}`;
  const canCustomers = canEditIn(ctx, "sales");
  const canSuppliers = canEditIn(ctx, "purchases");

  return (
    <>
      <PageHead
        eyebrow={t("common.group.daily")}
        title={t("relations.title")}
        actions={
          canCustomers || canSuppliers ? (
            <Link href={href({ new: "1", id: undefined })} className="btn btn-primary" scroll={false}>
              <Icon name="Plus" size={16} />
              {t("relations.newRelation")}
            </Link>
          ) : null
        }
      />
      <form className="row" style={{ gap: 10, marginBottom: 14, flexWrap: "wrap" }} action="/relations">
        <input type="hidden" name="tab" value={tab} />
        <div className="search" style={{ width: "min(320px,100%)", height: 36, borderRadius: 8 }}>
          <Icon name="MagnifyingGlass" />
          <input name="q" defaultValue={q} placeholder={t("relations.searchPlaceholder")} />
        </div>
        <Link href={href({ archived: showArchived ? undefined : "1" })} className="chip" aria-pressed={showArchived}>
          <Icon name="Archive" size={15} />
          {t("relations.showArchived")}
        </Link>
      </form>
      <div className="card card-clip">
        <TabLinks
          active={tab}
          tabs={[
            { key: "customers", label: t("relations.customers"), count: visible.filter((r) => inTab(r, "customers")).length, href: href({ tab: "customers" }) },
            { key: "suppliers", label: t("relations.suppliers"), count: visible.filter((r) => inTab(r, "suppliers")).length, href: href({ tab: "suppliers" }) },
          ]}
        />
        <div className="tbl">
          <div style={{ minWidth: 900 }}>
            <div className="tbl-head" style={{ gridTemplateColumns: cols }}>
              <div>{t("relations.colName")}</div>
              <div>{t("relations.colCountry")}</div>
              <div>{t("relations.colVat")}</div>
              <div>{t("relations.colExcise")}</div>
              <div>{t("relations.colTerms")}</div>
              {money ? <div className="right">{t("relations.colOpen")}</div> : null}
            </div>
            {rows.map((r) => {
              const open = openOf(r);
              return (
                <Link key={r.id} href={href({ id: r.id, new: undefined })} scroll={false} className="tbl-row" style={{ gridTemplateColumns: cols, opacity: r.archivedAt ? 0.6 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <div style={{ width: 30, height: 30, flex: "none", borderRadius: 8, background: "#f0f2f5", display: "grid", placeItems: "center", fontWeight: 600, fontSize: 12, color: "#3a4250" }}>{initials(r.name)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontWeight: 500 }}>{r.name}</div>
                      <div className="cell-sub">{r.archivedAt ? t("relations.archived") : r.typeLabel ?? t(`relations.kind${r.kind}`)}</div>
                    </div>
                  </div>
                  <div className="truncate">
                    {flag(r.country)} {countryName(r.country, locale)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="n" style={{ fontSize: 13, color: "#3a4250" }}>{r.vatNumber ?? "—"}</div>
                    {r.vatNumber ? (
                      <div style={{ fontSize: 11.5, color: r.viesValid === true ? "#157347" : r.viesValid === false ? "#b42318" : "#9a5b00", display: "flex", gap: 4, alignItems: "center" }}>
                        <Icon name={r.viesValid === true ? "CheckCircle" : r.viesValid === false ? "WarningCircle" : "Warning"} size={12} />
                        {r.viesValid === true && r.viesCheckedAt
                          ? t("relations.viesValid", { date: fmt.date(r.viesCheckedAt) })
                          : r.viesValid === false
                            ? t("relations.viesInvalid")
                            : t("relations.viesNotChecked")}
                      </div>
                    ) : null}
                  </div>
                  <div className="truncate" style={{ fontSize: 13, color: "#3a4250" }}>
                    {[r.exciseStatus, r.exciseNumber].filter(Boolean).join(" · ") || "—"}
                  </div>
                  <div className="muted">{t("relations.days", { n: r.paymentTermsDays })}</div>
                  {money ? <div className="n right" style={{ fontWeight: 600 }}>{open ? fmt.money(open) : "—"}</div> : null}
                </Link>
              );
            })}
            {!rows.length ? <Empty icon="AddressBook" color="#8a93a3" title={q ? t("common.emptySearch") : t("relations.empty")} /> : null}
          </div>
        </div>
      </div>
      <RelationDrawer
        open={Boolean(sp.new === "1" || data.selected)}
        relation={data.selected}
        defaultKind={tab === "suppliers" ? "SUPPLIER" : "CUSTOMER"}
        closeHref={href({ id: undefined, new: undefined })}
        countries={COUNTRY_CODES.map((c) => ({ code: c, label: `${flag(c)} ${countryName(c, locale)}` }))}
        adminCountry={ctx.administration.country}
        canEditCustomers={canCustomers}
        canEditSuppliers={canSuppliers}
      />
    </>
  );
}
