"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";
import { useAction, useToast } from "@/components/client";
import { parseMoney } from "@/lib/format";
import { approvePurchase, deletePurchase, lookupFxRate, savePurchase, uploadPurchaseDocument, type ProposalInput } from "./actions";

// ── Drop zone ────────────────────────────────────────────────────────────────

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,.heic,.pdf";

export function DropZone({ autoOpen }: { autoOpen?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [current, setCurrent] = useState<{ name: string; i: number; n: number } | null>(null);
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    if (!autoOpen) return;
    zone.current?.scrollIntoView({ block: "center" });
    setFocus(true);
    try {
      input.current?.click();
    } catch {}
    const tm = setTimeout(() => setFocus(false), 2400);
    return () => clearTimeout(tm);
  }, [autoOpen]);

  async function handle(files: File[]) {
    if (!files.length || current) return;
    let lastId: string | undefined;
    let okCount = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      setCurrent({ name: f.name, i: i + 1, n: files.length });
      const fd = new FormData();
      fd.append("file", f);
      try {
        const r = await uploadPurchaseDocument(fd);
        if (r.ok) {
          okCount++;
          lastId = r.id ?? lastId;
          if (r.message) toast(r.message);
        } else toast(r.error, "error");
      } catch {
        toast(t("purchases.err.uploadFailed", { file: f.name }), "error");
      }
    }
    setCurrent(null);
    if (input.current) input.current.value = "";
    if (okCount) {
      if (files.length > 1) toast(t("purchases.toast.batch", { n: okCount }));
      router.push(lastId ? `/purchases?tab=todo&id=${lastId}` : "/purchases?tab=todo", { scroll: false });
      router.refresh();
    }
  }

  const busy = Boolean(current);
  return (
    <div
      ref={zone}
      role="button"
      tabIndex={0}
      aria-busy={busy}
      onClick={() => !busy && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && (e.preventDefault(), input.current?.click())}
      onDragOver={(e) => {
        e.preventDefault();
        if (!drag) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void handle([...e.dataTransfer.files]);
      }}
      style={{
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "16px 18px", marginBottom: 16, borderRadius: 12,
        border: `1.5px dashed ${drag || focus ? "#7a1f3d" : "#c4cbd6"}`, background: drag ? "#f9eef2" : "#fff", cursor: busy ? "progress" : "pointer",
        boxShadow: focus ? "0 0 0 3px #f1d5df" : "none", transition: "box-shadow .2s, border-color .15s, background .15s",
      }}
    >
      <div style={{ width: 40, height: 40, borderRadius: 10, background: "#f8e9ee", color: "#7a1f3d", display: "grid", placeItems: "center", flex: "none" }}>
        <Icon name={busy ? "HourglassMedium" : "UploadSimple"} size={21} className={busy ? "spin" : undefined} />
      </div>
      <div style={{ flex: 1, minWidth: 220 }} aria-live="polite">
        <div style={{ fontWeight: 600 }}>
          {current ? t("purchases.reading", { file: current.name }) + (current.n > 1 ? ` (${current.i}/${current.n})` : "") : t("purchases.dropTitle")}
        </div>
        <div style={{ fontSize: 13, color: "#5b6474" }}>{t("purchases.dropSub")}</div>
      </div>
      <button type="button" className="btn" style={{ height: 34, padding: "0 12px", fontSize: 13.5 }} disabled={busy} onClick={(e) => (e.stopPropagation(), input.current?.click())}>
        <Icon name="FileArrowUp" size={16} />
        {t("purchases.chooseFiles")}
      </button>
      <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => void handle([...(e.target.files ?? [])])} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

// ── Mock document preview (no file attached) ─────────────────────────────────

