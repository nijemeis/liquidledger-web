import Link from "next/link";
import type { Plan } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { requireStaff } from "@/lib/admin/staff";
import { INVOICE_STATUS_TONE } from "@/lib/admin/format";
import { PLANS } from "@/lib/domain/setup";
import { Icon } from "@/components/icon";
import { Pill } from "@/components/ui";
import { GenerateButton, InvoiceActions } from "./billing-client";

const PLAN_ORDER: Plan[] = ["STARTER", "BUSINESS", "PRO", "ENTERPRISE"];
const COLS = "130px minmax(0,1.6fr) 100px 120px 110px 150px 170px";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await requireStaff("billing.read");
  const sp = await searchParams;
  const { t, fmt } = await getI18n();
  const page = Math.max(1, Number(sp.page) || 1);
  const PER = 50;
  const [byPlan, invoices, total] = await Promise.all([
    prisma.client.groupBy({ by: ["plan"], where: { status: { not: "SUSPENDED" } }, _count: { _all: true } }),
    prisma.subscriptionInvoice.findMany({ include: { client: { select: { id: true, name: true } } }, orderBy: [{ periodStart: "desc" }, { number: "desc" }], skip: (page - 1) * PER, take: PER }),
    prisma.subscriptionInvoice.count(),
  ]);
  const canWrite = ctx.can("billing.write");

  return (
    <>
      <div className="page-head" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">{t("admin.billing.eyebrow")}</div>
          <h1>{t("admin.billing.title")}</h1>
        </div>
        {canWrite ? <GenerateButton /> : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14, marginBottom: 18 }}>
        {PLAN_ORDER.map((p) => {
          const price = PLANS[p].price;
          return (
            <div key={p} className="card" style={{ border: `1px solid ${p === "PRO" ? "#7a1f3d" : "#e4e7ec"}`, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 16 }}>{t(`admin.plan.${p}`)}</span>
                <span className="n" style={{ fontSize: 12.5, color: "#5b6474" }}>{t("admin.billing.clients", { n: byPlan.find((b) => b.plan === p)?._count._all ?? 0 })}</span>
              </div>
              <div className="n">
                <span style={{ fontSize: 26, fontWeight: 600 }}>{price === null ? t("admin.plans.custom") : fmt.money(price, { decimals: 0 })}</span>
                <span style={{ color: "#5b6474", fontSize: 13 }}> {price === null ? t("admin.plans.annual") : t("admin.plans.perMonth")}</span>
              </div>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "#3a4250" }}>
                  <Icon name="Check" color="#7a1f3d" style={{ marginTop: 2 }} />
                  {t(`admin.plans.f.${p}.${i}`)}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="banner banner-info" style={{ marginBottom: 14 }}>
        <Icon name="Info" size={17} style={{ marginTop: 1 }} />
        <div>{t("admin.billing.providerNote")}</div>
      </div>

      <div className="card card-clip">
        <div style={{ padding: "14px 16px", fontWeight: 600, fontSize: 15, borderBottom: "1px solid #e4e7ec" }}>{t("admin.billing.invoices")}</div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 900 }}>
            <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 12 }}>
              <div>{t("admin.billing.col.number")}</div>
              <div>{t("admin.billing.col.client")}</div>
              <div>{t("admin.billing.col.plan")}</div>
              <div>{t("admin.billing.col.period")}</div>
              <div style={{ textAlign: "right" }}>{t("admin.billing.col.amount")}</div>
              <div>{t("admin.billing.col.status")}</div>
              <div />
            </div>
            {invoices.length === 0 ? <div className="empty">{t("admin.billing.empty")}</div> : null}
            {invoices.map((i) => (
              <div key={i.id} style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "11px 16px", alignItems: "center", fontSize: 13.5, borderBottom: "1px solid #eef0f3" }}>
                <div className="n" style={{ color: "#5b6474" }}>{i.number}</div>
                <Link href={`/admin/clients?id=${i.client.id}`} className="truncate" style={{ fontWeight: 500, color: "#14171f" }}>
                  {i.client.name}
                </Link>
                <div>{t(`admin.plan.${i.plan}`)}</div>
                <div style={{ color: "#5b6474" }}>{fmt.monthLong(i.periodStart)}</div>
                <div className="n" style={{ textAlign: "right", fontWeight: 500 }}>{fmt.money(i.amountCents)}</div>
                <div>
                  <Pill tone={INVOICE_STATUS_TONE[i.status]}>
                    {i.status === "PAID" && i.paidAt ? t("admin.billing.paidOn", { date: fmt.date(i.paidAt) }) : t(`admin.invoiceStatus.${i.status}`)}
                  </Pill>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>{canWrite ? <InvoiceActions id={i.id} status={i.status} /> : null}</div>
              </div>
            ))}
          </div>
        </div>
        {total > PER ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", fontSize: 13, color: "#5b6474" }}>
            <span>{t("admin.audit.pageOf", { page, pages: Math.ceil(total / PER) })}</span>
            <span style={{ display: "flex", gap: 8 }}>
              {page > 1 ? <Link className="btn btn-sm" href={`/admin/billing?page=${page - 1}`}>{t("admin.audit.prev")}</Link> : null}
              {page * PER < total ? <Link className="btn btn-sm" href={`/admin/billing?page=${page + 1}`}>{t("admin.audit.next")}</Link> : null}
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
}
