import type { Metadata } from "next";
import Link from "next/link";
import { requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { canView, seesFinancials } from "@/lib/permissions";
import { parseMoney } from "@/lib/format";
import { Icon, type IconName } from "@/components/icon";
import { CategoryTile, Empty, PageHead, type Tone } from "@/components/ui";
import { SearchBox } from "./search-box";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

const LIMIT = 8;

type Hit = { id: string; href: string; title: string; sub: string; right?: string; rightTone?: "in" | "out"; pill?: { label: string; tone: Tone }; category?: string };
type Section = { key: string; icon: IconName; title: string; hits: Hit[]; more: boolean; href: string };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireApp();
  const { t, fmt } = await getI18n(ctx.locale);
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const A = ctx.administration.id;
  const fin = seesFinancials(ctx.role);
  const can = (p: Parameters<typeof canView>[1]) => canView(ctx.role, p);
  // A query that reads as an amount also matches totals exactly ("1.234,56", "€ 450", "-89.50").
  const looksLikeMoney = /^[−-]?\s*[€$£]?\s*\d[\d.,\s]*$/.test(q);
  const cents = fin && looksLikeMoney ? parseMoney(q) : null;
  const amount = cents !== null ? Math.abs(cents) : null;
  const like = { contains: q, mode: "insensitive" as const };
  const compact = q.replace(/\s/g, "");

  const sections: Section[] = [];
  if (q.length >= 2 || amount !== null) {
    const r = await tenant(ctx, async (tx) => {
      const relations = await tx.relation.findMany({
        where: { administrationId: A, OR: [{ name: like }, { vatNumber: { contains: compact, mode: "insensitive" } }, { city: like }, { email: like }] },
        orderBy: { name: "asc" },
        take: 50,
      });
      const relIds = relations.map((x) => x.id);
      const [sales, purchases, products, bank, receipts] = await Promise.all([
        can("sales")
          ? tx.salesInvoice.findMany({
              where: { administrationId: A, OR: [{ number: like }, { reference: like }, ...(relIds.length ? [{ customerId: { in: relIds } }] : []), ...(amount !== null ? [{ totalCents: amount }, { netCents: amount }] : [])] },
              orderBy: { issueDate: "desc" },
              take: LIMIT + 1,
            })
          : [],
        can("purchases")
          ? tx.purchaseInvoice.findMany({
              where: { administrationId: A, OR: [{ number: like }, { supplierName: like }, { orderRef: like }, ...(amount !== null ? [{ totalCents: amount }, { totalSourceCents: amount }, { netCents: amount }] : [])] },
              orderBy: { issueDate: "desc" },
              take: LIMIT + 1,
            })
          : [],
        can("stock")
          ? tx.product.findMany({ where: { administrationId: A, OR: [{ name: like }, { sku: like }, { ean: { contains: compact } }, { producer: like }] }, orderBy: { name: "asc" }, take: LIMIT + 1 })
          : [],
        can("bank")
          ? tx.bankTransaction.findMany({
              where: { administrationId: A, OR: [{ counterparty: like }, { description: like }, ...(amount !== null ? [{ amountCents: amount }, { amountCents: -amount }] : [])] },
              include: { bankAccount: { select: { name: true, currency: true } } },
              orderBy: { date: "desc" },
              take: LIMIT + 1,
            })
          : [],
        can("purchases")
          ? tx.receipt.findMany({ where: { administrationId: A, OR: [{ supplier: like }, { description: like }, ...(amount !== null ? [{ amountCents: amount }] : [])] }, orderBy: { date: "desc" }, take: LIMIT + 1 })
          : [],
      ]);
      const customers = await tx.relation.findMany({ where: { id: { in: [...new Set(sales.map((s) => s.customerId))] } }, select: { id: true, name: true } });
      return { relations, sales, purchases, products, bank, receipts, customers };
    });

    const cust = new Map(r.customers.map((c) => [c.id, c.name]));
    const today = new Date();
    const push = (key: string, icon: IconName, href: string, hits: Hit[]) => {
      if (hits.length) sections.push({ key, icon, title: t(`settings.search.section.${key}`), hits: hits.slice(0, LIMIT), more: hits.length > LIMIT, href });
    };
    push(
      "sales",
      "FileText",
      "/sales",
      r.sales.map((s) => {
        const overdue = s.status === "OPEN" && s.dueDate < today;
        return {
          id: s.id,
          href: `/sales?id=${s.id}`,
          title: s.number ?? t("settings.search.draft"),
          sub: `${cust.get(s.customerId) ?? "—"} · ${fmt.dateMed(s.issueDate)}`,
          right: fin ? fmt.money(s.totalCents, { currency: s.currency }) : undefined,
          pill: { label: t(`settings.search.status.${overdue ? "OVERDUE" : s.status}`), tone: overdue ? "red" : s.status === "PAID" ? "green" : s.status === "OPEN" ? "blue" : "gray" },
        };
      }),
    );
    push(
      "purchases",
      "Receipt",
      "/purchases",
      r.purchases.map((p) => ({
        id: p.id,
        href: `/purchases?id=${p.id}`,
        title: `${p.supplierName} · ${p.number}`,
        sub: fmt.dateMed(p.issueDate) + (p.currency !== "EUR" && fin ? ` · ${fmt.money(p.totalSourceCents, { currency: p.currency })}` : ""),
        right: fin ? fmt.money(p.totalCents) : undefined,
        pill: { label: t(`settings.search.status.${p.status}`), tone: p.status === "PAID" ? "green" : p.status === "BOOKED" ? "blue" : "amber" },
      })),
    );
    push(
      "relations",
      "AddressBook",
      "/relations",
      r.relations.slice(0, LIMIT + 1).map((x) => ({
        id: x.id,
        href: `/relations?id=${x.id}`,
        title: x.name,
        sub: [x.typeLabel, x.city, x.country, x.vatNumber].filter(Boolean).join(" · "),
        pill: { label: t(`settings.search.kind.${x.kind}`), tone: "gray" as Tone },
      })),
    );
    push(
      "products",
      "Wine",
      "/products",
      r.products.map((p) => ({
        id: p.id,
        href: `/products?id=${p.id}`,
        title: p.name,
        sub: [p.sku, p.producer, p.ean].filter(Boolean).join(" · "),
        category: p.category,
        right: fin ? fmt.money(p.costCents) : undefined,
      })),
    );
    push(
      "bank",
      "Bank",
      "/bank",
      r.bank.map((b) => ({
        id: b.id,
        href: `/bank?account=${b.bankAccountId}&id=${b.id}${b.status === "RECONCILED" ? "&tab=reconciled" : ""}`,
        title: b.counterparty,
        sub: `${fmt.dateMed(b.date)} · ${b.bankAccount.name} · ${b.description}`,
        right: fmt.money(b.amountCents, { currency: b.bankAccount.currency, sign: true }),
        rightTone: b.amountCents > 0 ? "in" : "out",
        pill: b.status === "UNRECONCILED" ? { label: t("settings.search.status.UNRECONCILED"), tone: "amber" as Tone } : undefined,
      })),
    );
    push(
      "receipts",
      "Wallet",
      "/costs",
      r.receipts.map((x) => ({
        id: x.id,
        href: `/costs?id=${x.id}`,
        title: x.supplier,
        sub: `${fmt.dateMed(x.date)} · ${x.description}`,
        right: fin ? fmt.money(x.amountCents, { currency: x.currency }) : undefined,
        pill: { label: t(`settings.search.status.${x.status}`), tone: x.status === "BOOKED" ? "green" : "blue" },
      })),
    );
  }
  const total = sections.reduce((a, s) => a + s.hits.length, 0);

  return (
    <>
      <PageHead eyebrow={ctx.administration.legalName} title={t("settings.search.title")} />
      <SearchBox key={q} q={q} />
      {!q ? (
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>{t("settings.search.tipsTitle")}</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "#3a4250", fontSize: 13.5, lineHeight: 1.8 }}>
            <li>{t("settings.search.tip1")}</li>
            <li>{t("settings.search.tip2")}</li>
            <li>{t("settings.search.tip3")}</li>
          </ul>
        </div>
      ) : q.length < 2 && amount === null ? (
        <div className="muted" style={{ marginTop: 16, fontSize: 13.5 }}>{t("settings.search.tooShort")}</div>
      ) : !total ? (
        <div className="card" style={{ marginTop: 16 }}>
          <Empty icon="MagnifyingGlass" title={t("settings.search.none", { q })} color="#8a93a3">
            <div style={{ fontSize: 13, marginTop: 4 }}>{t("settings.search.noneText")}</div>
          </Empty>
        </div>
      ) : (
        <>
          <div className="muted" style={{ margin: "14px 0 12px", fontSize: 13 }}>
            {t("settings.search.count", { n: total, q })}
            {amount !== null ? ` · ${t("settings.search.amountMatch", { amount: fmt.money(amount) })}` : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {sections.map((s) => (
              <section key={s.key} className="card card-clip">
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #e4e7ec", background: "#f9fafb" }}>
                  <span className="tile" style={{ width: 28, height: 28, background: "#f9eef2", color: "#7a1f3d" }}>
                    <Icon name={s.icon} size={15} />
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</span>
                  <span className="tab-count">{s.more ? `${LIMIT}+` : s.hits.length}</span>
                  <span style={{ flex: 1 }} />
                  <Link href={s.href} style={{ fontSize: 13, fontWeight: 500 }}>
                    {t("settings.search.open")} <Icon name="ArrowRight" size={13} />
                  </Link>
                </div>
                <div className="tbl">
                  {s.hits.map((h) => (
                    <Link key={h.id} href={h.href} className="tbl-row" style={{ gridTemplateColumns: h.category ? "32px minmax(0,1fr) auto auto" : "minmax(0,1fr) auto auto", minWidth: 0 }}>
                      {h.category ? <CategoryTile category={h.category} /> : null}
                      <span style={{ minWidth: 0 }}>
                        <span className="cell-main truncate" style={{ display: "block" }}>{h.title}</span>
                        <span className="cell-sub truncate" style={{ display: "block" }}>{h.sub}</span>
                      </span>
                      <span>{h.pill ? <span className={`pill pill-${h.pill.tone}`}>{h.pill.label}</span> : null}</span>
                      <span className="n" style={{ minWidth: 96, textAlign: "right", fontWeight: 500, color: h.rightTone === "in" ? "#157347" : undefined }}>{h.right ?? ""}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
