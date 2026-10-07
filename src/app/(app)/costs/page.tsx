import type { Metadata } from "next";
import Link from "next/link";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { prisma } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { Icon, type IconName } from "@/components/icon";
import { Stat, TabLinks } from "@/components/ui";
import { CATEGORY_BY_KEY, categoryLabel } from "@/lib/domain/categories";
import { accountName } from "@/lib/domain/chart";
import { seesFinancials } from "@/lib/permissions";
import { CaptureStrip, CostsActions, ReceiptPanel, type ReceiptView } from "./client";

export const metadata: Metadata = { title: "Costs & receipts" };

const PAID_ICON: Record<string, IconName> = { CARD: "CreditCard", BANK: "Bank", OWN: "User" };

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ tab?: string; id?: string; new?: string }> }) {
  const ctx = await requireApp("purchases");
  const { t, fmt, locale } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const tab = sp.tab === "booked" ? "booked" : "todo";
  const A = ctx.administration.id;
  const canEdit = canEditIn(ctx, "purchases");
  const lang = ctx.administration.ledgerLanguage;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const d = await tenant(ctx, async (tx) => {
    const [todo, booked, bookedCount, recent, claims, accounts] = await Promise.all([
      tx.receipt.findMany({ where: { administrationId: A, status: { not: "BOOKED" } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
      tx.receipt.findMany({ where: { administrationId: A, status: "BOOKED" }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 60 }),
      tx.receipt.count({ where: { administrationId: A, status: "BOOKED" } }),
      tx.receipt.findMany({ where: { administrationId: A, date: { gte: lastMonthStart } }, select: { date: true, amountCents: true, payroll: true, supplier: true } }),
      tx.receipt.findMany({ where: { administrationId: A, paidBy: "OWN", claimPaidAt: null }, select: { amountCents: true, employeeName: true } }),
      tx.ledgerAccount.findMany({ where: { administrationId: A }, select: { code: true, nameNl: true, nameEn: true } }),
    ]);
    const list = tab === "todo" ? todo : booked;
    const selId = sp.id && list.some((r) => r.id === sp.id) ? sp.id : list[0]?.id;
    const sel = selId ? list.find((r) => r.id === selId) ?? null : null;
    const doc = sel?.documentId ? await tx.document.findFirst({ where: { id: sel.documentId, administrationId: A }, select: { id: true, mimeType: true, filename: true } }) : null;
    return { todo, booked, bookedCount, recent, claims, accounts, list, sel, doc };
  });
  const members = await prisma.membership.findMany({ where: { administrationId: A }, include: { user: { select: { name: true, status: true } } } });
  const employees = [...new Set(members.filter((m) => m.user.status !== "DISABLED").map((m) => m.user.name.split(" ")[0]!))].sort();

  const accNames = Object.fromEntries(d.accounts.map((a) => [a.code, accountName(a, lang)]));

  // ── Summary cards ──────────────────────────────────────────────────────────
  const monthCosts = d.recent.filter((r) => !r.payroll && r.date >= monthStart).reduce((a, r) => a + r.amountCents, 0);
  const noCat = d.todo.filter((r) => !r.categoryKey && !r.payroll).length;
  const claimTotal = d.claims.reduce((a, r) => a + r.amountCents, 0);
  const claimNames = [...new Set(d.claims.map((c) => c.employeeName ?? "?"))];
  const joinNames = (n: string[]) => (n.length > 1 ? `${n.slice(0, -1).join(", ")} & ${n.at(-1)}` : n[0] ?? "");
  const payroll = d.recent.filter((r) => r.payroll && r.date < monthStart).sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  const monthName = (dt: Date) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, { month: "long", timeZone: "UTC" }).format(dt);

  const catLabel = (key: string | null) => {
    const c = key ? CATEGORY_BY_KEY[key] : null;
    return c ? categoryLabel(c, locale) : "";
  };
  const paidLabel = (r: { paidBy: string; employeeName: string | null }) =>
    r.paidBy === "CARD" ? t("costs.paid.card") : r.paidBy === "BANK" ? t("costs.paid.bank") : `${t("costs.paid.own")} · ${r.employeeName ?? "?"}`;

  const sel = d.sel;
  const view: ReceiptView | null = sel
    ? {
        id: sel.id,
        date: sel.date.toISOString().slice(0, 10),
        supplier: sel.supplier,
        description: sel.description,
        amountCents: sel.amountCents,
        categoryKey: sel.categoryKey,
        vatOverride: (sel.vatOverride as ReceiptView["vatOverride"]) ?? null,
        paidBy: sel.paidBy,
        employeeName: sel.employeeName,
        status: sel.status,
        suggestionReason: sel.suggestionReason,
        payroll: Array.isArray(sel.payroll) ? (sel.payroll as { account: string; debit: number; credit: number }[]) : null,
        document: d.doc ? { id: d.doc.id, mime: d.doc.mimeType, filename: d.doc.filename } : null,
        claimPaid: Boolean(sel.claimPaidAt),
      }
    : null;

  const shortId = A.slice(-8);
  const tabHref = (k: string) => `/costs?tab=${k}`;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t("common.group.daily")}</div>
          <h1>{t("common.nav.costs")}</h1>
        </div>
        {canEdit ? <CostsActions employees={employees} defaultEmployee={ctx.displayName.split(" ")[0] ?? ""} /> : null}
      </div>

      <CaptureStrip canEdit={canEdit} address={`receipts+${shortId}@in.liquidledger.net`} employees={employees} defaultEmployee={ctx.displayName.split(" ")[0] ?? ""} autoOpen={sp.new === "1"} />

      {seesFinancials(ctx.role) ? (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Stat label={t("costs.kpi.month", { month: monthName(monthStart) })} value={fmt.money(monthCosts)} note={t("costs.kpi.monthNote")} />
        <Stat label={t("costs.kpi.toBook")} value={fmt.int(d.todo.length)} note={t("costs.kpi.toBookNote", { n: noCat })} />
        <Stat label={t("costs.kpi.reimburse")} value={fmt.money(claimTotal)} note={claimNames.length ? joinNames(claimNames) : t("costs.kpi.nobody")} />
        <Stat
          label={t("costs.kpi.payroll", { month: monthName(payroll?.date ?? lastMonthStart) })}
          value={payroll ? fmt.money(payroll.amountCents) : "—"}
          note={payroll ? t("costs.kpi.payrollNote", { n: Array.isArray(payroll.payroll) ? (payroll.payroll as unknown[]).length : 0 }) : t("costs.kpi.payrollNone")}
        />
      </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))", gap: 16, alignItems: "start" }}>
        <div className="card card-clip" style={{ minWidth: 0 }}>
          <TabLinks
            active={tab}
            tabs={[
              { key: "todo", label: t("costs.tabTodo"), count: d.todo.length, href: tabHref("todo") },
              { key: "booked", label: t("costs.tabBooked"), count: d.bookedCount, href: tabHref("booked") },
            ]}
          />
          <div style={{ maxHeight: "calc(100vh - 140px)", minHeight: 120, overflow: "auto" }}>
            {d.list.map((r) => {
              const on = r.id === sel?.id;
              const c = r.categoryKey ? CATEGORY_BY_KEY[r.categoryKey] : null;
              const suggested = r.status !== "BOOKED";
              return (
                <Link
                  key={r.id}
                  href={`/costs?tab=${tab}&id=${r.id}`}
                  scroll={false}
                  style={{ display: "grid", gridTemplateColumns: "52px minmax(0,1.2fr) minmax(0,1.2fr) 96px", minWidth: 480, gap: 12, alignItems: "center", padding: "11px 14px", borderBottom: "1px solid #eef0f3", borderLeft: `3px solid ${on ? "#7a1f3d" : "transparent"}`, background: on ? "#fcf5f7" : "#fff", color: "inherit", textDecoration: "none" }}
                >
                  <div style={{ fontSize: 12.5, color: "#5b6474" }}>{fmt.date(r.date)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="truncate" style={{ fontWeight: 500 }}>{r.supplier}</div>
                    <div className="truncate" style={{ fontSize: 12.5, color: "#5b6474" }}>{r.description}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    {r.payroll ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", padding: "3px 9px", borderRadius: 7, background: "#f3f5f8", fontSize: 12.5 }}>
                        <Icon name="UsersThree" size={15} color="#3a4250" />
                        <span className="truncate">{t("costs.payroll")}</span>
                        <span className="n" style={{ color: "#8a93a3" }}>4000</span>
                      </span>
                    ) : c ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", padding: "3px 9px", borderRadius: 7, background: suggested ? "#fcf5f7" : "#f3f5f8", border: suggested ? "1px dashed #e3b8c6" : "1px solid transparent", fontSize: 12.5 }}>
                        <Icon name={c.icon as IconName} size={15} color="#3a4250" />
                        <span className="truncate">{catLabel(c.key)}</span>
                        <span className="n" style={{ color: "#8a93a3" }}>{c.account}</span>
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 7, background: "#fff3dc", color: "#9a5b00", fontSize: 12.5, fontWeight: 500 }}>
                        <Icon name="Question" size={15} />
                        {t("costs.whatFor")}
                      </span>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="n" style={{ fontWeight: 600 }}>{fmt.money(r.amountCents)}</div>
                    <div style={{ fontSize: 12, color: "#5b6474", display: "flex", gap: 4, alignItems: "center", justifyContent: "flex-end", whiteSpace: "nowrap" }}>
                      <Icon name={PAID_ICON[r.paidBy]!} size={13} />
                      <span className="truncate">{paidLabel(r)}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
            {!d.list.length ? (
              <div style={{ padding: "36px 14px", textAlign: "center", color: "#5b6474", fontSize: 13 }}>
                <Icon name="CheckCircle" size={26} color="#157347" />
                <div>{tab === "todo" ? t("costs.emptyTodo") : t("costs.emptyBooked")}</div>
              </div>
            ) : null}
          </div>
        </div>

        {view ? <ReceiptPanel key={`${view.id}:${view.status}:${view.amountCents}:${view.supplier}:${view.date}`} r={view} accountNames={accNames} employees={employees} canEdit={canEdit} country={ctx.administration.country} /> : null}
      </div>
    </>
  );
}
