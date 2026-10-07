"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Drawer, useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { Progress4, TONE, type Tone } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { blockShipment, bookArrival, saveShipment, setShipmentStage, unblockShipment } from "./actions";
import { T1Button } from "./row-client";

type Stage = "BOOKED" | "IN_TRANSIT" | "AT_CUSTOMS" | "ARRIVED";
type Direction = "IMPORT" | "EXPORT" | "EU" | "DOMESTIC";

export interface DrawerData {
  shipment: {
    id: string;
    ref: string;
    direction: Direction;
    origin: string;
    destination: string;
    mode: string;
    goods: string;
    eta: string;
    relationId: string;
    notes: string;
    stage: Stage;
    stageNote: string;
    blocked: boolean;
    blockReason: string;
    needsT1: boolean;
  } | null;
  nextRef: string;
  relations: { id: string; name: string; kind: string }[];
  warehouses: { id: string; name: string; kind: string }[];
  documents: { id: string; type: string; reference: string; status: string; hasFile: boolean; documentId: string }[];
  invoices: { id: string; number: string; supplier: string; total: string; status: string; date: string }[];
  arrival: { productId: string; name: string; sku: string; fromWarehouseId: string; qty: number; excisePerUnit: number }[];
  editable: boolean;
  canStock: boolean;
  money: boolean;
}

const DIR_TONE: Record<Direction, Tone> = { IMPORT: "blue", EXPORT: "wine", EU: "gray", DOMESTIC: "green" };
const DOC_TONE: Record<string, Tone> = { DRAFT: "gray", AWAITING: "blue", ACCEPTED: "green", RELEASED: "green", MISSING: "red", REJECTED: "red" };
const INV_TONE: Record<string, Tone> = { TO_APPROVE: "amber", BOOKED: "blue", PAID: "green" };

