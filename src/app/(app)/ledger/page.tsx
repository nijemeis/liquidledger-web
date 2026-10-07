import type { Metadata } from "next";
import Link from "next/link";
import type { JournalSource } from "@prisma/client";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Icon } from "@/components/icon";
import { Empty, PageHead, Pill } from "@/components/ui";
import { balances } from "@/lib/domain/ledger";
import { fiscalYearOf } from "@/lib/domain/reports";
import { ParamSelect, UrlDrawer } from "../reports/_components/nav";
import { AddAccountModal, NewEntryDrawer, PeriodCloseModal, ReverseButton, type AccountOption } from "./ledger-client";

export const metadata: Metadata = { title: "General ledger" };

const SOURCES: JournalSource[] = ["PURCHASE", "SALES", "BANK", "RECEIPT", "STOCK", "EXCISE", "MANUAL", "PAYROLL_IMPORT", "OPENING"];
const PAGE = 8;
const APAGE = 25;
const GROUPS = [
  { key: "assets", types: ["ASSET"], sign: 1, ytd: false },
  { key: "liabilities", types: ["LIABILITY", "EQUITY"], sign: -1, ytd: false },
  { key: "revenue", types: ["REVENUE"], sign: -1, ytd: true },
  { key: "costs", types: ["COST"], sign: 1, ytd: true },
] as const;

type SP = { source?: string; jpage?: string; account?: string; apage?: string; new?: string; all?: string; addAccount?: string; close?: string };

