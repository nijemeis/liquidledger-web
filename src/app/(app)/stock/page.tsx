import type { Metadata } from "next";
import Link from "next/link";
import type { WarehouseKind } from "@prisma/client";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Empty, PageHead, TONE, type Tone } from "@/components/ui";
import { excisePerUnit, ratesOn } from "@/lib/domain/excise";
import { stockLevels, unitsIn } from "@/lib/domain/stock";
import { seesFinancials } from "@/lib/permissions";
import { StockActions, type StockProduct, type StockWarehouse } from "./stock-actions";

export const metadata: Metadata = { title: "Stock & warehouses" };

const KIND_ORDER: Record<WarehouseKind, number> = { BONDED: 0, DUTY_PAID: 1, IN_TRANSIT: 2 };
const KIND_TONE: Record<WarehouseKind, Tone> = { BONDED: "blue", DUTY_PAID: "green", IN_TRANSIT: "amber" };

const COLS_MONEY = "90px minmax(140px,2fr) 100px 56px 80px 80px 90px 110px 100px 50px";
const COLS_QTY = "90px minmax(140px,2fr) 100px 56px 80px 80px 90px 50px";
const MOVE_COLS = "100px minmax(0,1.6fr) minmax(0,1.4fr) 90px 140px";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ wh?: string }> }) {
  const ctx = await requireApp("stock");
  const { t, fmt } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const A = ctx.administration.id;
  const money = seesFinancials(ctx.role);
  const canEdit = canEditIn(ctx, "stock");

  const d = await tenant(ctx, async (tx) => {
    const [warehouses, products, levels, rates] = await Promise.all([
      tx.warehouse.findMany({ where: { administrationId: A, archivedAt: null } }),
      tx.product.findMany({ where: { administrationId: A }, orderBy: { sku: "asc" } }),
      stockLevels(tx, A),
      ratesOn(tx, ctx.administration.country, new Date()),
    ]);
    warehouses.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
    const selected = warehouses.find((w) => w.id === sp.wh) ?? warehouses[0] ?? null;
    const movements = selected
      ? await tx.stockMovement.findMany({
          where: { administrationId: A, OR: [{ fromWarehouseId: selected.id }, { toWarehouseId: selected.id }] },
          orderBy: [{ at: "desc" }, { id: "desc" }],
          take: 50,
        })
      : [];
    return { warehouses, products, levels, rates, selected, movements };
  });

  const perUnit = new Map(d.products.map((p) => [p.id, excisePerUnit(p, d.rates.get(p.category))]));
  const whName = new Map(d.warehouses.map((w) => [w.id, w.name]));
  const prodById = new Map(d.products.map((p) => [p.id, p]));

  const cards = d.warehouses.map((w) => {
    let bottles = 0, value = 0, excise = 0, litres = 0, n = 0;
    for (const p of d.products) {
      const q = unitsIn(d.levels, p.id, w.id);
      if (!q) continue;
      n++;
      bottles += q;
      value += q * p.costCents;
      excise += Math.round(q * (perUnit.get(p.id) ?? 0));
      litres += (q * p.volumeMl) / 1000;
    }
    return { w, bottles, value, excise, litres, n };
  });

  const sel = d.selected;
  const rows = sel
    ? d.products
        .map((p) => {
          const q = unitsIn(d.levels, p.id, sel.id);
          return {
            p,
            q,
            litres: (q * p.volumeMl) / 1000,
            lpa: (q * p.volumeMl * p.abvBp) / 10_000_000,
            excise: Math.round(q * (perUnit.get(p.id) ?? 0)),
            value: q * p.costCents,
            low: sel.kind !== "IN_TRANSIT" && p.reorderLevel != null && q < p.reorderLevel,
          };
        })
        .filter((r) => r.q !== 0)
    : [];
  const tot = rows.reduce((a, r) => ({ q: a.q + r.q, litres: a.litres + r.litres, lpa: a.lpa + r.lpa, excise: a.excise + r.excise, value: a.value + r.value }), { q: 0, litres: 0, lpa: 0, excise: 0, value: 0 });
  const cols = money ? COLS_MONEY : COLS_QTY;
  const onRelease = sel ? sel.kind !== "DUTY_PAID" : true;

  // Data for the action modals.
  const levelsObj: Record<string, Record<string, number>> = {};
  for (const [pid, m] of d.levels) levelsObj[pid] = Object.fromEntries(m);
  const actionProducts: StockProduct[] = d.products
    .filter((p) => !p.archivedAt || unitsIn(d.levels, p.id) > 0)
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, costCents: money ? p.costCents : 0, excisePerUnit: money ? (perUnit.get(p.id) ?? 0) : 0 }));
  const actionWarehouses: StockWarehouse[] = d.warehouses.map((w) => ({ id: w.id, name: w.name, kind: w.kind }));

  const reasonLabel = (m: (typeof d.movements)[number]) => {
    const incoming = m.toWarehouseId === sel?.id;
    const other = whName.get((incoming ? m.fromWarehouseId : m.toWarehouseId) ?? "") ?? "—";
    switch (m.reason) {
      case "TRANSFER":
        return t(incoming ? "stock.reason.TRANSFER_IN" : "stock.reason.TRANSFER_OUT", { name: other });
      case "RELEASE_FOR_CONSUMPTION":
        return t(incoming ? "stock.reason.RELEASE_IN" : "stock.reason.RELEASE_OUT", { name: other });
      default:
        return t(`stock.reason.${m.reason}`);
    }
  };

  return (
    <>
      <PageHead
        eyebrow={t("common.group.trade")}
        title={t("common.nav.stock")}
        actions={
          canEdit ? (
            <StockActions products={actionProducts} warehouses={actionWarehouses} levels={levelsObj} selectedId={sel?.id ?? null} money={money} />
          ) : null
        }
      />

      {d.warehouses.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 20 }}>
          {cards.map(({ w, bottles, value, excise, litres, n }) => {
            const active = sel?.id === w.id;
            const tone = TONE[KIND_TONE[w.kind]];
            return (
              <Link
                key={w.id}
                href={`/stock?wh=${w.id}`}
                scroll={false}
                aria-current={active ? "true" : undefined}
                data-testid="wh-card"
                style={{
                  textAlign: "left",
                  color: "inherit",
                  textDecoration: "none",
                  background: "#fff",
                  border: `1px solid ${active ? "#7a1f3d" : "#e4e7ec"}`,
                  boxShadow: active ? "0 0 0 3px #f1d5df" : "none",
                  borderRadius: 12,
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 600 }}>{w.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 999, background: tone.bg, color: tone.fg, whiteSpace: "nowrap" }}>{t(`stock.kind.${w.kind}`)}</span>
                </div>
                <div className="n" style={{ fontSize: 21, fontWeight: 600 }}>
                  {fmt.int(bottles)} <span style={{ fontSize: 13, fontWeight: 400, color: "#5b6474" }}>{t("stock.card.bottles")}</span>
                </div>
                <div className="n" style={{ fontSize: 12.5, color: "#5b6474" }}>
                  {money
                    ? `${t("stock.card.atCost", { value: fmt.money(value, { decimals: 0 }) })} · ${t(w.kind === "DUTY_PAID" ? "stock.card.paid" : "stock.card.onRelease", { amount: fmt.money(excise, { decimals: 0 }) })}`
                    : t("stock.card.products", { n, litres: fmt.int(litres) })}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          <Empty icon="Warehouse" color="#7a1f3d" title={t("stock.noWarehouses")} />
        </div>
      )}

      {sel ? (
        <>
          <div className="card card-clip" style={{ marginBottom: 20 }}>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: money ? 1000 : 780 }}>
                <div className="tbl-head" style={{ gridTemplateColumns: cols, gap: 12 }}>
                  <div>{t("stock.col.sku")}</div>
                  <div>{t("stock.col.product")}</div>
                  <div>{t("stock.col.category")}</div>
                  <div className="right">{t("stock.col.abv")}</div>
                  <div className="right">{t("stock.col.bottles")}</div>
                  <div className="right">{t("stock.col.litres")}</div>
                  <div className="right">{t("stock.col.lpa")}</div>
                  {money ? <div className="right">{t(onRelease ? "stock.col.exciseOnRelease" : "stock.col.excisePaid")}</div> : null}
                  {money ? <div className="right">{t("stock.col.value")}</div> : null}
                  <div />
                </div>
                {rows.length ? (
                  <>
                    {rows.map((r) => (
                      <div key={r.p.id} className="tbl-row n" data-testid="stock-row" style={{ gridTemplateColumns: cols, gap: 12, padding: "12px 16px" }}>
                        <div style={{ color: "#5b6474", fontSize: 12.5 }}>{r.p.sku}</div>
                        <div style={{ fontWeight: 500 }}>{r.p.name}</div>
                        <div style={{ color: "#5b6474" }}>{t(`stock.cat.${r.p.category}`)}</div>
                        <div className="right">{fmt.pct(r.p.abvBp)}</div>
                        <div className="right" style={{ fontWeight: 600 }}>{fmt.int(r.q)}</div>
                        <div className="right">{fmt.int(r.litres)}</div>
                        <div className="right">{fmt.int(r.lpa)}</div>
                        {money ? <div className="right">{fmt.money(r.excise, { decimals: 0 })}</div> : null}
                        {money ? <div className="right">{fmt.money(r.value, { decimals: 0 })}</div> : null}
                        <div>
                          {r.low ? (
                            <span title={t("stock.lowTitle", { n: fmt.int(r.p.reorderLevel ?? 0) })} style={{ fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 999, background: "#fff3dc", color: "#9a5b00" }}>
                              {t("stock.low")}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    <div className="tbl-row total n" data-testid="stock-total" style={{ gridTemplateColumns: cols, gap: 12, padding: "13px 16px", fontSize: 14 }}>
                      <div />
                      <div>{t("stock.total")}</div>
                      <div />
                      <div />
                      <div className="right">{fmt.int(tot.q)}</div>
                      <div className="right">{fmt.int(tot.litres)}</div>
                      <div className="right">{fmt.int(tot.lpa)}</div>
                      {money ? <div className="right">{fmt.money(tot.excise, { decimals: 0 })}</div> : null}
                      {money ? <div className="right">{fmt.money(tot.value, { decimals: 0 })}</div> : null}
                      <div />
                    </div>
                  </>
                ) : (
                  <Empty icon="Package" color="#8a93a3" title={t("stock.emptyTitle", { name: sel.name })}>
                    <div style={{ fontSize: 13 }}>{t("stock.emptyText")}</div>
                  </Empty>
                )}
              </div>
            </div>
          </div>

          <div className="card card-clip">
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #e4e7ec", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>{t("stock.movements.title", { name: sel.name })}</span>
              <span style={{ fontSize: 12.5, color: "#5b6474" }}>{t("stock.movements.sub")}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 720 }}>
                <div className="tbl-head" style={{ gridTemplateColumns: MOVE_COLS, gap: 12 }}>
                  <div>{t("stock.col.date")}</div>
                  <div>{t("stock.col.product")}</div>
                  <div>{t("stock.col.reason")}</div>
                  <div className="right">{t("stock.col.qty")}</div>
                  <div>{t("stock.col.document")}</div>
                </div>
                {d.movements.length ? (
                  d.movements.map((m) => {
                    const incoming = m.toWarehouseId === sel.id;
                    const p = prodById.get(m.productId);
                    return (
                      <div key={m.id} className="tbl-row n" data-testid="movement-row" style={{ gridTemplateColumns: MOVE_COLS, gap: 12, padding: "11px 16px" }}>
                        <div style={{ color: "#5b6474" }}>{fmt.dateMed(m.at)}</div>
                        <div className="truncate" style={{ fontWeight: 500 }}>{p?.name ?? "—"}</div>
                        <div className="truncate" style={{ color: "#3a4250" }} title={m.note ?? undefined}>
                          {reasonLabel(m)}
                        </div>
                        <div className="right" style={{ fontWeight: 600, color: incoming ? "#157347" : "#14171f" }}>
                          {incoming ? "+" : "−"}
                          {fmt.int(m.qty)}
                        </div>
                        <div className="truncate" style={{ color: "#5b6474", fontSize: 12.5 }}>{m.documentRef ?? "—"}</div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ padding: "24px 16px", color: "#5b6474", fontSize: 13.5, textAlign: "center" }}>{t("stock.movements.empty")}</div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
