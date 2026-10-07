"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { WarehouseKind } from "@prisma/client";
import { Modal, useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n/client";
import { addWarehouse, countStockAction, moveStock, sampleStock } from "./actions";

export interface StockProduct {
  id: string;
  name: string;
  sku: string;
  costCents: number; // 0 when the viewer doesn't see money
  excisePerUnit: number; // fractional cents
}
export interface StockWarehouse {
  id: string;
  name: string;
  kind: WarehouseKind;
}

type Props = { products: StockProduct[]; warehouses: StockWarehouse[]; levels: Record<string, Record<string, number>>; selectedId: string | null; money: boolean };
type Open = null | "move" | "sample" | "count" | "warehouse";

export function StockActions(props: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  return (
    <>
      <button className="btn" onClick={() => setOpen("warehouse")}>
        <Icon name="Warehouse" size={16} />
        {t("stock.actions.addWarehouse")}
      </button>
      <button className="btn" onClick={() => setOpen("count")} disabled={!props.warehouses.length}>
        <Icon name="ListChecks" size={16} />
        {t("stock.actions.count")}
      </button>
      <button className="btn" onClick={() => setOpen("sample")} disabled={!props.warehouses.length}>
        <Icon name="Wine" size={16} />
        {t("stock.actions.samples")}
      </button>
      <button className="btn" onClick={() => setOpen("move")} disabled={props.warehouses.length < 2}>
        <Icon name="ArrowsLeftRight" size={16} />
        {t("stock.actions.move")}
      </button>
      {open === "move" ? <MoveModal {...props} onClose={close} /> : null}
      {open === "sample" ? <SampleModal {...props} onClose={close} /> : null}
      {open === "count" ? <CountModal {...props} onClose={close} /> : null}
      {open === "warehouse" ? <WarehouseModal onClose={close} /> : null}
    </>
  );
}

const lvl = (levels: Props["levels"], p: string, w: string) => levels[p]?.[w] ?? 0;
const toInt = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

function ProductSelect({ products, value, onChange, levels, warehouseId, onlyInStock }: { products: StockProduct[]; value: string; onChange: (v: string) => void; levels: Props["levels"]; warehouseId?: string; onlyInStock?: boolean }) {
  const { t, fmt } = useI18n();
  const list = onlyInStock && warehouseId ? products.filter((p) => lvl(levels, p.id, warehouseId) > 0 || p.id === value) : products;
  return (
    <label className="field">
      {t("stock.f.product")}
      <select className="select" name="product" value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">{t("stock.f.pick")}</option>
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {warehouseId ? ` · ${t("stock.f.inStock", { n: fmt.int(lvl(levels, p.id, warehouseId)) })}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function WarehouseSelect({ label, warehouses, value, onChange, name }: { label: string; warehouses: StockWarehouse[]; value: string; onChange: (v: string) => void; name: string }) {
  const { t } = useI18n();
  return (
    <label className="field">
      {label}
      <select className="select" name={name} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">{t("stock.f.pick")}</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} · {t(`stock.kind.${w.kind}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

function MoveModal({ products, warehouses, levels, selectedId, money, onClose }: Props & { onClose: () => void }) {
  const { t, fmt } = useI18n();
  const [from, setFrom] = useState(selectedId ?? "");
  const [to, setTo] = useState(() => {
    const src = warehouses.find((w) => w.id === selectedId);
    return warehouses.find((w) => w.id !== selectedId && (src?.kind !== "DUTY_PAID" || w.kind === "DUTY_PAID"))?.id ?? "";
  });
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [run, pending] = useAction(moveStock, { onDone: (r) => r.ok && onClose() });
  const fromW = warehouses.find((w) => w.id === from);
  const toW = warehouses.find((w) => w.id === to);
  const product = products.find((p) => p.id === productId);
  const n = toInt(qty);
  const have = productId && from ? lvl(levels, productId, from) : 0;
  const release = fromW && toW && fromW.kind !== "DUTY_PAID" && toW.kind === "DUTY_PAID";
  const backToBond = fromW && toW && fromW.kind === "DUTY_PAID" && toW.kind !== "DUTY_PAID";
  const excise = product && n > 0 ? Math.round(product.excisePerUnit * n) : 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={t("stock.move.title")}
      width={520}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" type="submit" form="move-form" disabled={pending || !productId || !from || !to || !(n > 0) || from === to || !!backToBond}>
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="ArrowsLeftRight" size={16} />}
            {n > 0 ? t("stock.move.confirm", { n: fmt.int(n) }) : t("stock.actions.move")}
          </button>
        </>
      }
    >
      <form
        id="move-form"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run({ productId, fromWarehouseId: from, toWarehouseId: to, qty: n });
        }}
      >
        <ProductSelect products={products} value={productId} onChange={setProductId} levels={levels} warehouseId={from || undefined} onlyInStock />
        <div className="form-grid">
          <WarehouseSelect label={t("stock.f.from")} name="from" warehouses={warehouses} value={from} onChange={setFrom} />
          <WarehouseSelect label={t("stock.f.to")} name="to" warehouses={warehouses.filter((w) => w.id !== from)} value={to} onChange={setTo} />
        </div>
        <label className="field">
          {t("stock.f.qty")}
          <input className="input n" name="qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" required />
          {productId && from ? <span className="field-label">{t("stock.f.available", { n: fmt.int(have) })}</span> : null}
        </label>
        {from && to && from === to ? <div className="banner banner-error">{t("stock.err.same")}</div> : null}
        {n > have && productId && from ? (
          <div className="banner banner-error">{t("stock.err.notEnough", { product: product?.name ?? "", wh: fromW?.name ?? "", have: fmt.int(have), qty: fmt.int(n) })}</div>
        ) : null}
        {backToBond ? (
          <div className="banner banner-error">{t("stock.err.backToBond")}</div>
        ) : release ? (
          <div className="banner banner-warn" data-testid="release-note">
            <Icon name="Warning" size={17} />
            <div>{money && product && n > 0 ? t("stock.move.release", { amount: fmt.money(excise) }) : t("stock.move.releaseNoMoney")}</div>
          </div>
        ) : fromW && toW ? (
          <div className="banner banner-info">
            <Icon name="Info" size={17} />
            <div>{fromW.kind === "DUTY_PAID" ? t("stock.move.dutyPaid") : t("stock.move.suspended")}</div>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

function SampleModal({ products, warehouses, levels, selectedId, money, onClose }: Props & { onClose: () => void }) {
  const { t, fmt } = useI18n();
  const [wh, setWh] = useState(selectedId ?? "");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [run, pending] = useAction(sampleStock, { onDone: (r) => r.ok && onClose() });
  const w = warehouses.find((x) => x.id === wh);
  const product = products.find((p) => p.id === productId);
  const n = toInt(qty);
  const have = productId && wh ? lvl(levels, productId, wh) : 0;
  const excise = product && n > 0 ? Math.round(product.excisePerUnit * n) : 0;
  const bonded = w && w.kind !== "DUTY_PAID";
  return (
    <Modal
      open
      onClose={onClose}
      title={t("stock.sample.title")}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" type="submit" form="sample-form" disabled={pending || !productId || !wh || !(n > 0)}>
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Wine" size={16} />}
            {t("stock.sample.confirm")}
          </button>
        </>
      }
    >
      <form
        id="sample-form"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run({ productId, warehouseId: wh, qty: n, note });
        }}
      >
        <WarehouseSelect label={t("stock.f.warehouse")} name="warehouse" warehouses={warehouses} value={wh} onChange={setWh} />
        <ProductSelect products={products} value={productId} onChange={setProductId} levels={levels} warehouseId={wh || undefined} onlyInStock />
        <label className="field">
          {t("stock.f.qty")}
          <input className="input n" name="qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" required />
          {productId && wh ? <span className="field-label">{t("stock.f.available", { n: fmt.int(have) })}</span> : null}
        </label>
        <label className="field">
          {t("stock.f.note")}
          <input className="input" name="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("stock.f.notePh")} maxLength={200} />
        </label>
        {n > have && productId && wh ? (
          <div className="banner banner-error">{t("stock.err.notEnough", { product: product?.name ?? "", wh: w?.name ?? "", have: fmt.int(have), qty: fmt.int(n) })}</div>
        ) : null}
        {w ? (
          bonded ? (
            <div className="banner banner-warn" data-testid="sample-note">
              <Icon name="Warning" size={17} />
              <div>
                {money && product && n > 0 ? t("stock.sample.fromBond", { amount: fmt.money(excise) }) : t("stock.sample.fromBondNoMoney")} {t("stock.sample.booked")}
              </div>
            </div>
          ) : (
            <div className="banner banner-info" data-testid="sample-note">
              <Icon name="Info" size={17} />
              <div>
                {t("stock.sample.dutyPaid")} {t("stock.sample.booked")}
              </div>
            </div>
          )
        ) : null}
      </form>
    </Modal>
  );
}

