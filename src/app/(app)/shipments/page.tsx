import type { Metadata } from "next";
import Link from "next/link";
import type { ShipmentDirection, ShipmentStage } from "@prisma/client";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Icon } from "@/components/icon";
import { Empty, PageHead, Progress4, TONE, type Tone } from "@/components/ui";
import { canEdit, seesFinancials } from "@/lib/permissions";
import { nextShipmentRef, pendingArrival, STAGES, type ArrivalLine } from "./arrival";
import { RowLink, T1Button } from "./row-client";
import { ShipmentDrawer, type DrawerData } from "./shipment-drawer";

export const metadata: Metadata = { title: "Orders & shipments" };

const DIR_TONE: Record<ShipmentDirection, Tone> = { IMPORT: "blue", EXPORT: "wine", EU: "gray", DOMESTIC: "green" };
const STAGE_ORDER: Record<ShipmentStage, number> = { BOOKED: 0, IN_TRANSIT: 1, AT_CUSTOMS: 2, ARRIVED: 3 };
const COLS = "90px 80px minmax(0,1.3fr) minmax(0,1.5fr) 80px 220px 130px";

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ id?: string; new?: string }> }) {
  const ctx = await requireApp("customs");
  const { t, fmt } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const A = ctx.administration.id;
  const editable = canEditIn(ctx, "customs");
  const money = seesFinancials(ctx.role);

  const d = await tenant(ctx, async (tx) => {
    const [shipments, docs] = await Promise.all([
      tx.shipment.findMany({ where: { administrationId: A }, orderBy: { createdAt: "asc" } }),
      tx.customsDocument.findMany({ where: { administrationId: A, shipmentId: { not: null } }, orderBy: { createdAt: "asc" } }),
    ]);
    // Pending arrivals for arrived (or arriving) imports.
    const pending = new Map<string, ArrivalLine[]>();
    for (const s of shipments.filter((x) => x.direction === "IMPORT")) {
      const p = await pendingArrival(tx, A, s.id, ctx.administration.country);
      if (p.length) pending.set(s.id, p);
    }
    const open = sp.id ? shipments.find((s) => s.id === sp.id) ?? null : null;
    const wantDrawer = !!open || sp.new === "1";
    const [relations, warehouses, invoices, nextRef] = wantDrawer
      ? await Promise.all([
          tx.relation.findMany({ where: { administrationId: A, archivedAt: null }, select: { id: true, name: true, kind: true }, orderBy: { name: "asc" } }),
          tx.warehouse.findMany({ where: { administrationId: A, archivedAt: null, kind: { not: "IN_TRANSIT" } }, select: { id: true, name: true, kind: true }, orderBy: { name: "asc" } }),
          open
            ? tx.purchaseInvoice.findMany({ where: { administrationId: A, shipmentId: open.id }, select: { id: true, number: true, supplierName: true, totalCents: true, status: true, issueDate: true }, orderBy: { issueDate: "asc" } })
            : Promise.resolve([]),
          nextShipmentRef(tx, A),
        ])
      : [[], [], [], ""];
    return { shipments, docs, pending, open, wantDrawer, relations, warehouses, invoices, nextRef };
  });

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const etaLabel = (eta: Date | null) => (!eta ? "—" : eta.toISOString().slice(0, 10) === todayKey ? t("shipments.today") : fmt.date(eta));

  const list = [...d.shipments].sort((a, b) => {
    const sa = STAGE_ORDER[a.stage], sb = STAGE_ORDER[b.stage];
    if (sa !== sb) return sa - sb;
    if (a.stage === "ARRIVED") return (b.eta?.getTime() ?? 0) - (a.eta?.getTime() ?? 0);
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const docsOf = (sid: string) => d.docs.filter((c) => c.shipmentId === sid);
  const needsT1 = (sid: string, reason: string | null) => {
    const t1 = docsOf(sid).filter((c) => c.type === "T1");
    return t1.some((c) => c.status === "MISSING" || c.status === "REJECTED") || (!t1.some((c) => c.status === "ACCEPTED" || c.status === "RELEASED") && /\bT1\b/i.test(reason ?? ""));
  };

  let drawer: DrawerData | null = null;
  if (d.wantDrawer) {
    const s = d.open;
    drawer = {
      shipment: s
        ? {
            id: s.id,
            ref: s.ref,
            direction: s.direction,
            origin: s.origin,
            destination: s.destination,
            mode: s.mode,
            goods: s.goods,
            eta: s.eta ? s.eta.toISOString().slice(0, 10) : "",
            relationId: s.relationId ?? "",
            notes: s.notes ?? "",
            stage: s.stage,
            stageNote: s.stageNote ?? "",
            blocked: s.blocked,
            blockReason: s.blockReason ?? "",
            needsT1: s.blocked && needsT1(s.id, s.blockReason),
          }
        : null,
      nextRef: d.nextRef,
      relations: d.relations.map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
      warehouses: d.warehouses.map((w) => ({ id: w.id, name: w.name, kind: w.kind })),
      documents: s
        ? docsOf(s.id).map((c) => ({ id: c.id, type: c.type, reference: c.reference ?? "", status: c.status, hasFile: !!c.documentId, documentId: c.documentId ?? "" }))
        : [],
      invoices: d.invoices.map((i) => ({ id: i.id, number: i.number, supplier: i.supplierName, total: money ? fmt.money(i.totalCents) : "", status: i.status, date: fmt.dateMed(i.issueDate) })),
      arrival: s ? (d.pending.get(s.id) ?? []).map((l) => ({ ...l, excisePerUnit: money ? l.excisePerUnit : 0 })) : [],
      editable,
      canStock: editable && canEdit(ctx.role, "stock"),
      money,
    };
  }

  return (
    <>
      <PageHead
        eyebrow={t("common.group.trade")}
        title={t("common.nav.shipments")}
        actions={
          editable ? (
            <Link href="/shipments?new=1" scroll={false} className="btn btn-primary">
              <Icon name="Plus" size={16} />
              {t("shipments.newOrder")}
            </Link>
          ) : null
        }
      />

      <div className="card card-clip">
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 960 }}>
            <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 12 }}>
              <div>{t("shipments.col.ref")}</div>
              <div>{t("shipments.col.type")}</div>
              <div>{t("shipments.col.route")}</div>
              <div>{t("shipments.col.goods")}</div>
              <div>{t("shipments.col.eta")}</div>
              <div>{t("shipments.col.progress")}</div>
              <div />
            </div>
            {list.length ? (
              list.map((s) => {
                const tone = TONE[DIR_TONE[s.direction]];
                const pend = d.pending.get(s.id);
                const showT1 = s.blocked && editable && needsT1(s.id, s.blockReason);
                return (
                  <RowLink key={s.id} href={`/shipments?id=${s.id}`} cols={COLS} testId="ship-row">
                    <div className="n" style={{ color: "#7a1f3d", fontWeight: 500 }}>{s.ref}</div>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 999, background: tone.bg, color: tone.fg }}>{t(`shipments.dir.${s.direction}`)}</span>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>
                        {s.origin} → {s.destination}
                      </div>
                      <div style={{ fontSize: 12.5, color: "#5b6474" }}>{s.mode}</div>
                    </div>
                    <div style={{ color: "#3a4250", minWidth: 0 }}>{s.goods}</div>
                    <div className="n" style={{ color: "#5b6474" }}>{etaLabel(s.eta)}</div>
                    <div>
                      <Progress4 stage={STAGE_ORDER[s.stage]} blocked={s.blocked} />
                      <div style={{ fontSize: 12.5, marginTop: 5, color: s.blocked ? "#b42318" : "#5b6474" }} data-testid="stage-text">
                        {s.stageNote || t(`shipments.stage.${s.stage}`)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {showT1 ? (
                        <T1Button shipmentId={s.id} shipmentRef={s.ref} />
                      ) : s.blocked && editable ? (
                        <Link href={`/shipments?id=${s.id}`} scroll={false} className="btn btn-primary btn-sm" data-stop="1">
                          <Icon name="Warning" size={15} />
                          {t("shipments.resolve")}
                        </Link>
                      ) : pend && s.stage === "ARRIVED" && editable && canEdit(ctx.role, "stock") ? (
                        <Link href={`/shipments?id=${s.id}`} scroll={false} className="btn btn-sm" data-stop="1">
                          <Icon name="Package" size={15} />
                          {t("shipments.bookArrival")}
                        </Link>
                      ) : null}
                    </div>
                  </RowLink>
                );
              })
            ) : (
              <Empty icon="Boat" color="#7a1f3d" title={t("shipments.empty")}>
                <div style={{ fontSize: 13 }}>{t("shipments.emptyText")}</div>
              </Empty>
            )}
          </div>
        </div>
      </div>

      {drawer ? <ShipmentDrawer key={drawer.shipment?.id ?? "new"} data={drawer} stages={[...STAGES]} /> : null}
    </>
  );
}
