import type { Metadata } from "next";
import Link from "next/link";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Icon } from "@/components/icon";
import { CATEGORY_STYLE, CategoryTile, PageHead } from "@/components/ui";
import { seesFinancials } from "@/lib/permissions";
import { excisePerUnit, exciseFormula, ratesOn } from "@/lib/domain/excise";
import { stockLevels, unitsIn } from "@/lib/domain/stock";
import { countryName, flag, COUNTRY_CODES } from "@/lib/countries";
import { ProductDrawer, type ProductView, type ProductEdit } from "./product-drawer";

export const metadata: Metadata = { title: "Products" };

type SP = { cat?: string; q?: string; id?: string; new?: string; edit?: string; archived?: string };

const GROUPS: { key: string; label: string; match: (c: string) => boolean }[] = [
  { key: "all", label: "all", match: () => true },
  { key: "wine", label: "chipWine", match: (c) => c === "WINE" },
  { key: "beer", label: "chipBeer", match: (c) => c === "BEER" },
  { key: "spirits", label: "chipSpirits", match: (c) => c === "SPIRITS" },
  { key: "fortified", label: "chipFortified", match: (c) => c === "FORTIFIED" },
  { key: "na", label: "chipNa", match: (c) => c === "WATER" || c === "SOFT" },
];

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp("stock");
  const { t, fmt, locale } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const A = ctx.administration.id;
  const money = seesFinancials(ctx.role);
  const cat = GROUPS.find((g) => g.key === sp.cat) ?? GROUPS[0]!;
  const q = (sp.q ?? "").trim().toLowerCase();
  const showArchived = sp.archived === "1";
  const today = new Date();

  const d = await tenant(ctx, async (tx) => {
    const [products, levels, rates, warehouses] = await Promise.all([
      tx.product.findMany({ where: { administrationId: A }, include: { prices: { orderBy: { validFrom: "desc" } } }, orderBy: { sku: "asc" } }),
      stockLevels(tx, A),
      ratesOn(tx, ctx.administration.country, today),
      tx.warehouse.findMany({ where: { administrationId: A, archivedAt: null }, orderBy: { name: "asc" } }),
    ]);
    let last90: { units: number; rev: number; top: string | null } | null = null;
    if (sp.id) {
      const since = new Date(today.getTime() - 90 * 86400_000);
      const lines = await tx.salesInvoiceLine.findMany({
        where: { administrationId: A, productId: sp.id, invoice: { status: { in: ["OPEN", "PAID"] }, issueDate: { gte: since } } },
        select: { qtyUnits: true, netCents: true, invoice: { select: { customerId: true } } },
      });
      const per = new Map<string, number>();
      for (const l of lines) per.set(l.invoice.customerId, (per.get(l.invoice.customerId) ?? 0) + l.netCents);
      const topId = [...per].sort((a, b) => b[1] - a[1])[0]?.[0];
      const top = topId ? await tx.relation.findUnique({ where: { id: topId }, select: { name: true } }) : null;
      last90 = { units: lines.reduce((a, l) => a + l.qtyUnits, 0), rev: lines.reduce((a, l) => a + l.netCents, 0), top: top?.name ?? null };
    }
    return { products, levels, rates, warehouses, last90 };
  });

  const latest = (p: (typeof d.products)[number], list: string) => p.prices.find((x) => x.list === list)?.unitPriceCents ?? null;
  const lists = (p: (typeof d.products)[number]) => {
    const seen: string[] = [];
    for (const x of [...p.prices].reverse()) if (!seen.includes(x.list)) seen.push(x.list);
    const order = ["Horeca", "Wholesale", "Export"];
    return seen.sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
  };
  const visible = d.products.filter((p) => showArchived || !p.archivedAt);
  const rows = visible.filter((p) => cat.match(p.category) && (!q || `${p.name} ${p.sku} ${p.producer ?? ""} ${p.ean ?? ""}`.toLowerCase().includes(q)));
  const href = (patch: Partial<SP>) => {
    const u = new URLSearchParams();
    const merged = { cat: cat.key === "all" ? undefined : cat.key, q: sp.q || undefined, archived: showArchived ? "1" : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    const s = u.toString();
    return `/products${s ? `?${s}` : ""}`;
  };
  const litres = (ml: number) => `${fmt.num(ml / 1000, ml % 100 === 0 ? (ml % 1000 === 0 ? 0 : 1) : 2)} L`;
  const abv = (bp: number) => fmt.pct(bp);
  const cols = money ? "44px minmax(240px,2fr) 76px 110px 104px 56px 82px 76px 84px 60px 90px" : "44px minmax(240px,2fr) 76px 110px 104px 56px 82px";

  // Selected product (view) and edit form data.
  const sel = sp.id ? d.products.find((p) => p.id === sp.id) : undefined;
  let view: ProductView | null = null;
  let edit: ProductEdit | null = null;
  if (sel) {
    const rate = d.rates.get(sel.category);
    const ex = excisePerUnit(sel, rate);
    const facts: [string, string][] = [
      [t("products.ean"), sel.ean ?? "—"],
      [t("products.volume"), litres(sel.volumeMl)],
      [t("products.alcohol"), sel.abvBp ? `${abv(sel.abvBp)} vol` : t("products.alcoholFree")],
    ];
    if (sel.category === "BEER" && sel.platoTenths) facts.push([t("products.gravity"), `${fmt.num(sel.platoTenths / 10, 1)} °P`]);
    else if (sel.vintage) facts.push([t("products.age"), sel.vintage]);
    facts.push(
      [t("products.caseSize"), t("products.units", { n: sel.unitsPerCase })],
      [t("products.pallet"), sel.casesPerPallet ? t("products.cases", { n: sel.casesPerPallet }) : "—"],
      [t("products.cn"), sel.cnCode ?? "—"],
      [t("products.emcs"), sel.emcsCode ?? "—"],
      [t("products.origin"), sel.originCountry ? `${flag(sel.originCountry)} ${countryName(sel.originCountry, locale)}` : "—"],
    );
    if (sel.abvBp) facts.push([t("products.pureAlcohol"), `${fmt.num((sel.volumeMl / 1000) * (sel.abvBp / 10_000), 3)} L`]);
    const stock = d.warehouses
      .map((w) => ({ w, n: unitsIn(d.levels, sel.id, w.id) }))
      .filter((x) => x.n !== 0)
      .map((x) => ({ l: x.w.name, v: t("products.units", { n: fmt.int(x.n) }) }));
    view = {
      id: sel.id,
      name: sel.name,
      sub: [sel.producer, [sel.region, sel.originCountry ? countryName(sel.originCountry, locale) : null].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
      category: sel.category,
      catLabel: t(`products.cat${sel.category}`),
      archived: Boolean(sel.archivedAt),
      sku: sel.sku,
      facts: facts.map(([l, v]) => ({ l, v })),
      lists: money
        ? lists(sel).map((l) => {
            const c = latest(sel, l)!;
            return { name: l, btl: fmt.money(c), cs: fmt.money(c * sel.unitsPerCase), m: c ? `${Math.round(((c - sel.costCents) / c) * 100)}%` : "—" };
          })
        : [],
      cost: money ? t("products.perUnit", { amount: fmt.money(sel.costCents) }) : null,
      exBtl: fmt.money(Math.round(ex)),
      exCase: fmt.money(Math.round(ex * sel.unitsPerCase)),
      deposit: sel.depositCents ? t("products.depositPerUnit", { amount: fmt.money(sel.depositCents) }) : t("products.none"),
      exFormula: ex
        ? t("products.exFormula", { formula: exciseFormula(sel, rate), country: ctx.administration.country })
        : t("products.noExcise") + (sel.depositCents ? t("products.depositNote") : ""),
      stock: stock.length ? stock : [{ l: t("products.noStock"), v: "—" }],
      reorder: sel.reorderLevel ? t("products.reorder", { n: fmt.int(sel.reorderLevel) }) : t("products.noReorder"),
      low: Boolean(sel.reorderLevel && unitsIn(d.levels, sel.id) < sel.reorderLevel),
      sold: d.last90 ? t("products.units", { n: fmt.int(d.last90.units) }) : "—",
      rev: d.last90 && money ? fmt.money(d.last90.rev, { decimals: 0 }) : null,
      top: d.last90?.top ?? "—",
    };
  }
  if (sel || sp.new === "1") {
    const p = sel;
    edit = {
      id: p?.id ?? null,
      sku: p?.sku ?? "",
      name: p?.name ?? "",
      producer: p?.producer ?? "",
      region: p?.region ?? "",
      originCountry: p?.originCountry ?? "",
      category: p?.category ?? "WINE",
      volumeL: p ? String(p.volumeMl / 1000) : "0.75",
      abv: p ? String(p.abvBp / 100) : "",
      plato: p?.platoTenths ? String(p.platoTenths / 10) : "",
      vintage: p?.vintage ?? "",
      unitsPerCase: String(p?.unitsPerCase ?? 6),
      casesPerPallet: p?.casesPerPallet ? String(p.casesPerPallet) : "",
      ean: p?.ean ?? "",
      cnCode: p?.cnCode ?? "",
      emcsCode: p?.emcsCode ?? "",
      deposit: p ? (p.depositCents / 100).toFixed(2) : "0.00",
      reorderLevel: p?.reorderLevel ? String(p.reorderLevel) : "",
      cost: "",
      prices: Object.fromEntries(
        (p ? [...new Set(["Horeca", "Wholesale", "Export", ...lists(p)])] : ["Horeca", "Wholesale", "Export"]).map((l) => {
          const c = p ? latest(p, l) : null;
          return [l, c === null ? "" : (c / 100).toFixed(2)];
        }),
      ),
    };
  }
  const canEdit = canEditIn(ctx, "stock");

  return (
    <>
      <PageHead
        eyebrow={t("common.group.trade")}
        title={t("products.title")}
        actions={
          canEdit ? (
            <Link href={href({ new: "1", id: undefined, edit: undefined })} className="btn btn-primary" scroll={false}>
              <Icon name="Plus" size={16} />
              {t("products.newProduct")}
            </Link>
          ) : null
        }
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <form action="/products" className="search" style={{ height: 36, width: "min(320px,100%)", borderRadius: 8 }}>
          {cat.key !== "all" ? <input type="hidden" name="cat" value={cat.key} /> : null}
          <Icon name="MagnifyingGlass" />
          <input name="q" defaultValue={sp.q ?? ""} placeholder={t("products.searchPlaceholder")} style={{ fontSize: 13.5 }} />
        </form>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {GROUPS.map((g) => (
            <Link key={g.key} href={href({ cat: g.key === "all" ? undefined : g.key })} className="chip" aria-pressed={g.key === cat.key} style={{ fontSize: 13 }}>
              {t(`products.${g.label}`)}
              <span className="chip-count">{visible.filter((p) => g.match(p.category)).length}</span>
            </Link>
          ))}
          <Link href={href({ archived: showArchived ? undefined : "1" })} className="chip" aria-pressed={showArchived} style={{ fontSize: 13 }}>
            <Icon name="Archive" size={14} />
            {t("products.showArchived")}
          </Link>
        </div>
      </div>
      <div className="card card-clip">
        <div className="tbl">
          <div style={{ minWidth: money ? 1180 : 800 }}>
            <div className="tbl-head" style={{ gridTemplateColumns: cols, gap: 12 }}>
              <div />
              <div>{t("products.colProduct")}</div>
              <div>{t("products.colSku")}</div>
              <div>{t("products.colCategory")}</div>
              <div>{t("products.colSize")}</div>
              <div className="right">{t("products.colCase")}</div>
              <div className="right">{t("products.colStock")}</div>
              {money ? (
                <>
                  <div className="right">{t("products.colCost")}</div>
                  <div className="right">{t("products.colPrice")}</div>
                  <div className="right">{t("products.colMargin")}</div>
                  <div className="right">{t("products.colExcise")}</div>
                </>
              ) : null}
            </div>
            {rows.map((p) => {
              const st = CATEGORY_STYLE[p.category]!;
              const n = unitsIn(d.levels, p.id);
              const low = Boolean(p.reorderLevel && n < p.reorderLevel);
              const price = latest(p, "Horeca") ?? latest(p, lists(p)[0] ?? "");
              const ex = excisePerUnit(p, d.rates.get(p.category));
              return (
                <Link key={p.id} href={href({ id: p.id, new: undefined, edit: undefined })} scroll={false} className="tbl-row n" style={{ gridTemplateColumns: cols, gap: 12, padding: "10px 16px", opacity: p.archivedAt ? 0.55 : 1 }}>
                  <CategoryTile category={p.category} size={36} />
                  <div style={{ minWidth: 0 }}>
                    <div className="truncate" style={{ fontWeight: 500 }}>{p.name}</div>
                    <div className="cell-sub truncate">
                      {[p.producer, p.originCountry ? countryName(p.originCountry, locale) : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div style={{ fontSize: 12.5, color: "#5b6474" }}>{p.sku}</div>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 999, background: st.bg, color: st.fg, whiteSpace: "nowrap" }}>{t(`products.cat${p.category}`)}</span>
                  </div>
                  <div style={{ color: "#3a4250" }}>
                    {litres(p.volumeMl)} · {abv(p.abvBp)}
                  </div>
                  <div className="right muted">× {p.unitsPerCase}</div>
                  <div className="right" style={{ fontWeight: 500, color: low ? "#9a5b00" : "#14171f" }}>{fmt.int(n)}</div>
                  {money ? (
                    <>
                      <div className="right">{fmt.money(p.costCents)}</div>
                      <div className="right" style={{ fontWeight: 600 }}>{price !== null ? fmt.money(price) : "—"}</div>
                      <div className="right" style={{ color: "#157347" }}>{price ? `${Math.round(((price - p.costCents) / price) * 100)}%` : "—"}</div>
                      <div className="right muted">{ex ? fmt.money(Math.round(ex)) : "—"}</div>
                    </>
                  ) : null}
                </Link>
              );
            })}
            {!rows.length ? <div style={{ padding: 36, textAlign: "center", color: "#5b6474" }}>{t("products.noMatch")}</div> : null}
          </div>
        </div>
      </div>
      <ProductDrawer
        open={Boolean(view || sp.new === "1")}
        view={view}
        edit={edit}
        startEditing={sp.new === "1" || sp.edit === "1"}
        canEdit={canEdit}
        closeHref={href({ id: undefined, new: undefined, edit: undefined })}
        baseHref={href({ id: undefined, new: undefined, edit: undefined })}
        countries={COUNTRY_CODES.map((c) => ({ code: c, label: `${flag(c)} ${countryName(c, locale)}` }))}
      />
    </>
  );
}