function CountModal({ products, warehouses, levels, selectedId, money, onClose }: Props & { onClose: () => void }) {
  const { t, fmt } = useI18n();
  const [wh, setWh] = useState(selectedId ?? "");
  const [productId, setProductId] = useState("");
  const [counted, setCounted] = useState("");
  const [run, pending] = useAction(countStockAction, { onDone: (r) => r.ok && onClose() });
  const product = products.find((p) => p.id === productId);
  const recorded = productId && wh ? lvl(levels, productId, wh) : 0;
  const c = toInt(counted);
  const diff = Number.isFinite(c) ? c - recorded : 0;
  const value = product ? Math.abs(diff) * product.costCents : 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={t("stock.count.title")}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" type="submit" form="count-form" disabled={pending || !productId || !wh || !Number.isFinite(c)}>
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="ListChecks" size={16} />}
            {t("stock.count.confirm")}
          </button>
        </>
      }
    >
      <form
        id="count-form"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run({ productId, warehouseId: wh, counted: c });
        }}
      >
        <WarehouseSelect label={t("stock.f.warehouse")} name="warehouse" warehouses={warehouses} value={wh} onChange={setWh} />
        <ProductSelect products={products} value={productId} onChange={setProductId} levels={levels} warehouseId={wh || undefined} />
        <label className="field">
          {t("stock.f.counted")}
          <input className="input n" name="counted" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0" required />
        </label>
        {productId && wh ? (
          <div className="infobox n" data-testid="count-preview">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: Number.isFinite(c) ? 8 : 0 }}>
              <div>
                <div className="field-label">{t("stock.count.recorded")}</div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{fmt.int(recorded)}</div>
              </div>
              <div>
                <div className="field-label">{t("stock.count.counted")}</div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{Number.isFinite(c) ? fmt.int(c) : "—"}</div>
              </div>
              <div>
                <div className="field-label">{t("stock.count.difference")}</div>
                <div style={{ fontWeight: 600, fontSize: 16, color: diff < 0 ? "#b42318" : diff > 0 ? "#157347" : "#14171f" }}>
                  {Number.isFinite(c) ? (diff > 0 ? "+" : "") + fmt.int(diff) : "—"}
                </div>
              </div>
            </div>
            {Number.isFinite(c) ? (
              <div style={{ fontSize: 13, color: "#3a4250" }}>
                {diff === 0
                  ? t("stock.count.same")
                  : t(`stock.count.${diff < 0 ? "minus" : "plus"}${money ? "" : "NoMoney"}`, { n: fmt.int(Math.abs(diff)), value: fmt.money(value) })}
              </div>
            ) : null}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

function WarehouseModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [kind, setKind] = useState<WarehouseKind>("BONDED");
  const [run, pending] = useAction(addWarehouse, {
    onDone: (r) => {
      if (r.ok) {
        onClose();
        if (typeof r.id === "string") router.push(`/stock?wh=${r.id}`, { scroll: false });
      }
    },
  });
  const kinds = useMemo(() => ["BONDED", "DUTY_PAID", "IN_TRANSIT"] as WarehouseKind[], []);
  return (
    <Modal
      open
      onClose={onClose}
      title={t("stock.wh.title")}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" type="submit" form="wh-form" disabled={pending}>
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Plus" size={16} />}
            {t("stock.wh.confirm")}
          </button>
        </>
      }
    >
      <form
        id="wh-form"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run({ name: String(f.get("name") ?? ""), kind, city: String(f.get("city") ?? ""), exciseWarehouseNo: String(f.get("exciseNo") ?? "") });
        }}
      >
        <label className="field">
          {t("stock.f.name")}
          <input className="input" name="name" required maxLength={60} placeholder={t("stock.f.namePh")} autoFocus />
        </label>
        <label className="field">
          {t("stock.f.kind")}
          <select className="select" name="kind" value={kind} onChange={(e) => setKind(e.target.value as WarehouseKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`stock.kindLong.${k}`)}
              </option>
            ))}
          </select>
          <span className="field-label">{t(`stock.wh.help.${kind}`)}</span>
        </label>
        <div className="form-grid">
          <label className="field">
            {t("stock.f.city")}
            <input className="input" name="city" maxLength={60} />
          </label>
          {kind !== "DUTY_PAID" ? (
            <label className="field">
              {t("stock.f.exciseNo")}
              <input className="input" name="exciseNo" maxLength={40} placeholder={t("stock.f.exciseNoPh")} />
            </label>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
