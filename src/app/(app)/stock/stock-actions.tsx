"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { WarehouseKind } from "@prisma/client";
import { Modal, useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n/client";
import { addOpeningStock, addWarehouse, countStockAction, moveStock, removeWarehouse, sampleStock, updateWarehouse } from "./actions";

export interface StockProduct {
  id: string;
  name: string;
  sku: string;
  ean?: string | null;
  costCents: number; // 0 when the viewer doesn't see money
  excisePerUnit: number; // fractional cents
}
export interface StockWarehouse {
  id: string;
  name: string;
  kind: WarehouseKind;
  city?: string | null;
  exciseWarehouseNo?: string | null;
}

export interface OpeningOptions {
  accounts: { code: string; name: string; balanceCents: number }[];
  /** Account holding imported stock value, if one was found. */
  suggested: string | null;
}
type Props = { products: StockProduct[]; warehouses: StockWarehouse[]; levels: Record<string, Record<string, number>>; selectedId: string | null; money: boolean; opening?: OpeningOptions };
type Open = null | "move" | "sample" | "count" | "warehouse" | "edit" | "opening";

export function StockActions(props: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const current = props.warehouses.find((w) => w.id === props.selectedId);
  return (
    <>
      <button className="btn" onClick={() => setOpen("warehouse")}>
        <Icon name="Warehouse" size={16} />
        {t("stock.actions.addWarehouse")}
      </button>
      {current ? (
        <button className="btn" onClick={() => setOpen("edit")}>
          <Icon name="PencilSimple" size={16} />
          {t("stock.actions.editWarehouse")}
        </button>
      ) : null}
      {props.money && props.opening ? (
        <button className="btn" onClick={() => setOpen("opening")} disabled={!props.warehouses.length || !props.products.length}>
          <Icon name="Package" size={16} />
          {t("stock.actions.opening")}
        </button>
      ) : null}
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
      {open === "edit" && current ? <WarehouseModal onClose={close} edit={current} /> : null}
      {open === "opening" && props.opening ? <OpeningStockModal {...props} opening={props.opening} onClose={close} /> : null}
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

/** Add a warehouse, or edit/remove one (`edit`). */
function WarehouseModal({ onClose, edit }: { onClose: () => void; edit?: StockWarehouse }) {
  const { t } = useI18n();
  const router = useRouter();
  const [kind, setKind] = useState<WarehouseKind>(edit?.kind ?? "BONDED");
  const [run, pending] = useAction(addWarehouse, {
    onDone: (r) => {
      if (r.ok) {
        onClose();
        if (typeof r.id === "string") router.push(`/stock?wh=${r.id}`, { scroll: false });
      }
    },
  });
  const [save, saving] = useAction(updateWarehouse, { onDone: (r) => r.ok && onClose() });
  const [remove, removing] = useAction(removeWarehouse, {
    onDone: (r) => {
      if (r.ok) {
        onClose();
        router.push("/stock", { scroll: false });
      }
    },
  });
  const kinds = useMemo(() => ["BONDED", "DUTY_PAID", "IN_TRANSIT"] as WarehouseKind[], []);
  return (
    <Modal
      open
      onClose={onClose}
      title={edit ? t("stock.edit.title") : t("stock.wh.title")}
      footer={
        <>
          {edit ? (
            <button className="btn btn-ghost btn-danger" type="button" style={{ marginRight: "auto" }} disabled={removing} onClick={() => remove(edit.id)}>
              <Icon name="Trash" size={16} />
              {t("stock.edit.remove")}
            </button>
          ) : null}
          <button className="btn" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" type="submit" form="wh-form" disabled={pending || saving}>
            {pending || saving ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name={edit ? "FloppyDisk" : "Plus"} size={16} />}
            {edit ? t("stock.edit.save") : t("stock.wh.confirm")}
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
          const v = { name: String(f.get("name") ?? ""), kind, city: String(f.get("city") ?? ""), exciseWarehouseNo: String(f.get("exciseNo") ?? "") };
          if (edit) save({ ...v, id: edit.id });
          else run(v);
        }}
      >
        <label className="field">
          {t("stock.f.name")}
          <input className="input" name="name" required maxLength={60} placeholder={t("stock.f.namePh")} defaultValue={edit?.name} autoFocus />
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
            <input className="input" name="city" maxLength={60} defaultValue={edit?.city ?? ""} />
          </label>
          {kind !== "DUTY_PAID" ? (
            <label className="field">
              {t("stock.f.exciseNo")}
              <input className="input" name="exciseNo" maxLength={40} placeholder={t("stock.f.exciseNoPh")} defaultValue={edit?.exciseWarehouseNo ?? ""} />
            </label>
          ) : null}
        </div>
        {edit ? <div className="field-label">{t("stock.edit.hint")}</div> : null}
      </form>
    </Modal>
  );
}

// ── Opening stock ───────────────────────────────────────────────────────────

type OpeningRow = { key: number; productId: string; qty: string; cost: string };
const centsToInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/** "SKU/EAN/name ⇥ qty ⇥ cost" lines pasted from a spreadsheet → rows (and the lines that matched nothing). */
function parsePasted(text: string, products: StockProduct[]) {
  const norm = (x: string) => x.trim().toLowerCase();
  const rows: Omit<OpeningRow, "key">[] = [];
  const unmatched: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(/\t|;/).map((c) => c.trim());
    const [id = "", qty = "", cost = ""] = cells.length >= 2 ? cells : line.split(",").map((c) => c.trim());
    const p = products.find((x) => norm(x.sku) === norm(id)) ?? products.find((x) => x.ean && norm(x.ean) === norm(id)) ?? products.find((x) => norm(x.name) === norm(id));
    const n = qty.replace(/[.\s]/g, "");
    if (!p || !/^\d+$/.test(n)) {
      if (!/^(sku|artikel|product|ean|code)/i.test(id)) unmatched.push(line.trim());
      continue;
    }
    rows.push({ productId: p.id, qty: n, cost: cost || centsToInput(p.costCents) });
  }
  return { rows, unmatched };
}

function OpeningStockModal({ products, warehouses, selectedId, opening, onClose }: Props & { opening: OpeningOptions; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const today = new Date().toISOString().slice(0, 10);
  const [warehouseId, setWarehouseId] = useState(selectedId ?? warehouses[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<"equity" | "account" | "none">(opening.suggested ? "account" : "equity");
  const [account, setAccount] = useState(opening.suggested ?? opening.accounts[0]?.code ?? "");
  const [rows, setRows] = useState<OpeningRow[]>([{ key: 0, productId: "", qty: "", cost: "" }]);
  const [paste, setPaste] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [run, pending] = useAction(addOpeningStock, { onDone: (r) => r.ok && onClose() });
  const wh = warehouses.find((w) => w.id === warehouseId);
  const byId = new Map(products.map((p) => [p.id, p]));
  const set = (key: number, patch: Partial<OpeningRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.productId && Number(r.qty) > 0);
  const cents = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100) || 0;
  const value = filled.reduce((a, r) => a + Number(r.qty) * cents(r.cost), 0);
  const excise = wh?.kind === "DUTY_PAID" ? filled.reduce((a, r) => a + Math.round(Number(r.qty) * (byId.get(r.productId)?.excisePerUnit ?? 0)), 0) : 0;
  const dup = new Set(filled.map((r) => r.productId)).size !== filled.length;
  let nextKey = rows.reduce((a, r) => Math.max(a, r.key), 0) + 1;

  return (
    <Modal
      open
      onClose={onClose}
      width={760}
      title={t("stock.opening.title")}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={pending || !filled.length || dup || !warehouseId || (mode === "account" && !account)}
            onClick={() => run({ warehouseId, date, mode, account: mode === "account" ? account : "", lines: filled.map((r) => ({ productId: r.productId, qty: Number(r.qty), unitCost: r.cost || "0" })) })}
          >
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Package" size={16} />}
            {t("stock.opening.submit", { n: fmt.int(filled.reduce((a, r) => a + Number(r.qty), 0)) })}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t("stock.opening.text")}</p>
      <div className="form-grid">
        <label className="field">
          {t("stock.f.warehouse")}
          <select className="select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · {t(`stock.kind.${w.kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t("stock.opening.date")}
          <input className="input n" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <div>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div className="section-label" style={{ margin: 0 }}>{t("stock.opening.products")}</div>
          <button type="button" className="btn btn-ghost" onClick={() => setPaste(paste === null ? "" : null)}>
            <Icon name="Copy" size={15} />
            {t("stock.opening.paste")}
          </button>
        </div>
        {paste !== null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            <textarea className="textarea n" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"WN-1021\t120\t6,35\nSP-3012\t48\t14,20"} />
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const r = parsePasted(paste, products);
                  const keep = rows.filter((x) => x.productId);
                  setRows([...keep, ...r.rows.map((x) => ({ ...x, key: nextKey++ }))]);
                  setUnmatched(r.unmatched);
                  setPaste(null);
                }}
              >
                {t("stock.opening.pasteApply")}
              </button>
              <span className="field-label">{t("stock.opening.pasteHint")}</span>
            </div>
          </div>
        ) : null}
        {unmatched.length ? (
          <div className="banner banner-warn" style={{ marginBottom: 8, fontSize: 13 }}>
            <Icon name="Warning" size={16} />
            <div>
              {t("stock.opening.unmatched", { n: unmatched.length })}
              <div className="n" style={{ fontSize: 12, marginTop: 4 }}>{unmatched.slice(0, 5).join(" · ")}{unmatched.length > 5 ? " …" : ""}</div>
            </div>
          </div>
        ) : null}
        <div style={{ display: "grid", gap: 6 }}>
          {rows.map((r) => {
            const p = byId.get(r.productId);
            return (
              <div key={r.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 90px 110px 34px", gap: 6, alignItems: "center" }}>
                <select
                  className="select"
                  aria-label={t("stock.f.product")}
                  value={r.productId}
                  onChange={(e) => {
                    const np = byId.get(e.target.value);
                    set(r.key, { productId: e.target.value, cost: r.cost || (np ? centsToInput(np.costCents) : "") });
                  }}
                >
                  <option value="">{t("stock.f.pick")}</option>
                  {products.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.sku} · {x.name}
                    </option>
                  ))}
                </select>
                <input className="input n" inputMode="numeric" aria-label={t("stock.opening.qty")} placeholder={t("stock.opening.qty")} value={r.qty} onChange={(e) => set(r.key, { qty: e.target.value.replace(/\D/g, "") })} />
                <input className="input n" inputMode="decimal" aria-label={t("stock.opening.cost")} placeholder={p ? centsToInput(p.costCents) : t("stock.opening.cost")} value={r.cost} onChange={(e) => set(r.key, { cost: e.target.value })} />
                <button type="button" className="btn btn-ghost" aria-label={t("stock.opening.removeLine")} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} style={{ padding: "0 8px" }}>
                  <Icon name="Trash" size={16} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 6, alignItems: "center" }}>
          <button type="button" className="btn btn-ghost" onClick={() => setRows((rs) => [...rs, { key: nextKey++, productId: "", qty: "", cost: "" }])}>
            <Icon name="Plus" size={15} />
            {t("stock.opening.addLine")}
          </button>
          <span className="n" style={{ fontSize: 13 }}>
            {t("stock.opening.total", { value: fmt.money(value) })}
            {excise ? ` · ${t("stock.opening.excise", { amount: fmt.money(excise) })}` : ""}
          </span>
        </div>
        {dup ? <div style={{ color: "#b42318", fontSize: 12.5 }}>{t("stock.opening.err.duplicate")}</div> : null}
      </div>

      <label className="field">
        {t("stock.opening.counter")}
        <select className="select" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="equity">{t("stock.opening.modeEquity")}</option>
          <option value="account" disabled={!opening.accounts.length}>{t("stock.opening.modeAccount")}</option>
          <option value="none">{t("stock.opening.modeNone")}</option>
        </select>
        <span className="field-label">{t(`stock.opening.help.${mode}`)}</span>
      </label>
      {mode === "account" ? (
        <label className="field">
          {t("stock.opening.account")}
          <select className="select" value={account} onChange={(e) => setAccount(e.target.value)}>
            {opening.accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name} ({fmt.money(a.balanceCents)})
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </Modal>
  );
}