export default async function LedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp("reports");
  const { t, fmt } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const A = ctx.administration.id;
  const lang = ctx.administration.ledgerLanguage === "nl" ? "nl" : "en";
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const fy = fiscalYearOf(today, ctx.administration.fiscalYearStart);
  const source = SOURCES.includes(sp.source as JournalSource) ? (sp.source as JournalSource) : null;
  const jpage = Math.max(1, Number(sp.jpage) || 1);
  const apage = Math.max(1, Number(sp.apage) || 1);
  const canEdit = canEditIn(ctx, "reports");
  const canClose = canEditIn(ctx, "users");
  const showAll = sp.all === "1";

  const d = await tenant(ctx, async (tx) => {
    const where = { administrationId: A, ...(source ? { source } : {}) };
    const [accounts, bsBal, ytdBal, entryCount, entries] = await Promise.all([
      tx.ledgerAccount.findMany({ where: { administrationId: A }, orderBy: { code: "asc" } }),
      balances(tx, A, { to: today }),
      balances(tx, A, { from: fy.start, to: today }),
      tx.journalEntry.count({ where }),
      tx.journalEntry.findMany({ where, orderBy: [{ date: "desc" }, { number: "desc" }], skip: (jpage - 1) * PAGE, take: PAGE, include: { lines: { orderBy: [{ debitCents: "desc" }] } } }),
    ]);
    const reversals = await tx.journalEntry.findMany({ where: { administrationId: A, reversalOfId: { in: entries.map((e) => e.id) } }, select: { reversalOfId: true, number: true } });
    let drawer = null;
    if (sp.account) {
      const acc = accounts.find((a) => a.code === sp.account);
      if (acc) {
        const pnl = acc.type === "REVENUE" || acc.type === "COST";
        const before = pnl ? 0 : ((await balances(tx, A, { to: new Date(fy.start.getTime() - 86400_000) })).get(acc.code) ?? 0);
        const lines = await tx.journalLine.findMany({
          where: { administrationId: A, accountCode: acc.code, entry: { date: { gte: fy.start, lte: fy.end } } },
          include: { entry: { select: { date: true, number: true, title: true, source: true } } },
        });
        lines.sort((a, b) => a.entry.date.getTime() - b.entry.date.getTime() || a.entry.number - b.entry.number);
        drawer = { acc, before, lines };
      }
    }
    return { accounts, bsBal, ytdBal, entryCount, entries, reversals, drawer };
  });

  const nameOf = (a: { nameNl: string; nameEn: string }) => (lang === "nl" ? a.nameNl : a.nameEn);
  const otherOf = (a: { nameNl: string; nameEn: string }) => (lang === "nl" ? a.nameEn : a.nameNl);
  const accByCode = new Map(d.accounts.map((a) => [a.code, a]));
  const eur0 = (c: number) => fmt.money(c, { decimals: 0 });
  const qs = (changes: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = { source: sp.source, jpage: sp.jpage, all: sp.all };
    for (const [k, v] of Object.entries({ ...base, ...changes })) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `/ledger?${s}` : "/ledger";
  };

  const groups = GROUPS.map((g) => {
    const rows = d.accounts
      .filter((a) => (g.types as readonly string[]).includes(a.type))
      .map((a) => ({ a, bal: g.sign * ((g.ytd ? d.ytdBal : d.bsBal).get(a.code) ?? 0) }))
      .filter((r) => showAll || r.bal !== 0);
    return { ...g, rows, total: rows.reduce((s, r) => s + r.bal, 0) };
  });
  const hiddenCount = d.accounts.length - groups.reduce((s, g) => s + g.rows.length, 0);
  const pages = Math.max(1, Math.ceil(d.entryCount / PAGE));
  const reversedBy = new Map(d.reversals.map((r) => [r.reversalOfId!, r.number]));
  const accountOptions: AccountOption[] = d.accounts.filter((a) => a.active).map((a) => ({ code: a.code, name: nameOf(a), other: otherOf(a), type: a.type }));
  const locked = ctx.administration.lockedThrough;
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const closeOptions = Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 0))).map((x) => ({ value: iso(x), label: fmt.dateMed(x) }));

  return (
    <>
      <PageHead
        eyebrow={t("common.group.accounting")}
        title={t("common.nav.ledger")}
        actions={
          <>
            {canClose || locked ? (
              canClose ? (
                <Link href={qs({ close: "1" })} scroll={false} className="btn" title={t("ledger.close.title")}>
                  <Icon name={locked ? "LockSimple" : "LockKeyOpen"} size={16} />
                  {locked ? t("ledger.closedThrough", { date: fmt.dateMed(locked) }) : t("ledger.closePeriod")}
                </Link>
              ) : (
                <span className="pill pill-gray" style={{ padding: "4px 10px" }}>
                  <Icon name="LockSimple" size={13} />
                  {t("ledger.closedThrough", { date: fmt.dateMed(locked!) })}
                </span>
              )
            ) : null}
            {canEdit ? (
              <Link href={qs({ addAccount: "1" })} scroll={false} className="btn">
                <Icon name="Plus" size={16} />
                {t("ledger.addAccount")}
              </Link>
            ) : null}
            {canEdit ? (
              <Link href={qs({ new: "1" })} scroll={false} className="btn btn-primary">
                <Icon name="Plus" size={16} />
                {t("ledger.journalEntry")}
              </Link>
            ) : null}
          </>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))", gap: 16, alignItems: "start" }}>
        <div className="card card-clip">
          <div style={{ padding: "14px 16px", fontWeight: 600, fontSize: 15, borderBottom: "1px solid #e4e7ec", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <span>{t("ledger.chartTitle", { date: fmt.date(today) })}</span>
            <Link href={qs({ all: showAll ? null : "1" })} scroll={false} style={{ fontSize: 12.5, fontWeight: 500 }}>
              {showAll ? t("ledger.hideEmpty") : t("ledger.showAll", { n: hiddenCount })}
            </Link>
          </div>
          {groups.map((g) => (
            <div key={g.key}>
              <div style={{ padding: "8px 16px", fontSize: 12, fontWeight: 600, color: "#5b6474", background: "#f9fafb", borderBottom: "1px solid #eef0f3", display: "flex", justifyContent: "space-between" }}>
                <span>{t(`ledger.group.${g.key}`)}</span>
                <span className="n">{eur0(g.total)}</span>
              </div>
              {g.rows.map(({ a, bal }) => (
                <Link
                  key={a.code}
                  href={qs({ account: a.code })}
                  scroll={false}
                  className="n acct-row"
                  style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr) 120px", gap: 12, padding: "9px 16px", fontSize: 13.5, borderBottom: "1px solid #f0f2f5", color: "inherit", textDecoration: "none" }}
                >
                  <span style={{ color: "#5b6474" }}>{a.code}</span>
                  <span style={{ minWidth: 0 }} className="truncate">
                    {nameOf(a)} <span style={{ color: "#8a93a3", fontSize: 12.5 }}>{otherOf(a)}</span>
                    {!a.active ? <span style={{ color: "#8a93a3", fontSize: 12 }}> · {t("ledger.inactive")}</span> : null}
                  </span>
                  <span style={{ textAlign: "right", fontWeight: 500 }}>{eur0(bal)}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>

        <div className="card card-clip">
          <div style={{ padding: "8px 16px", minHeight: 50, fontWeight: 600, fontSize: 15, borderBottom: "1px solid #e4e7ec", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>{t("ledger.latest")}</span>
            <ParamSelect
              param="source"
              value={source ?? ""}
              label={t("ledger.filterSource")}
              reset={["jpage"]}
              width={190}
              options={[{ value: "", label: t("ledger.allSources") }, ...SOURCES.map((s) => ({ value: s, label: t(`ledger.source.${s}`) }))]}
            />
          </div>
          {d.entries.length ? (
            d.entries.map((e) => (
              <div key={e.id} style={{ padding: "12px 16px", borderBottom: "1px solid #eef0f3" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 500, minWidth: 0 }}>
                    {e.title} <span className="n" style={{ color: "#8a93a3", fontSize: 12.5, fontWeight: 400 }}>#{e.number}</span>
                  </span>
                  <span style={{ fontSize: 12.5, color: "#5b6474", whiteSpace: "nowrap" }}>
                    {fmt.date(e.date)} · {t(`ledger.source.${e.source}`)}
                  </span>
                </div>
                {e.lines.map((l) => {
                  const a = accByCode.get(l.accountCode);
                  return (
                    <div key={l.id} className="n" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 100px 100px", gap: 10, fontSize: 13, color: "#3a4250", padding: "2px 0" }}>
                      <span className="truncate">
                        {l.accountCode} {a ? nameOf(a) : ""}
                        {l.vatCode ? <span style={{ color: "#8a93a3", fontSize: 12 }}> · {l.vatCode}</span> : null}
                      </span>
                      <span style={{ textAlign: "right" }}>{l.debitCents ? fmt.money(l.debitCents) : ""}</span>
                      <span style={{ textAlign: "right" }}>{l.creditCents ? fmt.money(l.creditCents) : ""}</span>
                    </div>
                  );
                })}
                {e.source === "MANUAL" || e.reversalOfId || reversedBy.has(e.id) ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {e.reversalOfId ? <Pill tone="gray">{t("ledger.isReversal")}</Pill> : null}
                    {reversedBy.has(e.id) ? <Pill tone="amber">{t("ledger.reversedBy", { n: reversedBy.get(e.id)! })}</Pill> : null}
                    {canEdit && e.source === "MANUAL" && !e.reversalOfId && !reversedBy.has(e.id) ? <ReverseButton id={e.id} number={e.number} /> : null}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <Empty icon="Books" title={t("ledger.noEntries")} color="#8a93a3" />
          )}
          {pages > 1 ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 16px", fontSize: 13 }}>
              {jpage > 1 ? (
                <Link className="btn btn-sm" href={qs({ jpage: jpage - 1 })} scroll={false}>
                  <Icon name="ArrowLeft" size={14} />
                  {t("ledger.newer")}
                </Link>
              ) : (
                <span />
              )}
              <span className="muted">{t("ledger.pageOf", { p: jpage, n: pages })}</span>
              {jpage < pages ? (
                <Link className="btn btn-sm" href={qs({ jpage: jpage + 1 })} scroll={false}>
                  {t("ledger.older")}
                  <Icon name="ArrowRight" size={14} />
                </Link>
              ) : (
                <span />
              )}
            </div>
          ) : null}
        </div>
      </div>
      <style>{`.acct-row:hover{background:#fafbfc}`}</style>

      {d.drawer ? <AccountDrawer {...d.drawer} apage={apage} fyStart={fy.start} name={nameOf(d.drawer.acc)} other={otherOf(d.drawer.acc)} qs={qs} t={t} fmt={fmt} /> : null}
      {sp.new === "1" && canEdit ? <NewEntryDrawer accounts={accountOptions} today={iso(today)} lockedThrough={locked ? iso(locked) : null} /> : null}
      {sp.addAccount === "1" && canEdit ? <AddAccountModal /> : null}
      {sp.close === "1" && canClose ? <PeriodCloseModal current={locked ? iso(locked) : null} options={closeOptions} /> : null}
    </>
  );
}

type I18n = Awaited<ReturnType<typeof getI18n>>;

function AccountDrawer({
  acc,
  before,
  lines,
  apage,
  fyStart,
  name,
  other,
  qs,
  t,
  fmt,
}: {
  acc: { code: string; type: string };
  before: number;
  lines: { id: string; debitCents: number; creditCents: number; description: string | null; vatCode: string | null; entry: { date: Date; number: number; title: string; source: string } }[];
  apage: number;
  fyStart: Date;
  name: string;
  other: string;
  qs: (c: Record<string, string | number | null>) => string;
  t: I18n["t"];
  fmt: I18n["fmt"];
}) {
  // Show balances with the sign that reads naturally for the account type.
  const sign = acc.type === "ASSET" || acc.type === "COST" ? 1 : -1;
  let run = before;
  const withRun = lines.map((l) => {
    run += l.debitCents - l.creditCents;
    return { ...l, run };
  });
  const pages = Math.max(1, Math.ceil(withRun.length / APAGE));
  const page = Math.min(apage, pages);
  const shown = withRun.slice((page - 1) * APAGE, page * APAGE);
  const dr = lines.reduce((a, l) => a + l.debitCents, 0);
  const cr = lines.reduce((a, l) => a + l.creditCents, 0);
  const COLS = "84px 64px minmax(0,1fr) 100px 100px 110px";
  return (
    <UrlDrawer
      close={["account", "apage"]}
      width={820}
      title={
        <span>
          <span className="n" style={{ color: "#5b6474", marginRight: 8 }}>
            {acc.code}
          </span>
          {name}
        </span>
      }
      subtitle={`${other} · ${t(`ledger.type.${acc.type}`)}`}
    >
      <div className="dl" style={{ marginBottom: 16 }}>
        <div>
          <dt>{t("ledger.drawer.opening", { date: fmt.dateMed(fyStart) })}</dt>
          <dd className="n">{fmt.money(sign * before)}</dd>
        </div>
        <div>
          <dt>{t("ledger.debit")}</dt>
          <dd className="n">{fmt.money(dr)}</dd>
        </div>
        <div>
          <dt>{t("ledger.credit")}</dt>
          <dd className="n">{fmt.money(cr)}</dd>
        </div>
        <div>
          <dt>{t("ledger.drawer.closing")}</dt>
          <dd className="n" style={{ fontWeight: 600 }}>
            {fmt.money(sign * (before + dr - cr))}
          </dd>
        </div>
      </div>
      {shown.length ? (
        <div className="card card-clip">
          <div className="tbl">
            <div style={{ minWidth: 640 }}>
              <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 10 }}>
                <div>{t("common.date")}</div>
                <div>{t("ledger.drawer.entry")}</div>
                <div>{t("ledger.drawer.description")}</div>
                <div style={{ textAlign: "right" }}>{t("ledger.debit")}</div>
                <div style={{ textAlign: "right" }}>{t("ledger.credit")}</div>
                <div style={{ textAlign: "right" }}>{t("ledger.drawer.balance")}</div>
              </div>
              {shown.map((l) => (
                <div key={l.id} className="tbl-row n" style={{ gridTemplateColumns: COLS, gap: 10, padding: "9px 16px", fontSize: 13 }}>
                  <div style={{ color: "#5b6474" }}>{fmt.date(l.entry.date)}</div>
                  <div style={{ color: "#5b6474" }}>#{l.entry.number}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="truncate">{l.entry.title}</div>
                    <div className="cell-sub truncate">
                      {t(`ledger.source.${l.entry.source}`)}
                      {l.vatCode ? ` · ${l.vatCode}` : ""}
                      {l.description ? ` · ${l.description}` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>{l.debitCents ? fmt.money(l.debitCents) : ""}</div>
                  <div style={{ textAlign: "right" }}>{l.creditCents ? fmt.money(l.creditCents) : ""}</div>
                  <div style={{ textAlign: "right", fontWeight: 500 }}>{fmt.money(sign * l.run)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <Empty icon="Books" title={t("ledger.drawer.empty")} color="#8a93a3" />
      )}
      {pages > 1 ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 12, fontSize: 13 }}>
          {page > 1 ? (
            <Link className="btn btn-sm" href={qs({ account: acc.code, apage: page - 1 })} scroll={false}>
              <Icon name="ArrowLeft" size={14} />
              {t("ledger.earlier")}
            </Link>
          ) : (
            <span />
          )}
          <span className="muted">{t("ledger.pageOf", { p: page, n: pages })}</span>
          {page < pages ? (
            <Link className="btn btn-sm" href={qs({ account: acc.code, apage: page + 1 })} scroll={false}>
              {t("ledger.later")}
              <Icon name="ArrowRight" size={14} />
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </UrlDrawer>
  );
}