function Section({ title, children, aside }: { title: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function ShipmentDrawer({ data, stages }: { data: DrawerData; stages: Stage[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const close = () => router.push("/shipments", { scroll: false });
  const s = data.shipment;
  const [run, pending] = useAction(saveShipment, {
    onDone: (r) => {
      if (r.ok && !s && typeof r.id === "string") router.replace(`/shipments?id=${r.id}`, { scroll: false });
    },
  });
  const ro = !data.editable;
  const tone = s ? TONE[DIR_TONE[s.direction]] : null;

  return (
    <Drawer
      open
      onClose={close}
      width={720}
      header={
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div className="drawer-title n">{s ? s.ref : t("shipments.drawer.newTitle")}</div>
            {s && tone ? <span style={{ fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 999, background: tone.bg, color: tone.fg }}>{t(`shipments.dir.${s.direction}`)}</span> : null}
          </div>
          {s ? (
            <div className="drawer-sub">
              {s.origin} → {s.destination} · {s.mode}
            </div>
          ) : null}
        </div>
      }
      footer={
        ro ? (
          <button className="btn" onClick={close}>
            {t("common.close")}
          </button>
        ) : (
          <>
            <button className="btn" type="button" onClick={close}>
              {t("common.cancel")}
            </button>
            <button className="btn btn-primary" type="submit" form="ship-form" disabled={pending}>
              {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name={s ? "FloppyDisk" : "Plus"} size={16} />}
              {s ? t("shipments.drawer.save") : t("shipments.drawer.create")}
            </button>
          </>
        )
      }
    >
      {s ? <ProgressPanel key={`${s.stage}-${s.blocked}-${s.stageNote}`} data={data} stages={stages} /> : null}
      {s && s.direction === "IMPORT" && data.arrival.length ? <ArrivalPanel data={data} /> : null}

      <Section title={t("shipments.drawer.details")}>
        <form
          id="ship-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const g = (k: string) => String(f.get(k) ?? "");
            run({
              id: s?.id ?? "",
              ref: g("ref"),
              direction: g("direction") as Direction,
              origin: g("origin"),
              destination: g("destination"),
              mode: g("mode"),
              goods: g("goods"),
              eta: g("eta"),
              relationId: g("relationId"),
              notes: g("notes"),
            });
          }}
        >
          <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="form-grid">
              <label className="field">
                {t("shipments.drawer.ref")}
                <input className="input n" name="ref" defaultValue={s?.ref ?? data.nextRef} maxLength={30} required />
              </label>
              <label className="field">
                {t("shipments.drawer.direction")}
                <select className="select" name="direction" defaultValue={s?.direction ?? "IMPORT"}>
                  {(["IMPORT", "EXPORT", "EU", "DOMESTIC"] as Direction[]).map((d) => (
                    <option key={d} value={d}>
                      {t(`shipments.dir.${d}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                {t("shipments.drawer.origin")}
                <input className="input" name="origin" defaultValue={s?.origin ?? ""} placeholder={t("shipments.drawer.originPh")} maxLength={80} required />
              </label>
              <label className="field">
                {t("shipments.drawer.destination")}
                <input className="input" name="destination" defaultValue={s?.destination ?? ""} placeholder={t("shipments.drawer.destinationPh")} maxLength={80} required />
              </label>
            </div>
            <div className="form-grid">
              <label className="field">
                {t("shipments.drawer.mode")}
                <input className="input" name="mode" defaultValue={s?.mode ?? ""} placeholder={t("shipments.drawer.modePh")} maxLength={80} required />
              </label>
              <label className="field">
                {t("shipments.drawer.eta")}
                <input className="input n" type="date" name="eta" defaultValue={s?.eta ?? ""} />
              </label>
            </div>
            <label className="field">
              {t("shipments.drawer.goods")}
              <input className="input" name="goods" defaultValue={s?.goods ?? ""} placeholder={t("shipments.drawer.goodsPh")} maxLength={160} required />
            </label>
            <label className="field">
              {t("shipments.drawer.relation")}
              <select className="select" name="relationId" defaultValue={s?.relationId ?? ""}>
                <option value="">{t("shipments.drawer.noRelation")}</option>
                {[
                  ["CUSTOMER", t("shipments.drawer.customers")],
                  ["SUPPLIER", t("shipments.drawer.suppliers")],
                ].map(([kind, label]) => {
                  const items = data.relations.filter((r) => (kind === "CUSTOMER" ? r.kind !== "SUPPLIER" : r.kind !== "CUSTOMER"));
                  return items.length ? (
                    <optgroup key={kind} label={label}>
                      {items.map((r) => (
                        <option key={`${kind}-${r.id}`} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </label>
            <label className="field">
              {t("shipments.drawer.notes")}
              <textarea className="textarea" name="notes" defaultValue={s?.notes ?? ""} maxLength={2000} rows={3} />
            </label>
          </fieldset>
        </form>
      </Section>

      {s ? (
        <>
          <Section title={t("shipments.drawer.documents")}>
            {data.documents.length ? (
              <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
                {data.documents.map((c, i) => (
                  <div key={c.id} data-testid="ship-doc" style={{ display: "grid", gridTemplateColumns: "150px minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "10px 14px", fontSize: 13.5, borderTop: i ? "1px solid #eef0f3" : 0 }}>
                    <div style={{ fontWeight: 500 }}>{t(`shipments.docType.${c.type}`)}</div>
                    <div className="n truncate" style={{ color: "#3a4250", fontSize: 13 }}>
                      {c.reference || "—"}
                      {c.hasFile ? (
                        <a href={`/api/documents/${c.documentId}`} target="_blank" rel="noreferrer" style={{ marginLeft: 8, fontSize: 12.5 }}>
                          {t("shipments.drawer.file")}
                        </a>
                      ) : null}
                    </div>
                    <span className={`pill pill-${DOC_TONE[c.status] ?? "gray"}`}>{t(`shipments.docStatus.${c.status}`)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13.5, color: "#5b6474" }}>{t("shipments.drawer.noDocuments")}</div>
            )}
          </Section>
          <Section title={t("shipments.drawer.invoices")}>
            {data.invoices.length ? (
              <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
                {data.invoices.map((inv, i) => (
                  <div key={inv.id} data-testid="ship-invoice" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px auto", gap: 12, alignItems: "center", padding: "10px 14px", fontSize: 13.5, borderTop: i ? "1px solid #eef0f3" : 0 }}>
                    <div style={{ minWidth: 0 }}>
                      <Link href={`/purchases?id=${inv.id}`} style={{ fontWeight: 500 }}>
                        {inv.number}
                      </Link>
                      <div className="truncate" style={{ fontSize: 12.5, color: "#5b6474" }}>
                        {inv.supplier} · {inv.date}
                      </div>
                    </div>
                    <div className="n right" style={{ fontWeight: 500 }}>{inv.total}</div>
                    <span className={`pill pill-${INV_TONE[inv.status] ?? "gray"}`}>{t(`shipments.invStatus.${inv.status}`)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13.5, color: "#5b6474" }}>{t("shipments.drawer.noInvoices")}</div>
            )}
          </Section>
        </>
      ) : null}
    </Drawer>
  );
}

const STAGE_INDEX: Record<Stage, number> = { BOOKED: 0, IN_TRANSIT: 1, AT_CUSTOMS: 2, ARRIVED: 3 };

function ProgressPanel({ data, stages }: { data: DrawerData; stages: Stage[] }) {
  const { t } = useI18n();
  const s = data.shipment!;
  const idx = STAGE_INDEX[s.stage];
  const next = stages[idx + 1];
  const [stage, setStage] = useState<Stage>(s.stage);
  const [note, setNote] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState("");
  const [runStage, pStage] = useAction(setShipmentStage, { onDone: (r) => r.ok && setNote("") });
  const [runBlock, pBlock] = useAction(blockShipment, { onDone: (r) => r.ok && (setBlocking(false), setReason("")) });
  const [runUnblock, pUnblock] = useAction(unblockShipment);
  return (
    <Section title={t("shipments.drawer.progress")}>
      <div className="infobox" style={{ background: "#fff", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <Progress4 stage={idx} blocked={s.blocked} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4, marginTop: 6, fontSize: 12, color: "#8a93a3" }}>
            {stages.map((st, i) => (
              <span key={st} style={{ color: i === idx ? (s.blocked ? "#b42318" : "#14171f") : undefined, fontWeight: i === idx ? 500 : 400 }}>
                {t(`shipments.stage.${st}`)}
              </span>
            ))}
          </div>
          <div data-testid="drawer-stage-note" style={{ fontSize: 13, marginTop: 8, color: s.blocked ? "#b42318" : "#3a4250" }}>
            {s.stageNote || t(`shipments.stage.${s.stage}`)}
          </div>
        </div>

        {s.blocked ? (
          <div className="banner banner-error" style={{ alignItems: "center" }}>
            <Icon name="WarningCircle" size={17} />
            <div style={{ flex: 1 }}>{t("shipments.drawer.blockedNow", { reason: s.blockReason || "—" })}</div>
            {data.editable ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {s.needsT1 ? <T1Button shipmentId={s.id} shipmentRef={s.ref} /> : null}
                <button className="btn btn-sm" onClick={() => runUnblock({ id: s.id })} disabled={pUnblock}>
                  {t("shipments.drawer.unblock")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {data.editable ? (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {next ? (
                <button className="btn btn-primary btn-sm" onClick={() => runStage({ id: s.id, stage: next, note })} disabled={pStage}>
                  <Icon name="ArrowRight" size={15} />
                  {t("shipments.drawer.advance", { stage: t(`shipments.stage.${next}`) })}
                </button>
              ) : null}
              {!s.blocked ? (
                <button className="btn btn-sm" onClick={() => setBlocking((b) => !b)}>
                  <Icon name="Prohibit" size={15} />
                  {t("shipments.drawer.block")}
                </button>
              ) : null}
            </div>
            {blocking ? (
              <form
                style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  runBlock({ id: s.id, reason });
                }}
              >
                <label className="field" style={{ flex: "1 1 260px" }}>
                  {t("shipments.drawer.blockReason")}
                  <input className="input" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("shipments.drawer.blockReasonPh")} maxLength={120} required autoFocus />
                </label>
                <button className="btn btn-sm" type="submit" disabled={pBlock || reason.trim().length < 2} style={{ height: 36, color: "#b42318" }}>
                  {t("shipments.drawer.blockConfirm")}
                </button>
              </form>
            ) : null}
            <form
              style={{ display: "grid", gridTemplateColumns: "minmax(140px,180px) minmax(0,1fr) auto", gap: 8, alignItems: "flex-end" }}
              onSubmit={(e) => {
                e.preventDefault();
                runStage({ id: s.id, stage, note });
              }}
            >
              <label className="field">
                {t("shipments.drawer.setStage")}
                <select className="select" name="stage" value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
                  {stages.map((st) => (
                    <option key={st} value={st}>
                      {t(`shipments.stage.${st}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t("shipments.drawer.stageNote")}
                <input className="input" name="stageNote" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("shipments.drawer.stageNotePh")} maxLength={120} />
              </label>
              <button className="btn" type="submit" disabled={pStage}>
                {t("shipments.drawer.setStageBtn")}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </Section>
  );
}

function ArrivalPanel({ data }: { data: DrawerData }) {
  const { t, fmt } = useI18n();
  const s = data.shipment!;
  const firstBonded = data.warehouses.find((w) => w.kind === "BONDED") ?? data.warehouses[0];
  const [wh, setWh] = useState(firstBonded?.id ?? "");
  const [run, pending] = useAction(bookArrival);
  const target = data.warehouses.find((w) => w.id === wh);
  const units = data.arrival.reduce((a, l) => a + l.qty, 0);
  const excise = data.arrival.reduce((a, l) => a + Math.round(l.excisePerUnit * l.qty), 0);
  const arrived = s.stage === "ARRIVED";
  if (!arrived) {
    return (
      <div className="banner banner-info">
        <Icon name="Package" size={17} />
        <div>{t("shipments.drawer.arrivalLater", { n: fmt.int(units) })}</div>
      </div>
    );
  }
  return (
    <section className="suggest" data-testid="arrival-panel" style={{ flexDirection: "column", alignItems: "stretch", gap: 12, padding: "14px 16px", borderRadius: 10 }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15, color: "#7a1f3d", display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="Package" size={17} />
          {t("shipments.drawer.arrival")}
        </div>
        <div style={{ fontSize: 13, color: "#3a4250", marginTop: 4 }}>{t("shipments.drawer.arrivalIntro")}</div>
      </div>
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8 }}>
        {data.arrival.map((l, i) => (
          <div key={`${l.productId}-${l.fromWarehouseId}`} className="n" style={{ display: "grid", gridTemplateColumns: "80px minmax(0,1fr) 90px", gap: 12, padding: "8px 12px", fontSize: 13.5, borderTop: i ? "1px solid #eef0f3" : 0 }}>
            <span style={{ color: "#5b6474", fontSize: 12.5 }}>{l.sku}</span>
            <span style={{ fontWeight: 500 }}>{l.name}</span>
            <span className="right" style={{ fontWeight: 600 }}>{fmt.int(l.qty)}</span>
          </div>
        ))}
      </div>
      {data.canStock ? (
        <>
          <label className="field">
            {t("shipments.drawer.arrivalInto")}
            <select className="select" name="arrivalWarehouse" value={wh} onChange={(e) => setWh(e.target.value)} style={{ background: "#fff" }}>
              {data.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {t(`stock.kind.${w.kind}`)}
                </option>
              ))}
            </select>
          </label>
          {target ? (
            target.kind === "DUTY_PAID" ? (
              <div className="banner banner-warn" data-testid="arrival-note">
                <Icon name="Warning" size={17} />
                <div>{data.money ? t("shipments.drawer.arrivalRelease", { amount: fmt.money(excise) }) : t("shipments.drawer.arrivalReleaseNoMoney")}</div>
              </div>
            ) : (
              <div className="banner banner-info" data-testid="arrival-note">
                <Icon name="Info" size={17} />
                <div>{t("shipments.drawer.arrivalSuspended")}</div>
              </div>
            )
          ) : null}
          <div>
            <button className="btn btn-primary" onClick={() => run({ id: s.id, warehouseId: wh })} disabled={pending || !wh}>
              {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Check" size={16} />}
              {t("shipments.drawer.arrivalConfirm")} · {fmt.int(units)}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
