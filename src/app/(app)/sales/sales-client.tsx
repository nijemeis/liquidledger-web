"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ExciseBasis, ProductCategory, TaxRegime, WarehouseKind } from "@prisma/client";
import { Drawer, Modal, useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n/client";
import { parseMoney } from "@/lib/format";
import { calcInvoice, listPriceFor, type CalcLineInput } from "@/lib/domain/sales";
import { determineRegime, STANDARD_RATE } from "@/lib/domain/vat";
import type { RateRow } from "@/lib/domain/excise";
import { creditInvoiceAction, deleteDraft, emailInvoice, registerPayment, saveInvoiceDraft, sendInvoiceNow, sendReminders, type DraftPayload } from "./actions";

// ── Shared types ─────────────────────────────────────────────────────────────

export interface CustomerOpt {
  id: string;
  name: string;
  city: string | null;
  country: string;
  vatNumber: string | null;
  taxRegimeOverride: TaxRegime | null;
  paymentTermsDays: number;
  defaultPriceList: string | null;
  email: string | null;
}

export interface ProductOpt {
  id: string;
  name: string;
  sku: string;
  category: ProductCategory;
  volumeMl: number;
  abvBp: number;
  platoTenths: number | null;
  depositCents: number;
  unitsPerCase: number;
  prices: { list: string; unitPriceCents: number; validFrom: Date }[];
}

export interface EditorData {
  customers: CustomerOpt[];
  adminCountry: string;
  preselect?: string | null;
  products: ProductOpt[];
  warehouses: { id: string; name: string; kind: WarehouseKind }[];
  rates: { country: string; category: ProductCategory; basis: ExciseBasis; rateCents: number; validFrom: Date }[];
  stock: Record<string, Record<string, number>>;
  nextNumber: string;
  topCustomerIds: string[];
  today: string;
  draft: {
    id: string;
    customerId: string;
    issueDate: string;
    dueDate: string;
    warehouseId: string | null;
    reference: string | null;
    lines: { productId: string; qtyUnits: number; unitPriceCents: number }[];
  } | null;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const isoToDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const cents2str = (c: number) => (c / 100).toFixed(2);

function useRegimeText() {
  const { t, fmt } = useI18n();
  return (regime: TaxRegime, country: string) => {
    const nl = country === "NL";
    if (regime === "DOMESTIC") return t(nl ? "sales.note.domesticNL" : "sales.note.domestic", { rate: fmt.pct(STANDARD_RATE[country] ?? 2100) });
    if (regime === "EU_B2B") return t(nl ? "sales.note.euNL" : "sales.note.eu");
    return t("sales.note.export");
  };
}

// ── Header actions ───────────────────────────────────────────────────────────

export function SalesActions({ newHref }: { newHref: string }) {
  const { t } = useI18n();
  const [remind, pending] = useAction(sendReminders);
  return (
    <>
      <button className="btn" disabled={pending} onClick={() => remind()}>
        <Icon name={pending ? "CircleNotch" : "BellRinging"} size={16} className={pending ? "spin" : undefined} />
        {t("sales.sendReminders")}
      </button>
      <Link className="btn btn-primary" href={newHref} scroll={false}>
        <Icon name="Plus" size={16} />
        {t("sales.newInvoice")}
      </Link>
    </>
  );
}

// ── Totals block (editor and detail) ─────────────────────────────────────────

function Totals({ regime, net, excise, deposit, vatByRate, total }: { regime: TaxRegime; net: number; excise: number; deposit: number; vatByRate: [number, number][]; total: number }) {
  const { t, fmt } = useI18n();
  const vatRows: [string, number][] =
    regime === "DOMESTIC"
      ? vatByRate.length
        ? vatByRate.map(([rate, v]) => [t("sales.totals.vatRate", { pct: fmt.pct(rate) }), v])
        : [[t("sales.totals.vat"), 0]]
      : [[regime === "EU_B2B" ? t("sales.totals.reverse") : t("sales.totals.export"), vatByRate.reduce((a, [, v]) => a + v, 0)]];
  return (
    <div className="n" style={{ alignSelf: "flex-end", display: "grid", gridTemplateColumns: "auto 154px", gap: "6px 0", fontSize: 14, minWidth: 300 }}>
      <span style={{ color: "#5b6474" }}>{t("sales.totals.net")}</span>
      <span style={{ textAlign: "right" }}>{fmt.money(net)}</span>
      <span style={{ color: "#5b6474" }}>{t("sales.totals.excise")}</span>
      <span style={{ textAlign: "right" }}>{fmt.money(excise)}</span>
      {deposit ? (
        <>
          <span style={{ color: "#5b6474" }}>{t("sales.totals.deposit")}</span>
          <span style={{ textAlign: "right" }}>{fmt.money(deposit)}</span>
        </>
      ) : null}
      {vatRows.map(([label, v]) => (
        <span key={label} style={{ display: "contents" }}>
          <span style={{ color: "#5b6474" }}>{label}</span>
          <span style={{ textAlign: "right" }}>{fmt.money(v)}</span>
        </span>
      ))}
      <span style={{ fontWeight: 600, fontSize: 17, paddingTop: 8, borderTop: "1px solid #e4e7ec" }}>{t("common.total")}</span>
      <span style={{ textAlign: "right", fontWeight: 600, fontSize: 17, paddingTop: 8, borderTop: "1px solid #e4e7ec" }}>{fmt.money(total)}</span>
    </div>
  );
}

function vatGroups(lines: { vatRateBp: number; vatCents: number }[]): [number, number][] {
  const m = new Map<number, number>();
  for (const l of lines) m.set(l.vatRateBp, (m.get(l.vatRateBp) ?? 0) + l.vatCents);
  return [...m].sort((a, b) => b[0] - a[0]);
}

// ── New / edit invoice drawer ────────────────────────────────────────────────

interface LineState {
  key: number;
  productId: string;
  cases: string;
  price: string;
  priceTouched: boolean;
}

let lineKey = 1;

export function InvoiceEditor({ data, closeHref }: { data: EditorData; closeHref: string }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const regimeText = useRegimeText();
  const draft = data.draft;
  const custById = useMemo(() => new Map(data.customers.map((c) => [c.id, c])), [data.customers]);
  const prodById = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const rates = useMemo(() => new Map<string, RateRow>(data.rates.map((r) => [r.category, r])), [data.rates]);

  const initialCustomer = draft?.customerId ?? (data.preselect && custById.has(data.preselect) ? data.preselect : data.topCustomerIds.find((id) => custById.has(id)) ?? data.customers[0]?.id ?? "");
  const [customerId, setCustomerId] = useState(initialCustomer);
  const customer = custById.get(customerId);
  const regimeInfo = customer ? determineRegime(data.adminCountry, customer) : { regime: "DOMESTIC" as TaxRegime };
  const regime = regimeInfo.regime;

  const [issueDate, setIssueDate] = useState(draft?.issueDate ?? data.today);
  const [dueDate, setDueDate] = useState(draft?.dueDate ?? addDays(data.today, customer?.paymentTermsDays ?? 14));
  const [dueTouched, setDueTouched] = useState(Boolean(draft));
  const defaultWh = (r: TaxRegime) => (r === "DOMESTIC" ? data.warehouses.find((w) => w.kind === "DUTY_PAID") : data.warehouses.find((w) => w.kind === "BONDED"))?.id ?? data.warehouses[0]?.id ?? "";
  const [warehouseId, setWarehouseId] = useState(draft?.warehouseId ?? defaultWh(regime));
  const [whTouched, setWhTouched] = useState(Boolean(draft?.warehouseId));
  const [reference, setReference] = useState(draft?.reference ?? "");

  const priceFor = (productId: string, c: CustomerOpt | undefined) => listPriceFor(prodById.get(productId)?.prices ?? [], c?.defaultPriceList);
  const [lines, setLines] = useState<LineState[]>(() =>
    draft
      ? draft.lines.map((l) => {
          const p = prodById.get(l.productId);
          const cases = p ? l.qtyUnits / p.unitsPerCase : l.qtyUnits;
          return { key: lineKey++, productId: l.productId, cases: String(Math.round(cases * 1000) / 1000), price: cents2str(l.unitPriceCents), priceTouched: true };
        })
      : [{ key: lineKey++, productId: "", cases: "", price: "", priceTouched: false }],
  );

  const pickCustomer = (id: string) => {
    const c = custById.get(id);
    setCustomerId(id);
    if (!c) return;
    const r = determineRegime(data.adminCountry, c).regime;
    if (!dueTouched) setDueDate(addDays(issueDate, c.paymentTermsDays));
    if (!whTouched) setWarehouseId(defaultWh(r));
    setLines((ls) => ls.map((l) => (l.productId && !l.priceTouched ? { ...l, price: cents2str(priceFor(l.productId, c)) } : l)));
  };
  const setLine = (key: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Live totals with the same pure engine the server uses.
  const units = (l: LineState) => {
    const p = prodById.get(l.productId);
    const c = Number(String(l.cases).replace(",", "."));
    return p && Number.isFinite(c) && c > 0 ? Math.round(c * p.unitsPerCase) : 0;
  };
  const valid = lines.filter((l) => prodById.has(l.productId) && units(l) > 0);
  const calc = calcInvoice({
    country: data.adminCountry,
    regime,
    rates,
    lines: valid.map((l) => ({ product: prodById.get(l.productId)! as CalcLineInput["product"], qtyUnits: units(l), unitPriceCents: parseMoney(l.price) ?? 0 })),
  });
  const calcByKey = new Map(valid.map((l, i) => [l.key, calc.lines[i]!]));

  // Stock check against the chosen warehouse (the server checks again on send).
  const needed = new Map<string, number>();
  for (const l of valid) needed.set(l.productId, (needed.get(l.productId) ?? 0) + units(l));
  const have = (pid: string) => data.stock[pid]?.[warehouseId] ?? 0;
  const whName = data.warehouses.find((w) => w.id === warehouseId)?.name ?? "";

  // Customer cards: the 4 most used, with the current pick always visible.
  const top = data.topCustomerIds.filter((id) => custById.has(id));
  for (const c of data.customers) if (top.length < 4 && !top.includes(c.id)) top.push(c.id);
  let cards = top.slice(0, 4);
  if (customerId && !cards.includes(customerId)) cards = [...cards.slice(0, 3), customerId];

  const payload = (): DraftPayload => ({
    invoiceId: draft?.id ?? null,
    customerId,
    issueDate,
    dueDate,
    warehouseId: warehouseId || null,
    reference: reference.trim() || null,
    lines: valid.map((l) => ({ productId: l.productId, qtyUnits: units(l), unitPriceCents: parseMoney(l.price) ?? 0 })),
  });
  const close = () => router.push(closeHref, { scroll: false });
  const [save, saving] = useAction(saveInvoiceDraft, { onDone: (r) => r.ok && close() });
  const [send, sending] = useAction(sendInvoiceNow, { onDone: (r) => r.ok && close() });
  const [del, deleting] = useAction(deleteDraft, { onDone: (r) => r.ok && close() });
  const busy = saving || sending || deleting;
  const ready = Boolean(customer) && valid.length > 0;

  const COLS = "minmax(0,2fr) 70px 90px 100px 110px 30px";
  const inputStyle: React.CSSProperties = { height: 34, padding: "0 8px", fontSize: 13.5 };

  return (
    <Drawer
      open
      onClose={close}
      width={780}
      title={draft ? t("sales.editor.editTitle") : t("sales.editor.newTitle")}
      subtitle={`${draft ? t("sales.editor.draft") : data.nextNumber} · ${fmt.dateMed(isoToDate(issueDate))} · ${t("sales.editor.dueShort", { date: fmt.date(isoToDate(dueDate)) })}`}
      footer={
        <>
          {draft ? (
            <button className="btn btn-ghost btn-danger" style={{ marginRight: "auto" }} disabled={busy} onClick={() => del(draft.id)}>
              <Icon name="Trash" size={16} />
              {t("sales.editor.deleteDraft")}
            </button>
          ) : null}
          <button className="btn" disabled={busy || !ready} onClick={() => save(payload())}>
            {saving ? <Icon name="CircleNotch" size={16} className="spin" /> : null}
            {t("sales.editor.saveDraft")}
          </button>
          <button className="btn btn-primary" disabled={busy || !ready} onClick={() => send(payload())}>
            <Icon name={sending ? "CircleNotch" : "PaperPlaneTilt"} size={16} className={sending ? "spin" : undefined} />
            {t("sales.editor.send")}
          </button>
        </>
      }
    >
      <div>
        <div className="section-label">{t("sales.editor.customer")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8 }}>
          {cards.map((id) => {
            const c = custById.get(id)!;
            const on = id === customerId;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => pickCustomer(id)}
                style={{ textAlign: "left", padding: "9px 12px", borderRadius: 9, border: `1px solid ${on ? "#7a1f3d" : "#e4e7ec"}`, background: on ? "#fcf5f7" : "#fff", boxShadow: on ? "0 0 0 3px #f1d5df" : "none", color: "#14171f", minWidth: 0 }}
              >
                <div className="truncate" style={{ fontWeight: 600, fontSize: 13.5 }}>{c.name}</div>
                <div className="truncate" style={{ fontSize: 12, color: "#5b6474" }}>{[c.city, c.country].filter(Boolean).join(", ")}</div>
              </button>
            );
          })}
        </div>
        {data.customers.length > cards.length ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <Icon name="MagnifyingGlass" size={16} color="#8a93a3" />
            <select className="select" style={{ maxWidth: 360, height: 34, fontSize: 13.5 }} value={customerId} onChange={(e) => e.target.value && pickCustomer(e.target.value)} aria-label={t("sales.editor.allCustomers")}>
              <option value="">{t("sales.editor.allCustomers")}</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {[c.city, c.country].filter(Boolean).join(", ")}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {customer ? (
          <div className="banner banner-brand" style={{ marginTop: 10, padding: "10px 12px" }}>
            <Icon name="Info" size={18} style={{ flex: "none" }} />
            <span>{regimeText(regime, data.adminCountry)}</span>
          </div>
        ) : null}
        {"warning" in regimeInfo && regimeInfo.warning === "eu_b2c" ? (
          <div className="banner banner-warn" style={{ marginTop: 8 }}>
            <Icon name="Warning" size={17} style={{ flex: "none", marginTop: 1 }} />
            <span>{t("sales.note.euB2c", { name: customer?.name ?? "" })}</span>
          </div>
        ) : null}
      </div>

      <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <label className="field">
          <span className="field-label">{t("sales.editor.issueDate")}</span>
          <input
            type="date"
            className="input n"
            value={issueDate}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              setIssueDate(v);
              if (!dueTouched) setDueDate(addDays(v, customer?.paymentTermsDays ?? 14));
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("sales.editor.dueDate", { n: customer?.paymentTermsDays ?? 14 })}</span>
          <input
            type="date"
            className="input n"
            value={dueDate}
            min={issueDate}
            onChange={(e) => {
              if (!e.target.value) return;
              setDueDate(e.target.value);
              setDueTouched(true);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("sales.editor.warehouse")}</span>
          <select
            className="select"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setWhTouched(true);
            }}
          >
            {data.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · {t(`sales.whKind.${w.kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t("sales.editor.reference")}</span>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("sales.editor.referencePh")} maxLength={120} />
        </label>
      </div>

      <div>
        <div className="section-label">{t("sales.editor.lines")}</div>
        <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 620 }}>
              <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 10, padding: "8px 12px" }}>
                <div>{t("sales.editor.product")}</div>
                <div>{t("sales.editor.cases")}</div>
                <div>{t("sales.editor.perBottle")}</div>
                <div className="right">{t("sales.totals.net")}</div>
                <div className="right">{t("sales.totals.excise")}</div>
                <div />
              </div>
              {lines.map((l) => {
                const p = prodById.get(l.productId);
                const c = calcByKey.get(l.key);
                const short = p ? needed.get(p.id)! > have(p.id) : false;
                return (
                  <div key={l.key} style={{ display: "grid", gridTemplateColumns: COLS, gap: 10, padding: "10px 12px", alignItems: "start", borderBottom: "1px solid #eef0f3" }}>
                    <div style={{ minWidth: 0 }}>
                      <select
                        className="select"
                        style={inputStyle}
                        value={l.productId}
                        aria-label={t("sales.editor.product")}
                        onChange={(e) => {
                          const pid = e.target.value;
                          setLine(l.key, { productId: pid, price: cents2str(priceFor(pid, customer)), priceTouched: false, cases: l.cases || "1" });
                        }}
                      >
                        <option value="" disabled>{t("sales.editor.chooseProduct")}</option>
                        {data.products.map((x) => (
                          <option key={x.id} value={x.id}>{x.name}</option>
                        ))}
                      </select>
                      {p ? (
                        <div style={{ fontSize: 12, color: "#5b6474", marginTop: 4 }}>
                          {p.sku} · {fmt.num(p.volumeMl / 1000, p.volumeMl % 10 ? 3 : p.volumeMl % 100 ? 2 : 1)} L · {fmt.pct(p.abvBp)} · {t("sales.editor.caseOf", { n: p.unitsPerCase })}
                          <span style={{ color: short ? "#b42318" : "#8a93a3", fontWeight: short ? 500 : 400 }}>
                            {" · "}
                            {t("sales.editor.inStock", { n: fmt.int(have(p.id)), warehouse: whName })}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <input className="input n" style={inputStyle} type="number" min="0" step="any" inputMode="decimal" value={l.cases} onChange={(e) => setLine(l.key, { cases: e.target.value })} aria-label={t("sales.editor.cases")} />
                    <input className="input n" style={inputStyle} type="text" inputMode="decimal" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value, priceTouched: true })} aria-label={t("sales.editor.perBottle")} aria-invalid={l.price !== "" && parseMoney(l.price) === null} />
                    <div className="n" style={{ textAlign: "right", paddingTop: 8, fontSize: 13.5 }}>{c ? fmt.money(c.netCents) : "—"}</div>
                    <div style={{ textAlign: "right", paddingTop: 8 }}>
                      <div className="n" style={{ fontSize: 13.5 }}>{c ? fmt.money(c.exciseCents) : "—"}</div>
                      {c ? <div style={{ fontSize: 11, color: "#5b6474", lineHeight: 1.3 }}>{regime === "DOMESTIC" ? c.exciseFormula : t("sales.editor.notCharged")}</div> : null}
                    </div>
                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label={t("sales.editor.removeLine")}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      style={{ width: 30, height: 34, color: "#8a93a3" }}
                    >
                      <Icon name="Trash" size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, { key: lineKey++, productId: "", cases: "", price: "", priceTouched: false }])}
            className="add-line"
            style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "10px 12px", border: 0, background: "#fff", fontSize: 13.5, fontWeight: 500, color: "#7a1f3d", textAlign: "left" }}
          >
            <Icon name="Plus" size={15} />
            {t("sales.editor.addLine")}
          </button>
        </div>
        {[...needed].some(([pid, n]) => n > have(pid)) ? (
          <div className="banner banner-warn" style={{ marginTop: 8 }}>
            <Icon name="Warning" size={17} style={{ flex: "none", marginTop: 1 }} />
            <span>{t("sales.editor.stockShort", { warehouse: whName })}</span>
          </div>
        ) : null}
      </div>

      <Totals regime={regime} net={calc.netCents} excise={calc.exciseCents} deposit={calc.depositCents} vatByRate={vatGroups(calc.lines)} total={calc.totalCents} />
      <style>{`.add-line:hover{background:#fcf5f7!important}`}</style>
    </Drawer>
  );
}

// ── Invoice detail drawer ────────────────────────────────────────────────────

export interface DetailData {
  customer: CustomerOpt;
  invoice: {
    id: string;
    number: string;
    status: "DRAFT" | "OPEN" | "PAID" | "CREDITED";
    creditNote: boolean;
    overdueDays: number;
    taxRegime: TaxRegime;
    issueDate: Date;
    dueDate: Date;
    netCents: number;
    exciseCents: number;
    depositCents: number;
    vatCents: number;
    totalCents: number;
    paidCents: number;
    paidAt: Date | null;
    sentAt: Date | null;
    lastReminderAt: Date | null;
    reference: string | null;
    notes: string | null;
    warehouse: string | null;
  };
  lines: {
    id: string;
    description: string;
    sku: string | null;
    unitsPerCase: number;
    qtyUnits: number;
    unitPriceCents: number;
    netCents: number;
    exciseCents: number;
    exciseFormula: string | null;
    depositCents: number;
    vatRateBp: number;
    vatCents: number;
  }[];
  payments: { id: string; date: Date; amountCents: number; viaBank: boolean }[];
  customs: { id: string; type: string; status: string; reference: string | null }[];
  banks: { id: string; name: string; iban: string | null }[];
  related: { id: string; number: string } | null;
}

export function InvoiceDetail({ data, canEdit, fin, closeHref, relatedHref }: { data: DetailData; canEdit: boolean; fin: boolean; closeHref: string; relatedHref: string | null }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const inv = data.invoice;
  const c = data.customer;
  const [modal, setModal] = useState<null | "pay" | "credit">(null);
  const [mail, mailing] = useAction(emailInvoice);
  const close = () => router.push(closeHref, { scroll: false });
  const outstanding = inv.totalCents - inv.paidCents;

  const pill = inv.creditNote
    ? { tone: "gray", label: t("sales.status.creditNote") }
    : inv.status === "OPEN" && inv.overdueDays > 0
      ? { tone: "red", label: t("sales.status.overdueD", { n: inv.overdueDays }) }
      : { tone: inv.status === "OPEN" ? "blue" : inv.status === "PAID" ? "green" : "gray", label: t(`sales.status.${inv.status.toLowerCase()}`) };

  const qty = (l: DetailData["lines"][number]) => {
    const n = Math.abs(l.qtyUnits);
    const sign = l.qtyUnits < 0 ? "−" : "";
    if (l.unitsPerCase <= 1) return { main: `${sign}${fmt.int(n)} ${t("sales.detail.btl")}`, sub: "" };
    const cs = Math.floor(n / l.unitsPerCase);
    const rest = n % l.unitsPerCase;
    const main = cs ? `${sign}${fmt.int(cs)} ${t("sales.detail.cs")}${rest ? ` + ${rest} ${t("sales.detail.btl")}` : ""}` : `${sign}${rest} ${t("sales.detail.btl")}`;
    return { main, sub: `${sign}${fmt.int(n)} ${t("sales.detail.btl")}` };
  };
  const COLS = fin ? "minmax(0,2fr) 100px 80px 100px 100px 90px" : "minmax(0,2fr) 120px";
  const regimeLabel = t(`sales.regime.${inv.taxRegime}`);

  return (
    <Drawer
      open
      onClose={close}
      width={780}
      header={
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div className="drawer-title n">{inv.creditNote ? t("sales.detail.creditNoteTitle", { number: inv.number }) : t("sales.detail.title", { number: inv.number })}</div>
            <span className={`pill pill-${pill.tone}`}>{pill.label}</span>
          </div>
          <div className="drawer-sub n">
            {c.name} · {fmt.dateMed(inv.issueDate)} · {t("sales.editor.dueShort", { date: fmt.date(inv.dueDate) })}
          </div>
        </div>
      }
      footer={
        <>
          <a className="btn" href={`/print/sales/${inv.id}?auto=1`} target="_blank" rel="noopener" style={{ marginRight: "auto" }}>
            <Icon name="Printer" size={16} />
            {t("sales.detail.print")}
          </a>
          {canEdit ? (
            <>
              <button className="btn" disabled={mailing || !c.email} title={c.email ? c.email : t("sales.detail.noEmailHint")} onClick={() => mail(inv.id)}>
                <Icon name={mailing ? "CircleNotch" : "EnvelopeSimple"} size={16} className={mailing ? "spin" : undefined} />
                {t("sales.detail.email")}
              </button>
              {!inv.creditNote && (inv.status === "OPEN" || inv.status === "PAID") ? (
                <button className="btn btn-danger" onClick={() => setModal("credit")}>
                  <Icon name="ArrowCounterClockwise" size={16} />
                  {t("sales.detail.credit")}
                </button>
              ) : null}
              {inv.status === "OPEN" && fin ? (
                <button className="btn btn-primary" onClick={() => setModal("pay")}>
                  <Icon name="HandCoins" size={16} />
                  {t("sales.detail.registerPayment")}
                </button>
              ) : null}
            </>
          ) : null}
        </>
      }
    >
      <dl className="dl" style={{ margin: 0 }}>
        <div>
          <dt>{t("sales.editor.customer")}</dt>
          <dd>{c.name}</dd>
          <div className="cell-sub">{[c.city, c.country].filter(Boolean).join(", ")}{c.vatNumber ? ` · ${c.vatNumber}` : ""}</div>
        </div>
        <div>
          <dt>{t("sales.detail.regime")}</dt>
          <dd>{regimeLabel}</dd>
        </div>
        <div>
          <dt>{t("sales.editor.warehouse")}</dt>
          <dd>{inv.warehouse ?? "—"}</dd>
        </div>
        {inv.reference ? (
          <div>
            <dt>{inv.creditNote ? t("sales.detail.creditFor") : t("sales.editor.reference")}</dt>
            <dd>{inv.reference}</dd>
          </div>
        ) : null}
        {inv.lastReminderAt ? (
          <div>
            <dt>{t("sales.detail.lastReminder")}</dt>
            <dd>{fmt.dateMed(inv.lastReminderAt)}</dd>
          </div>
        ) : null}
      </dl>

      {data.related && relatedHref ? (
        <div className="banner banner-info">
          <Icon name="ArrowsLeftRight" size={17} style={{ flex: "none", marginTop: 1 }} />
          <span>
            {inv.creditNote ? t("sales.detail.isCreditFor") : t("sales.detail.creditedBy")}{" "}
            <Link href={relatedHref} scroll={false} style={{ fontWeight: 600 }}>{data.related.number}</Link>
          </span>
        </div>
      ) : null}
      {!inv.creditNote && inv.status !== "CREDITED" ? (
        <div className="banner banner-brand" style={{ padding: "10px 12px" }}>
          <Icon name="Info" size={18} style={{ flex: "none" }} />
          <span>{t(`sales.detail.regimeNote.${inv.taxRegime}`)}</span>
        </div>
      ) : null}

      <div>
        <div className="section-label">{t("sales.editor.lines")}</div>
        <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: fin ? 640 : 0 }}>
              <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 10, padding: "8px 12px" }}>
                <div>{t("sales.editor.product")}</div>
                <div className={fin ? "right" : undefined}>{t("sales.detail.qty")}</div>
                {fin ? (
                  <>
                    <div className="right">{t("sales.editor.perBottle")}</div>
                    <div className="right">{t("sales.totals.net")}</div>
                    <div className="right">{t("sales.totals.excise")}</div>
                    <div className="right">{t("sales.detail.vat")}</div>
                  </>
                ) : null}
              </div>
              {data.lines.map((l) => {
                const q = qty(l);
                return (
                  <div key={l.id} className="n" style={{ display: "grid", gridTemplateColumns: COLS, gap: 10, padding: "10px 12px", borderBottom: "1px solid #eef0f3", fontSize: 13.5, alignItems: "start" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{l.description}</div>
                      {l.sku ? <div className="cell-sub">{l.sku}{l.depositCents ? ` · ${t("sales.detail.depositLine", { amount: fmt.money(l.depositCents) })}` : ""}</div> : null}
                    </div>
                    <div className={fin ? "right" : undefined}>
                      <div>{q.main}</div>
                      {q.sub ? <div className="cell-sub">{q.sub}</div> : null}
                    </div>
                    {fin ? (
                      <>
                        <div className="right">{fmt.money(l.unitPriceCents)}</div>
                        <div className="right">{fmt.money(l.netCents)}</div>
                        <div className="right">
                          <div>{fmt.money(l.exciseCents)}</div>
                          {l.exciseCents && l.exciseFormula ? <div style={{ fontSize: 11, color: "#5b6474", lineHeight: 1.3 }}>{l.exciseFormula}</div> : null}
                        </div>
                        <div className="right">
                          <div>{fmt.money(l.vatCents)}</div>
                          <div className="cell-sub">{fmt.pct(l.vatRateBp)}</div>
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {fin ? (
        <>
          <Totals regime={inv.taxRegime} net={inv.netCents} excise={inv.exciseCents} deposit={inv.depositCents} vatByRate={vatGroups(data.lines)} total={inv.totalCents} />
          {!inv.creditNote ? (
            <div>
              <div className="section-label">{t("sales.detail.payments")}</div>
              <div className="infobox" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5 }}>
                {data.payments.length ? (
                  data.payments.map((p) => (
                    <div key={p.id} className="n" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <Icon name="CheckCircle" size={15} color="#157347" />
                        {fmt.dateMed(p.date)} · {p.viaBank ? t("sales.detail.viaBank") : t("sales.detail.manual")}
                      </span>
                      <span style={{ fontWeight: 500 }}>{fmt.money(p.amountCents)}</span>
                    </div>
                  ))
                ) : (
                  <span className="muted">{t("sales.detail.noPayments")}</span>
                )}
                <div className="n" style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid #e4e7ec", paddingTop: 6, fontWeight: 600 }}>
                  <span>{inv.status === "CREDITED" ? t("sales.detail.paid") : t("sales.detail.outstanding")}</span>
                  <span style={{ color: inv.status === "OPEN" && inv.overdueDays ? "#b42318" : undefined }}>{fmt.money(inv.status === "CREDITED" ? inv.paidCents : Math.max(0, outstanding))}</span>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {data.customs.length ? (
        <div>
          <div className="section-label">{t("sales.detail.customs")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {data.customs.map((d) => (
              <span key={d.id} className={`pill pill-${d.status === "REJECTED" ? "gray" : d.status === "DRAFT" ? "amber" : "blue"}`}>
                {t(`sales.customs.${d.type}`)} · {t(`sales.customsStatus.${d.status}`)}
                {d.reference ? ` · ${d.reference}` : ""}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {inv.notes ? (
        <div>
          <div className="section-label">{t("sales.detail.notes")}</div>
          <div style={{ fontSize: 13.5 }}>{inv.notes}</div>
        </div>
      ) : null}

      {modal === "pay" ? <PaymentModal invoiceId={inv.id} number={inv.number} outstanding={outstanding} banks={data.banks} onClose={() => setModal(null)} /> : null}
      {modal === "credit" ? <CreditModal data={data} onClose={() => setModal(null)} /> : null}
    </Drawer>
  );
}

function PaymentModal({ invoiceId, number, outstanding, banks, onClose }: { invoiceId: string; number: string; outstanding: number; banks: DetailData["banks"]; onClose: () => void }) {
  const { t } = useI18n();
  const n = new Date();
  const [amount, setAmount] = useState(cents2str(outstanding));
  const [date, setDate] = useState(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())).toISOString().slice(0, 10));
  const [bank, setBank] = useState(banks[0]?.id ?? "");
  const [run, pending] = useAction(registerPayment, { onDone: (r) => r.ok && onClose() });
  return (
    <Modal open onClose={onClose} title={t("sales.pay.title", { number })}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run({ invoiceId, amount, date, bankAccountId: bank });
        }}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div className="form-grid">
          <label className="field">
            <span className="field-label">{t("sales.pay.amount")}</span>
            <input className="input n" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
          </label>
          <label className="field">
            <span className="field-label">{t("sales.pay.date")}</span>
            <input className="input n" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
        </div>
        <label className="field">
          <span className="field-label">{t("sales.pay.bank")}</span>
          <select className="select" value={bank} onChange={(e) => setBank(e.target.value)} required>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}{b.iban ? ` · ${b.iban}` : ""}
              </option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 12.5, color: "#5b6474" }}>{t("sales.pay.hint")}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={pending || !bank}>
            <Icon name={pending ? "CircleNotch" : "Check"} size={16} className={pending ? "spin" : undefined} />
            {t("sales.pay.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreditModal({ data, onClose }: { data: DetailData; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [run, pending] = useAction(creditInvoiceAction, {
    onDone: (r) => {
      if (!r.ok) return;
      onClose();
      if (typeof r.creditNoteId === "string") {
        const u = new URL(window.location.href);
        u.searchParams.set("id", r.creditNoteId);
        router.push(u.pathname + u.search, { scroll: false });
      }
    },
  });
  const inv = data.invoice;
  const bottles = data.lines.reduce((a, l) => a + l.qtyUnits, 0);
  return (
    <Modal
      open
      onClose={onClose}
      title={t("sales.credit.title", { number: inv.number })}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={pending} onClick={() => run({ invoiceId: inv.id, reason })}>
            <Icon name={pending ? "CircleNotch" : "ArrowCounterClockwise"} size={16} className={pending ? "spin" : undefined} />
            {t("sales.credit.submit")}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, color: "#3a4250" }}>
        {t("sales.credit.explain", { amount: fmt.money(inv.totalCents), n: fmt.int(bottles), warehouse: inv.warehouse ?? "—" })}
      </div>
      {data.customs.some((d) => d.status === "DRAFT") ? <div style={{ fontSize: 13.5, color: "#3a4250" }}>{t("sales.credit.customs")}</div> : null}
      {inv.paidCents ? <div className="banner banner-warn">{t("sales.credit.paid", { amount: fmt.money(inv.paidCents), name: data.customer.name })}</div> : null}
      <label className="field">
        <span className="field-label">{t("sales.credit.reason")}</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("sales.credit.reasonPh")} maxLength={300} />
      </label>
    </Modal>
  );
}
