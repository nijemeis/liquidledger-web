import type { Metadata } from "next";
import Link from "next/link";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Banner, Empty, PageHead, TabLinks } from "@/components/ui";
import { Icon } from "@/components/icon";
import { accountBalances, suggestionsFor, type Suggestion } from "@/lib/domain/bank";
import { accountName } from "@/lib/domain/chart";
import { balances } from "@/lib/domain/ledger";
import { BankActions, BankTodo, type TodoRow } from "./bank-client";

export const metadata: Metadata = { title: "Bank" };

const DONE_LIMIT = 60;

export default async function BankPage({ searchParams }: { searchParams: Promise<{ account?: string; tab?: string }> }) {
  const ctx = await requireApp("bank");
  const { t, fmt } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const A = ctx.administration.id;
  const base = ctx.administration.baseCurrency;
  const lang = ctx.administration.ledgerLanguage;
  const canEdit = canEditIn(ctx, "bank");
  const tab = sp.tab === "done" ? "done" : "todo";

  const d = await tenant(ctx, async (tx) => {
    const accounts = await accountBalances(tx, A);
    const sel = accounts.find((a) => a.id === sp.account) ?? accounts[0] ?? null;
    if (!sel) return { accounts, sel: null } as const;
    const [todo, done, doneCount, ledger, ledgerBal] = await Promise.all([
      tx.bankTransaction.findMany({ where: { administrationId: A, bankAccountId: sel.id, status: "UNRECONCILED" }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
      tx.bankTransaction.findMany({ where: { administrationId: A, bankAccountId: sel.id, status: "RECONCILED" }, orderBy: [{ date: "desc" }, { reconciledAt: "desc" }], take: DONE_LIMIT }),
      tx.bankTransaction.count({ where: { administrationId: A, bankAccountId: sel.id, status: "RECONCILED" } }),
      tx.ledgerAccount.findMany({ where: { administrationId: A, active: true }, orderBy: { code: "asc" } }),
      balances(tx, A),
    ]);
    const suggestions = await suggestionsFor(tx, A, todo);
    const [openSales, openPurch, receipts, linked] = await Promise.all([
      tx.salesInvoice.findMany({ where: { administrationId: A, status: "OPEN" }, orderBy: { dueDate: "asc" } }),
      tx.purchaseInvoice.findMany({ where: { administrationId: A, status: "BOOKED" }, orderBy: { dueDate: "asc" } }),
      tx.receipt.findMany({ where: { administrationId: A, status: "BOOKED", paidBy: "BANK" }, orderBy: { date: "desc" }, take: 200 }),
      tx.bankTransaction.findMany({ where: { administrationId: A, matchType: "receipt" }, select: { matchId: true } }),
    ]);
    const customers = await tx.relation.findMany({ where: { administrationId: A, id: { in: openSales.map((s) => s.customerId) } }, select: { id: true, name: true } });
    return { accounts, sel, todo, done, doneCount, ledger, ledgerBal, suggestions, openSales, openPurch, receipts, linked, customers } as const;
  });

  const eyebrow = t("common.group.daily");
  const title = t("common.nav.bank");

  if (!d.sel) {
    return (
      <>
        <PageHead eyebrow={eyebrow} title={title} actions={canEdit ? <BankActions accounts={[]} selectedId={null} suggestCount={0} reconcilable={false} ledger10={tenLedger([], lang)} /> : null} />
        <div className="card">
          <Empty icon="Bank" color="#7a1f3d" title={t("bank.noAccounts")}>
            {t("bank.noAccountsHint")}
          </Empty>
        </div>
      </>
    );
  }

  const sel = d.sel;
  const reconcilable = sel.currency === base;
  const ledgerName = new Map(d.ledger.map((l) => [l.code, accountName(l, lang)]));
  const mask = (iban: string | null) => (iban ? `•••• ${iban.replace(/\s/g, "").slice(-4)}` : t("bank.noIban"));

  // Translated suggestion text (the domain keeps English fallbacks).
  const sugText = (s: Suggestion): { label: string; reason: string } => {
    let label = s.label;
    if (s.kind === "sales") label = s.code === "partial" ? t("bank.sug.partPayment", { number: s.number ?? "" }) : t("bank.sug.salesInvoice", { number: s.number ?? "" });
    else if (s.kind === "purchase") label = t("bank.sug.purchaseInvoice", { number: s.number ?? "" });
    else if (s.kind === "receipt") label = t("bank.sug.receipt", { name: s.who ?? "" });
    else if (s.kind === "ledger") {
      label = `${s.account} ${ledgerName.get(s.account) ?? ""}`.trim();
      if (s.vatRateBp) label += ` · ${t("bank.vatPct", { pct: fmt.pct(s.vatRateBp) })}`;
      if (s.code === "claim" && s.who) label += ` · ${s.who}`;
    }
    const reason =
      s.code === "exactRef" ? t("bank.reason.exactRef")
      : s.code === "exactAmount" ? t("bank.reason.exactAmount")
      : s.code === "partial" && s.kind === "sales" ? t("bank.reason.partial", { amount: fmt.money(s.partial ?? 0) })
      : s.code === "customs" ? t("bank.reason.customs")
      : s.code === "receipt" ? t("bank.reason.receipt")
      : s.code === "claim" ? t("bank.reason.claim")
      : s.code === "ruleN" ? t("bank.reason.ruleN", { n: s.n ?? 0 })
      : s.code === "rule" ? t("bank.reason.rule")
      : s.code === "history" ? t("bank.reason.history", { n: s.n ?? 0 })
      : s.reason;
    return { label, reason };
  };

  const rows: TodoRow[] = d.todo.map((x) => {
    const s = d.suggestions.get(x.id) ?? null;
    return {
      id: x.id,
      date: x.date,
      counterparty: x.counterparty,
      description: x.description,
      amountCents: x.amountCents,
      sug: s ? { icon: s.icon, ...sugText(s) } : null,
    };
  });
  const suggestCount = reconcilable ? rows.filter((r) => r.sug).length : 0;

  const custName = new Map(d.customers.map((c) => [c.id, c.name]));
  const linkedReceipts = new Set(d.linked.map((l) => l.matchId));
  const options = {
    sales: d.openSales.map((i) => ({ id: i.id, number: i.number ?? "", party: custName.get(i.customerId) ?? "", outstandingCents: i.totalCents - i.paidCents, dueDate: i.dueDate })),
    purchases: d.openPurch
      .filter((i) => i.totalCents > i.paidCents)
      .map((i) => ({ id: i.id, number: i.number, party: i.supplierName, outstandingCents: i.totalCents - i.paidCents, dueDate: i.dueDate ?? i.issueDate })),
    receipts: d.receipts.filter((r) => !linkedReceipts.has(r.id)).map((r) => ({ id: r.id, supplier: r.supplier, description: r.description, date: r.date, amountCents: r.amountCents })),
    ledger: d.ledger.filter((l) => l.code !== sel.accountCode).map((l) => ({ code: l.code, name: accountName(l, lang), alt: accountName(l, lang === "nl" ? "en" : "nl") })),
  };

  const sharedCode = (code: string) => d.accounts.filter((a) => a.accountCode === code).length > 1;
  const tabHref = (k: string) => `/bank?account=${sel.id}${k === "done" ? "&tab=done" : ""}`;
  const amountColor = (c: number) => (c > 0 ? "#157347" : "#14171f");
  const amountText = (c: number, currency: string) => fmt.money(c, { sign: true, currency });

  return (
    <>
      <PageHead
        eyebrow={eyebrow}
        title={title}
        actions={
          canEdit ? (
            <BankActions
              accounts={d.accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, iban: a.iban, accountCode: a.accountCode }))}
              selectedId={sel.id}
              suggestCount={suggestCount}
              reconcilable={reconcilable}
              ledger10={tenLedger(d.ledger, lang)}
            />
          ) : null
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 20 }}>
        {d.accounts.map((a) => {
          const foreign = a.currency !== base;
          const eq = foreign && !sharedCode(a.accountCode) ? d.ledgerBal.get(a.accountCode) : undefined;
          const state = a.toReconcile ? t("bank.toReconcileN", { n: a.toReconcile }) : t("bank.fullyReconciled");
          return (
            <Link key={a.id} href={`/bank?account=${a.id}`} scroll={false} className={`select-card${a.id === sel.id ? " on" : ""}`} aria-current={a.id === sel.id ? "true" : undefined}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: "#5b6474" }}>
                <span className="truncate">{a.name}</span>
                <span className="n" style={{ flex: "none" }}>{mask(a.iban)}</span>
              </div>
              <div className="n" style={{ fontSize: 21, fontWeight: 600 }}>{fmt.money(a.balanceCents, { currency: a.currency })}</div>
              <div style={{ fontSize: 12.5, color: "#5b6474" }}>
                {eq !== undefined ? `≈ ${fmt.money(eq, { currency: base })} · ${state.charAt(0).toLowerCase()}${state.slice(1)}` : state}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="card card-clip">
        <TabLinks
          active={tab}
          tabs={[
            { key: "todo", label: t("bank.tabTodo"), count: d.todo.length, href: tabHref("todo") },
            { key: "done", label: t("bank.tabDone"), count: d.doneCount, href: tabHref("done") },
          ]}
        />
        {tab === "todo" ? (
          <>
            {!reconcilable && d.todo.length ? (
              <div style={{ padding: "12px 16px 0" }}>
                <Banner tone="info">{t("bank.fxNotice", { currency: sel.currency, base })}</Banner>
              </div>
            ) : null}
            <BankTodo rows={rows} currency={sel.currency} canEdit={canEdit && reconcilable} options={options} />
          </>
        ) : d.done.length ? (
          <div className="tbl">
            <div style={{ minWidth: 760 }}>
              <div className="tbl-head" style={{ gridTemplateColumns: "70px minmax(0,1.3fr) 120px minmax(0,1.6fr)" }}>
                <div>{t("common.date")}</div>
                <div>{t("bank.counterparty")}</div>
                <div className="right">{t("common.amount")}</div>
                <div>{t("bank.bookedAs")}</div>
              </div>
              {d.done.map((x) => (
                <div key={x.id} className="tbl-row" style={{ gridTemplateColumns: "70px minmax(0,1.3fr) 120px minmax(0,1.6fr)" }}>
                  <div className="n muted">{fmt.date(x.date)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="cell-main truncate">{x.counterparty}</div>
                    <div className="cell-sub truncate">{x.description}</div>
                  </div>
                  <div className="n right" style={{ fontWeight: 600, color: amountColor(x.amountCents) }}>{amountText(x.amountCents, sel.currency)}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, color: "#157347" }}>
                    <Icon name="CheckCircle" size={16} />
                    <span className="truncate" style={{ color: "#14171f" }}>{doneLabel(x.matchType, x.matchId, x.matchLabel, ledgerName)}</span>
                  </div>
                </div>
              ))}
              {d.doneCount > d.done.length ? (
                <div style={{ padding: "10px 16px", fontSize: 12.5, color: "#5b6474" }}>{t("bank.showingLatest", { n: d.done.length, total: d.doneCount })}</div>
              ) : null}
            </div>
          </div>
        ) : (
          <Empty icon="Bank" color="#8a93a3" title={t("bank.nothingDone")} />
        )}
      </div>
    </>
  );
}

/** Ledger label in the administration's ledger language (stored labels may be English). */
function doneLabel(type: string | null, id: string | null, stored: string | null, names: Map<string, string>) {
  if (type === "ledger" && id && stored?.startsWith(id)) {
    const rest = stored.slice(id.length).split(" · ").slice(1);
    return [`${id} ${names.get(id) ?? ""}`.trim(), ...rest].join(" · ");
  }
  return stored ?? "—";
}

function tenLedger(ledger: { code: string; nameNl: string; nameEn: string }[], lang: string) {
  return ledger.filter((l) => /^10\d\d$/.test(l.code)).map((l) => ({ code: l.code, name: accountName(l, lang) }));
}
