import type { Metadata } from "next";
import Link from "next/link";
import { requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Icon, type IconName } from "@/components/icon";
import { Banner, Kpi, Pill, TONE, type Tone } from "@/components/ui";
import { accountBalances, suggestionsFor } from "@/lib/domain/bank";
import { cashFlow } from "@/lib/domain/reports";
import { dueDateFor, exciseReturn, icpListing, monthOf, previousPeriod, vatReturn } from "@/lib/domain/returns";
import { canView, seesFinancials } from "@/lib/permissions";

export const metadata: Metadata = { title: "Dashboard" };

const CAT_LABEL: Record<string, { en: string; nl: string }> = {
  SPIRITS: { en: "Spirits", nl: "Gedistilleerd" },
  WINE: { en: "Still wine", nl: "Stille wijn" },
  BEER: { en: "Beer", nl: "Bier" },
  FORTIFIED: { en: "Fortified wine", nl: "Versterkte wijn" },
  WATER: { en: "Water", nl: "Water" },
  SOFT: { en: "Soft drinks", nl: "Frisdrank" },
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const ctx = await requireApp();
  const { t, fmt, locale } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const A = ctx.administration.id;
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const lastMonth = monthOf(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)));
  const vatPeriod = previousPeriod(today, ctx.administration.vatPeriod === "MONTHLY");
  const financials = seesFinancials(ctx.role);

  const d = await tenant(ctx, async (tx) => {
    const [accounts, openSales, openPurch, unreconciled, toApprove, receipts, blocked, excise, vat, icp, flow, lastMonthLines] = await Promise.all([
      accountBalances(tx, A),
      tx.salesInvoice.findMany({ where: { administrationId: A, status: "OPEN" }, include: {} }),
      tx.purchaseInvoice.findMany({ where: { administrationId: A, status: "BOOKED" }, orderBy: { dueDate: "asc" } }),
      tx.bankTransaction.findMany({ where: { administrationId: A, status: "UNRECONCILED" } }),
      tx.purchaseInvoice.count({ where: { administrationId: A, status: "TO_APPROVE" } }),
      tx.receipt.findMany({ where: { administrationId: A, status: { not: "BOOKED" } }, select: { categoryKey: true } }),
      tx.shipment.findMany({ where: { administrationId: A, blocked: true }, select: { ref: true, blockReason: true } }),
      exciseReturn(tx, A, lastMonth),
      vatReturn(tx, A, vatPeriod),
      icpListing(tx, A, vatPeriod),
      cashFlow(tx, A, 6, today),
      tx.salesInvoiceLine.findMany({
        where: { administrationId: A, invoice: { status: { in: ["OPEN", "PAID"] }, issueDate: { gte: lastMonth.start, lte: lastMonth.end } } },
        select: { netCents: true, qtyUnits: true, productId: true },
      }),
    ]);
    const suggestions = await suggestionsFor(tx, A, unreconciled);
    const customers = await tx.relation.findMany({ where: { id: { in: openSales.map((s) => s.customerId) } }, select: { id: true, name: true } });
    const products = await tx.product.findMany({ where: { administrationId: A }, select: { id: true, category: true, costCents: true } });
    return { accounts, openSales, openPurch, unreconciled, suggestions, toApprove, receipts, blocked, excise, vat, icp, flow, lastMonthLines, customers, products };
  });

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const eurAccounts = d.accounts.filter((a) => a.currency === ctx.administration.baseCurrency);
  const bankTotal = eurAccounts.reduce((a, b) => a + b.balanceCents, 0);
  const outstanding = (i: { totalCents: number; paidCents: number }) => i.totalCents - i.paidCents;
  const overdueInv = d.openSales.filter((i) => i.dueDate < today);
  const receivable = d.openSales.reduce((a, i) => a + outstanding(i), 0);
  const overdueSum = overdueInv.reduce((a, i) => a + outstanding(i), 0);
  const payable = d.openPurch.reduce((a, i) => a + outstanding(i), 0);
  const weekEnd = new Date(today.getTime() + 7 * 86400_000);
  const dueThisWeek = d.openPurch.filter((i) => i.dueDate && i.dueDate <= weekEnd).length;
  const exciseFiled = d.excise.filed?.status === "FILED";
  const monthName = (dt: Date) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, { month: "long", timeZone: "UTC" }).format(dt);
  const periodLabel = (p: { key: string }) => p.key.replace(/^(\d{4})-Q(\d)$/, locale === "nl" ? "K$2 $1" : "Q$2 $1");

  // ── Cash chart ───────────────────────────────────────────────────────────
  const maxBar = Math.max(1, ...d.flow.flatMap((m) => [m.inCents, m.outCents]));
  const lastFlow = d.flow[d.flow.length - 2] ?? d.flow[0]!;
  const net = lastFlow.inCents - lastFlow.outCents;
  const in30 = new Date(today.getTime() + 30 * 86400_000);
  const expected =
    d.openSales.filter((i) => i.dueDate <= in30).reduce((a, i) => a + outstanding(i), 0) - d.openPurch.filter((i) => !i.dueDate || i.dueDate <= in30).reduce((a, i) => a + outstanding(i), 0);

  // ── To do ────────────────────────────────────────────────────────────────
  const withSuggestion = [...d.suggestions.values()].filter(Boolean).length;
  const todos: { icon: IconName; tone: Tone; title: string; meta: string; href: string }[] = [];
  if (d.unreconciled.length && canView(ctx.role, "bank"))
    todos.push({ icon: "Bank", tone: "blue", title: t("dashboard.todoBank", { n: d.unreconciled.length }), meta: t("dashboard.todoBankMeta", { m: withSuggestion }), href: "/bank" });
  if (d.toApprove && canView(ctx.role, "purchases"))
    todos.push({ icon: "Receipt", tone: "blue", title: t("dashboard.todoPurch", { n: d.toApprove }), meta: t("dashboard.todoPurchMeta"), href: "/purchases" });
  if (d.receipts.length && canView(ctx.role, "purchases"))
    todos.push({ icon: "Wallet", tone: "blue", title: t("dashboard.todoReceipts", { n: d.receipts.length }), meta: t("dashboard.todoReceiptsMeta", { m: d.receipts.filter((r) => !r.categoryKey).length }), href: "/costs" });
  if (overdueInv.length && canView(ctx.role, "sales"))
    todos.push({ icon: "ClockCountdown", tone: "red", title: t("dashboard.todoOverdue", { n: overdueInv.length }), meta: t("dashboard.todoOverdueMeta", { amount: fmt.money(overdueSum) }), href: "/sales?tab=overdue" });
  for (const s of d.blocked) todos.push({ icon: "Warning", tone: "amber", title: t("dashboard.todoShipment", { ref: s.ref }), meta: s.blockReason ?? "", href: "/shipments" });
  if (!exciseFiled && d.excise.totalCents && canView(ctx.role, "fileExcise"))
    todos.push({ icon: "Scales", tone: "wine", title: t("dashboard.todoExcise", { month: monthName(lastMonth.start) }), meta: t("dashboard.todoExciseMeta", { amount: fmt.money(d.excise.totalCents, { decimals: 0 }), date: fmt.date(d.excise.due) }), href: "/excise" });
  if (d.vat.filed?.status !== "FILED" && canView(ctx.role, "fileVat"))
    todos.push({ icon: "Percent", tone: "wine", title: t("dashboard.todoVat", { period: periodLabel(vatPeriod) }), meta: t("dashboard.todoVatMeta", { amount: fmt.money(d.vat.payableCents), date: fmt.date(d.vat.due) }), href: "/vat" });

  // ── Receivables & revenue by category ────────────────────────────────────
  const custName = new Map(d.customers.map((c) => [c.id, c.name]));
  const debtors = new Map<string, number>();
  for (const i of d.openSales) debtors.set(i.customerId, (debtors.get(i.customerId) ?? 0) + outstanding(i));
  const top = [...debtors].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const prodCat = new Map(d.products.map((p) => [p.id, p]));
  const cat = new Map<string, { rev: number; cost: number }>();
  for (const l of d.lastMonthLines) {
    const p = l.productId ? prodCat.get(l.productId) : undefined;
    if (!p) continue;
    const key = p.category === "SOFT" ? "WATER" : p.category;
    const c = cat.get(key) ?? { rev: 0, cost: 0 };
    c.rev += l.netCents;
    c.cost += p.costCents * l.qtyUnits;
    cat.set(key, c);
  }
  const cats = [...cat].sort((a, b) => b[1].rev - a[1].rev);
  const maxRev = Math.max(1, ...cats.map(([, v]) => v.rev));

  // ── Deadlines ─────────────────────────────────────────────────────────────
  const nextSupplier = d.openPurch.find((p) => p.dueDate && p.dueDate >= today);
  const deadlines = [
    ...(nextSupplier
      ? [{ date: nextSupplier.dueDate!, title: t("dashboard.dlSupplier", { supplier: nextSupplier.supplierName }), meta: t("dashboard.dlSupplierMeta", { amount: fmt.money(outstanding(nextSupplier)) }), status: t("dashboard.planned"), tone: "gray" as Tone, href: "/purchases?tab=booked" }]
      : []),
    { date: d.vat.due, title: t("dashboard.dlVat", { period: periodLabel(vatPeriod) }), meta: t("dashboard.dlToPay", { amount: fmt.money(d.vat.payableCents) }), status: d.vat.filed ? t("dashboard.filed") : t("dashboard.ready"), tone: (d.vat.filed ? "green" : "blue") as Tone, href: "/vat" },
    { date: d.excise.due, title: t("dashboard.dlExcise", { month: monthName(lastMonth.start) }), meta: t("dashboard.dlToPay", { amount: fmt.money(d.excise.totalCents) }), status: exciseFiled ? t("dashboard.filed") : t("dashboard.ready"), tone: (exciseFiled ? "green" : "blue") as Tone, href: "/excise" },
    ...(d.icp.length
      ? [{ date: dueDateFor(vatPeriod), title: t("dashboard.dlIcp", { period: periodLabel(vatPeriod) }), meta: t("dashboard.dlIcpMeta", { n: d.icp.length, amount: fmt.money(d.icp.reduce((a, r) => a + r.amountCents, 0)) }), status: d.vat.filed ? t("dashboard.filed") : t("dashboard.ready"), tone: (d.vat.filed ? "green" : "blue") as Tone, href: "/vat" }]
      : []),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Amsterdam" }).format(now));
  const greetKey = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = ctx.displayName.split(" ")[0];
  const lastSync = d.accounts.map((a) => a.lastSyncedAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
  const locked = ctx.administration.lockedThrough;

  return (
    <>
      {sp.denied ? <Banner tone="warn" style={{ marginBottom: 16 }}>{t("dashboard.deniedNotice")}</Banner> : null}
      <div className="page-head" style={{ marginBottom: 22 }}>
        <div>
          <div className="eyebrow" style={{ textTransform: "capitalize" }}>{fmt.dateLong(now)}</div>
          <h1>{t(`dashboard.${greetKey}`, { name: firstName ?? "" })}</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#5b6474" }}>
          <Icon name="ArrowsClockwise" />
          {lastSync ? t("dashboard.synced", { time: fmt.time(lastSync) }) : t("dashboard.neverSynced")}
          {locked ? ` · ${t("dashboard.closed", { month: monthName(locked) })}` : ""}
        </div>
      </div>

      {financials ? (
        <div className="grid-kpi">
          <Kpi href="/bank" icon="Bank" label={t("dashboard.kBank")} value={fmt.money(bankTotal, { decimals: 0 })} note={d.accounts.map((a) => a.name).join(", ")} />
          <Kpi
            href="/sales"
            icon="ArrowDownLeft"
            label={t("dashboard.kRec")}
            value={fmt.money(receivable, { decimals: 0 })}
            note={overdueSum ? t("dashboard.overdueNote", { amount: fmt.money(overdueSum, { decimals: 0 }) }) : t("dashboard.nothingOverdue")}
            noteColor={overdueSum ? "#b42318" : "#157347"}
          />
          <Kpi href="/purchases?tab=booked" icon="ArrowUpRight" label={t("dashboard.kPay")} value={fmt.money(payable, { decimals: 0 })} note={dueThisWeek ? t("dashboard.dueThisWeek", { n: dueThisWeek }) : t("dashboard.noneThisWeek")} />
          <Kpi
            href="/excise"
            icon="SealCheck"
            label={t("dashboard.kEx", { date: fmt.date(d.excise.due) })}
            value={fmt.money(d.excise.totalCents, { decimals: 0 })}
            note={exciseFiled ? t("dashboard.filed") : t("dashboard.returnReady")}
            noteColor={exciseFiled ? "#157347" : "#9a5b00"}
          />
        </div>
      ) : null}

      <div className="grid-2">
        {financials ? (
          <div className="card card-pad">
            <div className="card-head" style={{ marginBottom: 14 }}>
              <div className="card-title">{t("dashboard.cash")}</div>
              <div style={{ display: "flex", gap: 14, fontSize: 12.5, color: "#5b6474" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: "#7a1f3d" }} />
                  {t("dashboard.in")}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: "#e8c3cf" }} />
                  {t("dashboard.out")}
                </span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${d.flow.length},1fr)`, gap: 16, height: 200, alignItems: "end", paddingBottom: 4, borderBottom: "1px solid #eef0f3" }}>
              {d.flow.map((m) => (
                <div key={m.month.toISOString()} style={{ display: "flex", gap: 4, alignItems: "flex-end", height: "100%", justifyContent: "center" }}>
                  <div title={`${t("dashboard.in")} ${fmt.money(m.inCents, { decimals: 0 })}`} style={{ width: "42%", maxWidth: 22, height: `${(m.inCents / maxBar) * 100}%`, background: "#7a1f3d", borderRadius: "4px 4px 0 0" }} />
                  <div title={`${t("dashboard.out")} ${fmt.money(m.outCents, { decimals: 0 })}`} style={{ width: "42%", maxWidth: 22, height: `${(m.outCents / maxBar) * 100}%`, background: "#e8c3cf", borderRadius: "4px 4px 0 0" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${d.flow.length},1fr)`, gap: 16, marginTop: 6 }}>
              {d.flow.map((m) => (
                <div key={m.month.toISOString()} style={{ textAlign: "center", fontSize: 12, color: "#5b6474", textTransform: "capitalize" }}>
                  {fmt.month(m.month)}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 28, marginTop: 14, fontSize: 13, flexWrap: "wrap" }}>
              <div>
                <span className="muted">{t("dashboard.net", { month: monthName(lastFlow.month) })} </span>
                <span className="n" style={{ fontWeight: 600, color: net >= 0 ? "#157347" : "#b42318" }}>{fmt.money(net, { decimals: 0, sign: true })}</span>
              </div>
              <div>
                <span className="muted">{t("dashboard.expected")} </span>
                <span className="n" style={{ fontWeight: 600 }}>{fmt.money(expected, { decimals: 0, sign: true })}</span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="card card-pad" id="todo">
          <div className="card-head" style={{ marginBottom: 8 }}>
            <div className="card-title">{t("dashboard.todo")}</div>
            <span className="n muted" style={{ fontSize: 13 }}>
              {todos.length} {t("dashboard.open")}
            </span>
          </div>
          {todos.length ? (
            todos.map((td) => (
              <Link key={td.title} href={td.href} className="todo-row" style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "10px 6px", borderBottom: "1px solid #f0f2f5", color: "inherit", textDecoration: "none" }}>
                <div className="tile" style={{ background: TONE[td.tone].bg, color: TONE[td.tone].fg }}>
                  <Icon name={td.icon} size={17} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{td.title}</div>
                  <div style={{ fontSize: 12.5, color: "#5b6474" }}>{td.meta}</div>
                </div>
                <Icon name="CaretRight" color="#8a93a3" />
              </Link>
            ))
          ) : (
            <div className="empty" style={{ padding: "32px 0" }}>
              <Icon name="Confetti" size={30} color="#157347" />
              <div className="empty-title">{t("common.allCaughtUp")}</div>
            </div>
          )}
        </div>
      </div>

      {financials ? (
        <div className="grid-3">
          <div className="card card-pad">
            <div className="card-title" style={{ marginBottom: 12 }}>{t("dashboard.receivables")}</div>
            <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "#eef0f3" }}>
              <div style={{ width: `${receivable ? ((receivable - overdueSum) / receivable) * 100 : 0}%`, background: "#7a1f3d" }} />
              <div style={{ width: `${receivable ? (overdueSum / receivable) * 100 : 0}%`, background: "#e5484d" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 10, fontSize: 13 }}>
              <div>
                <div className="muted">{t("dashboard.notDue")}</div>
                <div className="n" style={{ fontWeight: 600 }}>{fmt.money(receivable - overdueSum)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="muted">{t("dashboard.overdue")}</div>
                <div className="n" style={{ fontWeight: 600, color: "#b42318" }}>{fmt.money(overdueSum)}</div>
              </div>
            </div>
            <div className="divider" style={{ margin: "14px 0 10px" }} />
            <div style={{ fontSize: 12.5, color: "#5b6474", marginBottom: 6 }}>{t("dashboard.topDebtors")}</div>
            {top.map(([id, cents]) => (
              <div key={id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", fontSize: 13.5 }}>
                <span className="truncate">{custName.get(id)}</span>
                <span className="n" style={{ fontWeight: 500 }}>{fmt.money(cents)}</span>
              </div>
            ))}
          </div>

          <div className="card card-pad">
            <div className="card-title" style={{ marginBottom: 12 }}>{t("dashboard.revcat", { month: fmt.month(lastMonth.start) })}</div>
            {cats.length ? (
              cats.map(([key, v]) => (
                <div key={key} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5, marginBottom: 5 }}>
                    <span>{CAT_LABEL[key]?.[locale === "nl" ? "nl" : "en"] ?? key}</span>
                    <span className="n">
                      <span style={{ fontWeight: 600 }}>{fmt.money(v.rev, { decimals: 0 })}</span>
                      <span className="muted"> · {v.rev ? Math.round(((v.rev - v.cost) / v.rev) * 100) : 0}% {t("dashboard.margin")}</span>
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: "#f0f2f5", overflow: "hidden" }}>
                    <div style={{ width: `${(v.rev / maxRev) * 100}%`, height: "100%", background: "#7a1f3d", borderRadius: 999 }} />
                  </div>
                </div>
              ))
            ) : (
              <div className="muted">{t("dashboard.noRevenue")}</div>
            )}
          </div>

          <div className="card card-pad">
            <div className="card-title" style={{ marginBottom: 6 }}>{t("dashboard.deadlines")}</div>
            {deadlines.map((dl) => (
              <Link key={dl.title} href={dl.href} className="todo-row" style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "9px 4px", borderBottom: "1px solid #f0f2f5", color: "inherit", textDecoration: "none" }}>
                <div style={{ width: 44, borderRadius: 8, border: "1px solid #e4e7ec", textAlign: "center", overflow: "hidden" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", background: "#f9eef2", color: "#7a1f3d", padding: "1px 0" }}>{fmt.month(dl.date)}</div>
                  <div className="n" style={{ fontSize: 16, fontWeight: 600, padding: "2px 0" }}>{dl.date.getUTCDate()}</div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 500 }}>{dl.title}</div>
                  <div className="truncate" style={{ fontSize: 12.5, color: "#5b6474" }}>{dl.meta}</div>
                </div>
                <Pill tone={dl.tone}>{dl.status}</Pill>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <style>{`.todo-row:hover{background:#f9fafb}`}</style>
    </>
  );
}