export function MockPreview(p: { supplier: string; billTo: { name: string; address: string; vat: string }; number: string; date: string; due: string; lines: { d: string; q: string; src: string }[]; total: string; file: string }) {
  const { t } = useI18n();
  return (
    <>
      <div style={{ background: "#fff", borderRadius: 4, boxShadow: "0 2px 10px rgba(20,23,31,0.10)", padding: "26px 24px", fontSize: 11.5, color: "#3a4250", minHeight: 420, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#14171f" }}>{p.supplier}</div>
          <div style={{ textAlign: "right", fontWeight: 600, letterSpacing: "0.08em", color: "#8a93a3" }}>{t("purchases.mock.invoice")}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div>
            {t("purchases.mock.billTo")}
            <br />
            <b style={{ color: "#14171f" }}>{p.billTo.name}</b>
            <br />
            {p.billTo.address}
            <br />
            {p.billTo.vat}
          </div>
          <div style={{ textAlign: "right" }}>
            {t("purchases.mock.no")} <span style={{ background: "#fff3b0" }}>{p.number || "—"}</span>
            <br />
            {t("purchases.mock.date")} <span style={{ background: "#fff3b0" }}>{p.date}</span>
            <br />
            {t("purchases.mock.due")} {p.due}
          </div>
        </div>
        <div style={{ borderTop: "1px solid #e4e7ec", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {p.lines.map((l, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span>
                <span style={{ background: "#f1d5df" }}>{l.d}</span> × {l.q}
              </span>
              <span className="n" style={{ whiteSpace: "nowrap" }}>{l.src}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "auto", borderTop: "1px solid #e4e7ec", paddingTop: 8, display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#14171f", fontSize: 13 }}>
          <span>{t("purchases.mock.total")}</span>
          <span className="n" style={{ background: "#fff3b0" }}>{p.total}</span>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12.5, color: "#5b6474" }}>
        <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
          <Icon name="FilePdf" size={14} />
          {p.file}
        </span>
        <span>{t("purchases.mock.page")}</span>
      </div>
    </>
  );
}

// ── Booking proposal ─────────────────────────────────────────────────────────

type Treatment = ProposalInput["vatTreatment"];
type Kind = "BONDED" | "DUTY_PAID" | "IN_TRANSIT";

export interface ProposalRefsView {
  baseCurrency: string;
  suppliers: { id: string; name: string; country: string }[];
  products: { id: string; label: string; sku: string; exciseUnit: number }[];
  warehouses: { id: string; name: string; kind: Kind }[];
  accounts: { code: string; name: string }[];
  shipments: { id: string; label: string }[];
}

export interface ProposalData {
  id: string;
  status: "TO_APPROVE" | "BOOKED" | "PAID";
  supplierId: string | null;
  supplierName: string;
  supplierCountry: string | null;
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  fxRate: number;
  fxDate: string | null;
  vatTreatment: Treatment;
  warehouseId: string | null;
  shipmentId: string | null;
  orderRef: string | null;
  ocrConfidence: number | null;
  warning: string | null;
  hasDocument: boolean;
  lines: { description: string; productId: string | null; accountCode: string; qty: number; unitPriceSrcCents: number; vatRateBp: number }[];
  journal: { number: number; date: string; lines: { account: string; name: string; debit: number; credit: number }[] } | null;
  paymentScheduledAt: string | null;
  totalCents: number;
  paidCents: number;
}

type LineState = { description: string; target: string; qty: string; unit: string; vatRateBp: number };

const NEW = "__new";
const TREATMENTS: Treatment[] = ["DOMESTIC", "EU_ACQUISITION", "IMPORT", "EU_SERVICES", "NONE"];
const lbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "#5b6474", minWidth: 0 };
const inp: React.CSSProperties = { height: 36, fontSize: 13.5 };

export function ProposalForm({ data, refs, canEdit, showMoney }: { data: ProposalData; refs: ProposalRefsView; canEdit: boolean; showMoney: boolean }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const ro = !canEdit;
  const [supplierId, setSupplierId] = useState<string>(data.supplierId ?? (data.supplierName ? NEW : ""));
  const [supplierName, setSupplierName] = useState(data.supplierName);
  const [supplierCountry, setSupplierCountry] = useState(data.supplierCountry ?? "");
  const [number, setNumber] = useState(data.number);
  const [issueDate, setIssueDate] = useState(data.issueDate);
  const [dueDate, setDueDate] = useState(data.dueDate ?? "");
  const [currency, setCurrency] = useState(data.currency);
  const [fx, setFx] = useState(data.fxRate ? String(data.fxRate) : "");
  const [treatment, setTreatment] = useState<Treatment>(data.vatTreatment);
  const [warehouseId, setWarehouseId] = useState(data.warehouseId ?? "");
  const [shipmentId, setShipmentId] = useState(data.shipmentId ?? "");
  const [orderRef, setOrderRef] = useState(data.orderRef ?? "");
  const [lines, setLines] = useState<LineState[]>(() =>
    data.lines.map((l) => ({ description: l.description, target: l.productId ? `p:${l.productId}` : `a:${l.accountCode}`, qty: String(l.qty), unit: (l.unitPriceSrcCents / 100).toFixed(2), vatRateBp: l.vatRateBp })),
  );
  const [touched, setTouched] = useState(false);
  const dirty = (fn: () => void) => {
    fn();
    setTouched(true);
  };

  const [runSave, saving] = useAction(savePurchase);
  const [runBook, booking] = useAction(approvePurchase);
  const [runDelete, deleting] = useAction(deletePurchase, { refresh: false });
  const [runFx, fxLoading] = useAction(lookupFxRate, { refresh: false });

  const base = refs.baseCurrency;
  const isBase = currency.toUpperCase() === base;
  const rate = isBase ? 1 : Number(fx.replace(",", ".")) || 0;
  const productMap = useMemo(() => new Map(refs.products.map((p) => [p.id, p])), [refs.products]);
  const wh = refs.warehouses.find((w) => w.id === warehouseId) ?? null;

  const calc = lines.map((l) => {
    const qty = Math.max(0, Math.round(Number(l.qty) || 0));
    const unit = parseMoney(l.unit) ?? 0;
    const src = Math.round(qty * unit);
    const eur = Math.round(src * rate);
    const vat = treatment === "DOMESTIC" ? Math.round((eur * l.vatRateBp) / 10_000) : 0;
    const productId = l.target.startsWith("p:") ? l.target.slice(2) : null;
    return { qty, unit, src, eur, vat, productId };
  });
  const net = calc.reduce((a, c) => a + c.eur, 0);
  const vat = calc.reduce((a, c) => a + c.vat, 0);
  const srcTotal = calc.reduce((a, c, i) => a + c.src + (treatment === "DOMESTIC" ? Math.round((c.src * lines[i]!.vatRateBp) / 10_000) : 0), 0);
  const units = calc.reduce((a, c) => a + (c.productId ? c.qty : 0), 0);
  const hasProducts = calc.some((c) => c.productId);
  const excise = calc.reduce((a, c) => a + (c.productId ? Math.round((productMap.get(c.productId)?.exciseUnit ?? 0) * c.qty) : 0), 0);

  const payload = (): ProposalInput => ({
    id: data.id,
    supplierId: supplierId && supplierId !== NEW ? supplierId : null,
    supplierName: supplierId && supplierId !== NEW ? refs.suppliers.find((s) => s.id === supplierId)?.name ?? "" : supplierName.trim(),
    supplierCountry: supplierCountry.trim().toUpperCase().slice(0, 2) || null,
    number: number.trim(),
    issueDate,
    dueDate: dueDate || null,
    currency: currency.trim().toUpperCase(),
    fxRate: rate,
    vatTreatment: treatment,
    warehouseId: warehouseId || null,
    shipmentId: shipmentId || null,
    orderRef: orderRef.trim() || null,
    lines: lines.map((l, i) => ({
      description: l.description.trim() || "—",
      productId: calc[i]!.productId,
      accountCode: l.target.startsWith("a:") ? l.target.slice(2) : "",
      qty: Math.max(1, calc[i]!.qty),
      unitPriceSrcCents: calc[i]!.unit,
      vatRateBp: l.vatRateBp,
    })),
  });

  const kindText = (k: Kind) => t(`purchases.kind.${k}`);
  const stockText = !hasProducts ? t("purchases.noStock") : wh ? t("purchases.stockTo", { n: fmt.int(units), warehouse: wh.name, kind: kindText(wh.kind) }) : t("purchases.chooseWarehouse");
  const exciseText = !hasProducts
    ? t("purchases.notApplicable")
    : wh?.kind === "DUTY_PAID"
      ? t("purchases.exciseIncluded", { amount: fmt.money(excise) })
      : t("purchases.exciseLater", { now: fmt.money(0), later: fmt.money(excise) });
  const vatText = (() => {
    switch (treatment) {
      case "DOMESTIC":
        return t("purchases.vat.DOMESTIC_amount", { amount: fmt.money(vat) });
      default:
        return t(`purchases.vat.${treatment}`);
    }
  })();

  const conf = data.ocrConfidence;
  const confPill =
    conf === null ? (
      <span className="pill pill-gray"><Icon name="PencilSimple" size={13} />{t("purchases.byHand")}</span>
    ) : (
      <span className={`pill ${conf >= 90 ? "pill-green" : "pill-amber"}`}><Icon name="Sparkle" size={13} />{t("purchases.recognised", { pct: conf })}</span>
    );

  const setLine = (i: number, patch: Partial<LineState>) => dirty(() => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l))));

  async function book(schedule: boolean) {
    const r = await runBook({ ...payload(), schedulePayment: schedule });
    if (r.ok) router.replace("/purchases?tab=todo", { scroll: false });
  }

  const statusPill =
    data.status === "PAID" ? <span className="pill pill-green">{t("purchases.flag.paid")}</span> : data.status === "BOOKED" ? <span className="pill pill-blue">{data.paymentScheduledAt ? t("purchases.flag.scheduled") : t("purchases.flag.booked")}</span> : null;

  return (
    <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>{t("purchases.proposal")}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {statusPill}
          {confPill}
        </div>
      </div>

      {data.warning && data.status === "TO_APPROVE" ? (
        <div style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 9, background: "#fff3dc", color: "#7a4700", fontSize: 13 }}>
          <Icon name="Warning" size={18} />
          <span>{data.warning}</span>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ ...lbl, gridColumn: "span 2" }}>
          {t("purchases.f.supplier")}
          {ro ? (
            <input className="input" style={inp} readOnly value={`${data.supplierName}${data.supplierCountry ? ` · ${data.supplierCountry}` : ""}`} />
          ) : (
            <select className="select" style={inp} value={supplierId} onChange={(e) => dirty(() => setSupplierId(e.target.value))} aria-label={t("purchases.f.supplier")}>
              <option value="">{t("purchases.f.pickSupplier")}</option>
              {refs.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.country}
                </option>
              ))}
              <option value={NEW}>＋ {t("purchases.f.newSupplier")}</option>
            </select>
          )}
        </label>
        {!ro && supplierId === NEW ? (
          <div className="suggest" style={{ gridColumn: "span 2", display: "grid", gridTemplateColumns: "1fr 90px", gap: 8, alignItems: "end", padding: "8px 10px" }}>
            <label style={lbl}>
              {t("purchases.f.newName")}
              <input className="input" style={inp} value={supplierName} onChange={(e) => dirty(() => setSupplierName(e.target.value))} />
            </label>
            <label style={lbl}>
              {t("purchases.f.country")}
              <input className="input" style={inp} value={supplierCountry} maxLength={2} placeholder="NL" onChange={(e) => dirty(() => setSupplierCountry(e.target.value.toUpperCase()))} />
            </label>
            <div style={{ gridColumn: "span 2", fontSize: 12, color: "#7a1f3d" }}>{t("purchases.f.newHint")}</div>
          </div>
        ) : null}
        <label style={lbl}>
          {t("purchases.f.number")}
          <input className="input" style={inp} readOnly={ro} value={number} onChange={(e) => dirty(() => setNumber(e.target.value))} />
        </label>
        <label style={lbl}>
          {t("purchases.f.currency")}
          <input className="input" style={inp} readOnly={ro} value={currency} maxLength={3} onChange={(e) => dirty(() => setCurrency(e.target.value.toUpperCase()))} />
        </label>
        <label style={lbl}>
          {t("purchases.f.date")}
          <input className="input" style={inp} type="date" readOnly={ro} value={issueDate} onChange={(e) => dirty(() => setIssueDate(e.target.value))} />
        </label>
        <label style={lbl}>
          {t("purchases.f.due")}
          <input className="input" style={inp} type="date" readOnly={ro} value={dueDate} onChange={(e) => dirty(() => setDueDate(e.target.value))} />
        </label>
        {!isBase && showMoney ? (
          <label style={{ ...lbl, gridColumn: "span 2" }}>
            {t("purchases.f.fx", { cur: currency || "—", base })}
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input n" style={inp} inputMode="decimal" readOnly={ro} value={fx} placeholder="0.0000" aria-invalid={!rate} onChange={(e) => dirty(() => setFx(e.target.value))} />
              {!ro ? (
                <button
                  type="button"
                  className="btn"
                  disabled={fxLoading}
                  onClick={async () => {
                    const r = await runFx(currency);
                    if (r.ok && r.rate) {
                      dirty(() => setFx(String(r.rate)));
                      toast(t("purchases.toast.fx", { cur: currency, rate: String(r.rate), date: r.date ?? "" }), "info");
                    }
                  }}
                >
                  <Icon name="ArrowsClockwise" size={15} className={fxLoading ? "spin" : undefined} />
                  {t("purchases.f.ecb")}
                </button>
              ) : null}
            </div>
          </label>
        ) : null}
      </div>

      <div>
        <div style={{ fontSize: 12.5, color: "#5b6474", marginBottom: 6 }}>{t("purchases.lines")}</div>
        <div style={{ border: "1px solid #e4e7ec", borderRadius: 9, overflow: "hidden" }}>
          {lines.map((l, i) => {
            const c = calc[i]!;
            const target = l.target;
            const acct = target.startsWith("a:") ? refs.accounts.find((a) => a.code === target.slice(2)) : null;
            const prod = c.productId ? productMap.get(c.productId) : null;
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "6px 12px", padding: "9px 12px", borderBottom: "1px solid #eef0f3", fontSize: 13 }}>
                {ro ? (
                  <>
                    <div style={{ fontWeight: 500 }}>{l.description}</div>
                    <div className="n" style={{ textAlign: "right", fontWeight: 600 }}>{showMoney ? fmt.money(c.eur) : ""}</div>
                    <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, minWidth: 0 }}>
                      <span style={{ color: "#5b6474", whiteSpace: "nowrap" }}>
                        {fmt.int(c.qty)} × {showMoney ? fmt.money(c.unit, { currency }) : "—"}
                      </span>
                      <span className="truncate" style={{ textAlign: "right", color: "#7a1f3d" }}>{prod ? prod.label : acct ? `${acct.code} ${acct.name}` : target.slice(2)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <input className="input" style={{ height: 32, fontSize: 13, fontWeight: 500 }} value={l.description} aria-label={t("purchases.f.description")} onChange={(e) => setLine(i, { description: e.target.value })} />
                    <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                      <span className="n" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{showMoney ? fmt.money(c.eur) : ""}</span>
                      <button type="button" className="btn btn-icon" style={{ width: 28, height: 28 }} aria-label={t("purchases.removeLine")} onClick={() => dirty(() => setLines((ls) => ls.filter((_, k) => k !== i)))}>
                        <Icon name="X" size={14} />
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", gridColumn: "span 2", flexWrap: "wrap" }}>
                      <input className="input n" style={{ height: 30, width: 76, fontSize: 13 }} inputMode="numeric" value={l.qty} aria-label={t("purchases.f.qty")} onChange={(e) => setLine(i, { qty: e.target.value })} />
                      <span style={{ color: "#8a93a3" }}>×</span>
                      {showMoney ? (
                        <>
                          <input className="input n" style={{ height: 30, width: 104, fontSize: 13 }} inputMode="decimal" value={l.unit} aria-label={t("purchases.f.unit", { cur: currency })} onChange={(e) => setLine(i, { unit: e.target.value })} />
                          <span style={{ fontSize: 12, color: "#8a93a3" }}>{currency}</span>
                        </>
                      ) : (
                        <span style={{ color: "#8a93a3" }}>—</span>
                      )}
                      <select className="select" style={{ height: 30, fontSize: 12.5, flex: 1, minWidth: 180, color: "#7a1f3d" }} value={target} aria-label={t("purchases.f.bookTo")} onChange={(e) => setLine(i, { target: e.target.value })}>
                        <optgroup label={t("purchases.f.products")}>
                          {refs.products.map((p) => (
                            <option key={p.id} value={`p:${p.id}`}>{p.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label={t("purchases.f.accounts")}>
                          {refs.accounts.map((a) => (
                            <option key={a.code} value={`a:${a.code}`}>{a.code} {a.name}</option>
                          ))}
                        </optgroup>
                      </select>
                      {treatment === "DOMESTIC" ? (
                        <select className="select" style={{ height: 30, width: 78, fontSize: 12.5 }} value={l.vatRateBp} aria-label={t("purchases.f.vatRate")} onChange={(e) => setLine(i, { vatRateBp: Number(e.target.value) })}>
                          {[...new Set([0, 900, 2100, l.vatRateBp])].sort((a, b) => a - b).map((r) => (
                            <option key={r} value={r}>{fmt.pct(r)}</option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {!lines.length ? <div style={{ padding: "12px", fontSize: 13, color: "#8a93a3" }}>{t("purchases.noLines")}</div> : null}
          {!ro ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ margin: 6, color: "#7a1f3d" }}
              onClick={() => dirty(() => setLines((ls) => [...ls, { description: "", target: "a:4900", qty: "1", unit: "0.00", vatRateBp: 2100 }]))}
            >
              <Icon name="Plus" size={14} />
              {t("purchases.addLine")}
            </button>
          ) : null}
        </div>
      </div>

      {showMoney ? (
        <div className="n" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 14px", fontSize: 13, padding: "10px 12px", borderRadius: 9, background: "#f9fafb" }}>
          <span style={{ color: "#5b6474" }}>{t("purchases.net")}</span>
          <span style={{ textAlign: "right" }}>{fmt.money(net)}</span>
          <span style={{ color: "#5b6474" }}>{t("purchases.vatLabel")}</span>
          <span style={{ textAlign: "right" }}>{fmt.money(vat)}</span>
          <span style={{ fontWeight: 600 }}>{t("purchases.total")}</span>
          <span style={{ textAlign: "right", fontWeight: 600 }}>{fmt.money(net + vat)}</span>
          {!isBase ? (
            <>
              <span style={{ color: "#8a93a3" }}>{t("purchases.onDocument")}</span>
              <span style={{ textAlign: "right", color: "#8a93a3" }}>{fmt.money(srcTotal, { currency: /^[A-Z]{3}$/.test(currency) ? currency : base })}</span>
            </>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: "8px 14px", fontSize: 13, alignItems: "center" }}>
        <span style={{ color: "#5b6474" }}>{t("purchases.vatLabel")}</span>
        {ro ? (
          <span>{vatText}</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <select className="select" style={{ height: 32, fontSize: 13 }} value={treatment} aria-label={t("purchases.vatLabel")} onChange={(e) => dirty(() => setTreatment(e.target.value as Treatment))}>
              {TREATMENTS.map((k) => (
                <option key={k} value={k}>{t(`purchases.treatment.${k}`)}</option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: "#5b6474" }}>{vatText}</span>
          </div>
        )}
        <span style={{ color: "#5b6474" }}>{t("purchases.stock")}</span>
        {ro || !hasProducts ? (
          <span>{stockText}</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <select className="select" style={{ height: 32, fontSize: 13 }} value={warehouseId} aria-label={t("purchases.stock")} onChange={(e) => dirty(() => setWarehouseId(e.target.value))}>
              <option value="">{t("purchases.chooseWarehouse")}</option>
              {refs.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name} · {kindText(w.kind)}</option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: wh ? "#5b6474" : "#9a5b00" }}>{stockText}</span>
          </div>
        )}
        <span style={{ color: "#5b6474" }}>{t("purchases.excise")}</span>
        <span>{exciseText}</span>
        <span style={{ color: "#5b6474" }}>{t("purchases.matched")}</span>
        {ro ? (
          <span>{[data.orderRef, refs.shipments.find((s) => s.id === data.shipmentId)?.label].filter(Boolean).join(" · ") || t("purchases.nothingMatched")}</span>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input className="input" style={{ height: 32, fontSize: 13, flex: "1 1 140px" }} value={orderRef} placeholder={t("purchases.f.orderRef")} aria-label={t("purchases.f.orderRef")} onChange={(e) => dirty(() => setOrderRef(e.target.value))} />
            <select className="select" style={{ height: 32, fontSize: 13, flex: "1 1 140px" }} value={shipmentId} aria-label={t("purchases.f.shipment")} onChange={(e) => dirty(() => setShipmentId(e.target.value))}>
              <option value="">{t("purchases.f.noShipment")}</option>
              {refs.shipments.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {data.journal ? (
        <div>
          <div style={{ fontSize: 12.5, color: "#5b6474", marginBottom: 6 }}>{t("purchases.journal", { n: data.journal.number, date: fmt.dateMed(new Date(`${data.journal.date}T00:00:00Z`)) })}</div>
          <div style={{ border: "1px solid #e4e7ec", borderRadius: 9, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 96px 96px", gap: 10, padding: "7px 12px", fontSize: 12, fontWeight: 500, color: "#5b6474", background: "#f9fafb", borderBottom: "1px solid #e4e7ec" }}>
              <div>{t("purchases.account")}</div>
              <div style={{ textAlign: "right" }}>{t("purchases.debit")}</div>
              <div style={{ textAlign: "right" }}>{t("purchases.credit")}</div>
            </div>
            {data.journal.lines.map((l, i) => (
              <div key={i} className="n" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 96px 96px", gap: 10, padding: "8px 12px", fontSize: 13, borderBottom: "1px solid #f0f2f5" }}>
                <span>{l.account} {l.name}</span>
                <span style={{ textAlign: "right" }}>{l.debit ? fmt.money(l.debit) : ""}</span>
                <span style={{ textAlign: "right" }}>{l.credit ? fmt.money(l.credit) : ""}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4, alignItems: "center" }}>
          <button type="button" className="btn btn-primary" disabled={booking || saving} onClick={() => void book(false)}>
            <Icon name={booking ? "CircleNotch" : "Check"} size={16} className={booking ? "spin" : undefined} />
            {t("purchases.approve")}
          </button>
          <button type="button" className="btn" disabled={booking || saving} onClick={() => void book(true)}>
            {t("purchases.approvePay")}
          </button>
          <button type="button" className="btn btn-ghost" disabled={saving || !touched} onClick={() => void runSave(payload()).then((r) => r.ok && setTouched(false))}>
            <Icon name={saving ? "CircleNotch" : "FloppyDisk"} size={16} className={saving ? "spin" : undefined} />
            {t("purchases.save")}
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn-ghost btn-danger btn-sm"
            disabled={deleting}
            onClick={async () => {
              if (!window.confirm(t("purchases.confirmDelete"))) return;
              const r = await runDelete(data.id);
              if (r.ok) {
                router.replace("/purchases?tab=todo", { scroll: false });
                router.refresh();
              }
            }}
          >
            <Icon name="Trash" size={15} />
            {t("purchases.delete")}
          </button>
        </div>
      ) : data.status !== "TO_APPROVE" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#157347" }}>
          <Icon name="CheckCircle" size={18} />
          {data.paymentScheduledAt ? t("purchases.bookedScheduled", { date: fmt.dateMed(new Date(`${data.paymentScheduledAt}T00:00:00Z`)) }) : t("purchases.bookedNote")}
        </div>
      ) : null}
    </div>
  );
}
