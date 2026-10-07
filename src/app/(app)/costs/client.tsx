"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { Icon, type IconName } from "@/components/icon";
import { Modal, useAction, useToast } from "@/components/client";
import { CATEGORIES, CATEGORY_BY_KEY, CATEGORY_GROUPS, categoryLabel, matchesCategory } from "@/lib/domain/categories";
import { MILEAGE_RATE_CENTS, receiptLines, VAT_OVERRIDES } from "@/lib/domain/receipts";
import { parseMoney } from "@/lib/format";
import { bookAllSuggested, bookReceiptAction, createReceipt, deleteReceipt, editReceiptDetails, logMileage, payOutClaims, updateReceipt } from "./actions";

type PaidBy = "CARD" | "BANK" | "OWN";
type Override = keyof typeof VAT_OVERRIDES;

const today = () => new Date().toISOString().slice(0, 10);
const lbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "#5b6474", fontWeight: 400 };

function EmployeeInput({ id, value, onChange, employees, onBlur, label }: { id: string; value: string; onChange: (v: string) => void; employees: string[]; onBlur?: () => void; label: string }) {
  return (
    <>
      <input className="input" list={`${id}-list`} value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
      <datalist id={`${id}-list`}>
        {employees.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
    </>
  );
}

// ── Header actions: mileage, claims, book all ────────────────────────────────

export function CostsActions({ employees, defaultEmployee }: { employees: string[]; defaultEmployee: string }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const [mOpen, setMOpen] = useState(false);
  const [m, setM] = useState({ date: today(), from: "", to: "", km: "", employee: defaultEmployee, returnTrip: false });
  const [runMileage, mPending] = useAction(logMileage);
  const [runClaims, cPending] = useAction(payOutClaims);
  const [runAll, aPending] = useAction(bookAllSuggested);
  const [batch, setBatch] = useState<{ people: { name: string; cents: number }[]; total: number } | null>(null);
  const km = Number(m.km.replace(",", ".")) || 0;
  const totalKm = km * (m.returnTrip ? 2 : 1);

  return (
    <div className="page-actions">
      <button className="btn" onClick={() => setMOpen(true)}>
        <Icon name="CarSimple" size={16} />
        {t("costs.logMileage")}
      </button>
      <button
        className="btn"
        disabled={cPending}
        onClick={async () => {
          const r = await runClaims();
          if (r.ok && r.people?.length) setBatch({ people: r.people, total: r.total ?? 0 });
        }}
      >
        <Icon name={cPending ? "CircleNotch" : "HandCoins"} size={16} className={cPending ? "spin" : undefined} />
        {t("costs.payClaims")}
      </button>
      <button className="btn btn-primary" disabled={aPending} onClick={() => void runAll()}>
        <Icon name={aPending ? "CircleNotch" : "Checks"} size={16} className={aPending ? "spin" : undefined} />
        {t("costs.bookAll")}
      </button>

      <Modal
        open={mOpen}
        onClose={() => setMOpen(false)}
        title={t("costs.mileage.title")}
        footer={
          <>
            <button className="btn" onClick={() => setMOpen(false)}>{t("common.cancel")}</button>
            <button
              className="btn btn-primary"
              disabled={mPending}
              onClick={async () => {
                const r = await runMileage({ date: m.date, from: m.from, to: m.to, km, employee: m.employee, returnTrip: m.returnTrip });
                if (r.ok) {
                  setMOpen(false);
                  setM({ date: today(), from: "", to: "", km: "", employee: defaultEmployee, returnTrip: false });
                  if ("id" in r && r.id) router.push(`/costs?tab=todo&id=${r.id}`, { scroll: false });
                }
              }}
            >
              {mPending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Check" size={16} />}
              {t("costs.mileage.save")}
            </button>
          </>
        }
      >
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label style={lbl}>
            {t("costs.f.date")}
            <input className="input" type="date" value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} />
          </label>
          <label style={lbl}>
            {t("costs.mileage.employee")}
            <EmployeeInput id="mileage-emp" label={t("costs.mileage.employee")} value={m.employee} onChange={(v) => setM({ ...m, employee: v })} employees={employees} />
          </label>
          <label style={lbl}>
            {t("costs.mileage.from")}
            <input className="input" value={m.from} placeholder="Rotterdam" onChange={(e) => setM({ ...m, from: e.target.value })} />
          </label>
          <label style={lbl}>
            {t("costs.mileage.to")}
            <input className="input" value={m.to} placeholder="Schiedam" onChange={(e) => setM({ ...m, to: e.target.value })} />
          </label>
          <label style={lbl}>
            {t("costs.mileage.km")}
            <input className="input n" inputMode="decimal" value={m.km} onChange={(e) => setM({ ...m, km: e.target.value })} />
          </label>
          <label style={{ ...lbl, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 22, color: "#14171f", fontSize: 13 }}>
            <input type="checkbox" className="checkbox" checked={m.returnTrip} onChange={(e) => setM({ ...m, returnTrip: e.target.checked })} />
            {t("costs.mileage.return")}
          </label>
        </div>
        <div className="infobox n" style={{ fontSize: 13 }}>
          {t("costs.mileage.calc", { km: fmt.num(totalKm, totalKm % 1 ? 1 : 0), rate: fmt.money(MILEAGE_RATE_CENTS), amount: fmt.money(Math.round(totalKm * MILEAGE_RATE_CENTS)) })}
          <div style={{ fontSize: 12.5, color: "#5b6474", marginTop: 4 }}>{t("costs.mileage.hint")}</div>
        </div>
      </Modal>

      <Modal
        open={Boolean(batch)}
        onClose={() => setBatch(null)}
        title={t("costs.sepa.title")}
        footer={<button className="btn btn-primary" onClick={() => setBatch(null)}>{t("common.close")}</button>}
      >
        <div style={{ border: "1px solid #e4e7ec", borderRadius: 9, overflow: "hidden" }}>
          {batch?.people.map((p) => (
            <div key={p.name} className="n" style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", borderBottom: "1px solid #eef0f3", fontSize: 13.5 }}>
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><Icon name="User" size={15} />{p.name}</span>
              <span>{fmt.money(p.cents)}</span>
            </div>
          ))}
          <div className="n" style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", fontWeight: 600, background: "#f9fafb", fontSize: 13.5 }}>
            <span>{t("costs.sepa.total")}</span>
            <span>{fmt.money(batch?.total ?? 0)}</span>
          </div>
        </div>
        <div className="banner banner-info">
          <Icon name="Info" size={17} />
          <div>{t("costs.sepa.noIban")}</div>
        </div>
      </Modal>
    </div>
  );
}

// ── Capture strip + new receipt ──────────────────────────────────────────────

export function CaptureStrip({ canEdit, address, employees, defaultEmployee, autoOpen }: { canEdit: boolean; address: string; employees: string[]; defaultEmployee: string; autoOpen?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(Boolean(autoOpen) && canEdit);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ date: today(), supplier: "", description: "", amount: "", paidBy: "CARD" as PaidBy, employee: defaultEmployee });
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (autoOpen && canEdit) setOpen(true);
  }, [autoOpen, canEdit]);

  async function submit(fd: FormData, label: string) {
    setBusy(label);
    try {
      const r = await createReceipt(fd);
      if (r.ok) {
        if (r.message) toast(r.message);
        setOpen(false);
        setFile(null);
        setForm({ date: today(), supplier: "", description: "", amount: "", paidBy: "CARD", employee: defaultEmployee });
        router.push(r.id ? `/costs?tab=todo&id=${r.id}` : "/costs?tab=todo", { scroll: false });
        router.refresh();
      } else toast(r.error, "error");
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setBusy(null);
    }
  }

  async function quickFiles(files: File[]) {
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      await submit(fd, f.name);
    }
  }

  return (
    <>
      <div
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          if (!drag) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDrag(false);
          void quickFiles([...e.dataTransfer.files]);
        }}
        style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "14px 18px", marginBottom: 16, borderRadius: 12, border: `1.5px dashed ${drag ? "#7a1f3d" : "#c4cbd6"}`, background: drag ? "#f9eef2" : "#fff" }}
      >
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "#f8e9ee", color: "#7a1f3d", display: "grid", placeItems: "center", flex: "none" }}>
          <Icon name={busy ? "HourglassMedium" : "Camera"} size={21} className={busy ? "spin" : undefined} />
        </div>
        <div style={{ flex: 1, minWidth: 240 }} aria-live="polite">
          <div style={{ fontWeight: 600 }}>{busy && !open ? t("costs.reading", { file: busy }) : t("costs.captureTitle")}</div>
          <div style={{ fontSize: 13, color: "#5b6474" }} title={t("costs.captureHint")}>
            {t("costs.captureSub", { address })}
          </div>
        </div>
        {canEdit ? (
          <button className="btn" style={{ height: 34, padding: "0 12px", fontSize: 13.5 }} onClick={() => setOpen(true)}>
            <Icon name="Plus" size={15} />
            {t("costs.newReceipt")}
          </button>
        ) : null}
      </div>

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={t("costs.newTitle")}
        width={520}
        footer={
          <>
            <button className="btn" disabled={Boolean(busy)} onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <button
              className="btn btn-primary"
              disabled={Boolean(busy)}
              onClick={() => {
                const fd = new FormData();
                if (file) fd.append("file", file);
                for (const [k, v] of Object.entries(form)) fd.append(k, String(v));
                void submit(fd, file?.name ?? form.supplier);
              }}
            >
              {busy ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Check" size={16} />}
              {busy ? t("costs.reading", { file: busy }) : t("costs.addReceipt")}
            </button>
          </>
        }
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
          style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 10, border: "1.5px dashed #c4cbd6", cursor: "pointer" }}
        >
          <Icon name={file ? (file.type === "application/pdf" ? "FilePdf" : "Image") : "Camera"} size={22} color="#7a1f3d" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="truncate" style={{ fontWeight: 500, fontSize: 13.5 }}>{file ? file.name : t("costs.photoPick")}</div>
            <div style={{ fontSize: 12.5, color: "#5b6474" }}>{t("costs.photoHint")}</div>
          </div>
          {file ? (
            <button className="btn btn-icon" style={{ width: 30, height: 30 }} aria-label={t("common.delete")} onClick={(e) => (e.stopPropagation(), setFile(null))}>
              <Icon name="X" size={15} />
            </button>
          ) : null}
          <input ref={fileRef} type="file" accept="image/*,application/pdf,.heic" className="sr-only" tabIndex={-1} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label style={lbl}>
            {t("costs.f.supplier")}
            <input className="input" value={form.supplier} placeholder={file ? t("costs.f.fromPhoto") : ""} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          </label>
          <label style={lbl}>
            {t("costs.f.amount")}
            <input className="input n" inputMode="decimal" value={form.amount} placeholder={file ? t("costs.f.fromPhoto") : "0.00"} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label style={{ ...lbl, gridColumn: "span 2" }}>
            {t("costs.f.description")}
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label style={lbl}>
            {t("costs.f.date")}
            <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label style={lbl}>
            {t("costs.paidWith")}
            <select className="select" value={form.paidBy} onChange={(e) => setForm({ ...form, paidBy: e.target.value as PaidBy })}>
              <option value="CARD">{t("costs.paid.cardLong")}</option>
              <option value="BANK">{t("costs.paid.bankLong")}</option>
              <option value="OWN">{t("costs.paid.ownLong")}</option>
            </select>
          </label>
          {form.paidBy === "OWN" ? (
            <label style={{ ...lbl, gridColumn: "span 2" }}>
              {t("costs.whoPaid")}
              <EmployeeInput id="new-emp" label={t("costs.whoPaid")} value={form.employee} onChange={(v) => setForm({ ...form, employee: v })} employees={employees} />
            </label>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

// ── Receipt panel ────────────────────────────────────────────────────────────

export interface ReceiptView {
  id: string;
  date: string;
  supplier: string;
  description: string;
  amountCents: number;
  categoryKey: string | null;
  vatOverride: Override | null;
  paidBy: PaidBy;
  employeeName: string | null;
  status: "UNSORTED" | "SUGGESTED" | "BOOKED";
  suggestionReason: string | null;
  payroll: { account: string; debit: number; credit: number }[] | null;
  document: { id: string; mime: string; filename: string } | null;
  claimPaid: boolean;
}

const PAID_OPTS: { key: PaidBy; icon: IconName }[] = [
  { key: "CARD", icon: "CreditCard" },
  { key: "BANK", icon: "Bank" },
  { key: "OWN", icon: "User" },
];

export function ReceiptPanel({ r, accountNames, employees, canEdit, country }: { r: ReceiptView; accountNames: Record<string, string>; employees: string[]; canEdit: boolean; country: string }) {
  const { t, fmt, locale } = useI18n();
  const router = useRouter();
  const lang = locale === "nl" ? "nl" : "en";
  const booked = r.status === "BOOKED";
  const editable = canEdit && !booked && !r.payroll;
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(r.categoryKey);
  const [paidBy, setPaidBy] = useState<PaidBy>(r.paidBy);
  const [employee, setEmployee] = useState(r.employeeName ?? "");
  const [vatOv, setVatOv] = useState<Override | null>(r.vatOverride);
  const [ruleOn, setRuleOn] = useState(true);
  const [picked, setPicked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [det, setDet] = useState({ supplier: r.supplier, description: r.description, amount: (r.amountCents / 100).toFixed(2), date: r.date });

  const [runUpdate] = useAction(updateReceipt, { refresh: true });
  const [runBook, booking] = useAction(bookReceiptAction);
  const [runDelete, deleting] = useAction(deleteReceipt, { refresh: false });
  const [runEdit, savingDet] = useAction(editReceiptDetails);

  const c = cat ? CATEGORY_BY_KEY[cat] : null;
  const an = (code: string) => `${code} ${accountNames[code] ?? ""}`.trim();
  const groups = useMemo(
    () =>
      CATEGORY_GROUPS.map((g) => ({ ...g, cats: CATEGORIES.filter((x) => x.group === g.key && !x.importOnly && (!q.trim() || matchesCategory(x, q, accountNames))) })).filter((g) => g.cats.length),
    [q, accountNames],
  );

  const lines = receiptLines({ amountCents: r.amountCents, categoryKey: cat, paidBy, vatOverride: vatOv, payroll: r.payroll ?? undefined, country });
  const vatText = c ? (vatOv ? VAT_OVERRIDES[vatOv][lang] : c.vatNote ? c.vatNote[lang] : t("costs.vatReclaim", { pct: fmt.pct(c.vatRateBp) })) : "";

  function pick(key: string) {
    if (!editable) return;
    setCat(key);
    setPicked(true);
    void runUpdate({ id: r.id, categoryKey: key });
  }
  function setPaid(p: PaidBy) {
    if (!editable) return;
    setPaidBy(p);
    const emp = p === "OWN" ? employee || employees[0] || "" : employee;
    if (p === "OWN" && !employee && emp) setEmployee(emp);
    void runUpdate({ id: r.id, paidBy: p, ...(p === "OWN" ? { employeeName: emp || null } : {}) });
  }

  const why = picked ? t("costs.why.chosen") : r.suggestionReason;

  return (
    <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        {r.document ? (
          <a href={`/api/documents/${r.document.id}`} target="_blank" rel="noopener" title={r.document.filename} style={{ width: 58, height: 76, flex: "none", borderRadius: 6, border: "1px solid #e4e7ec", overflow: "hidden", display: "grid", placeItems: "center", background: "#f5f6f8", color: "#7a1f3d" }}>
            {r.document.mime.startsWith("image/") && r.document.mime !== "image/heic" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/documents/${r.document.id}`} alt={r.document.filename} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <Icon name={r.document.mime === "application/pdf" ? "FilePdf" : "Image"} size={24} />
            )}
          </a>
        ) : (
          <div style={{ width: 58, height: 76, flex: "none", borderRadius: 6, border: "1px solid #e4e7ec", background: "repeating-linear-gradient(180deg,#f5f6f8 0 6px,#fff 6px 10px)", display: "grid", placeItems: "center", color: "#8a93a3" }}>
            <Icon name={r.payroll ? "UsersThree" : "Receipt"} size={22} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input className="input" style={{ gridColumn: "span 2" }} aria-label={t("costs.f.supplier")} value={det.supplier} onChange={(e) => setDet({ ...det, supplier: e.target.value })} />
              <input className="input" style={{ gridColumn: "span 2" }} aria-label={t("costs.f.description")} value={det.description} onChange={(e) => setDet({ ...det, description: e.target.value })} />
              <input className="input n" aria-label={t("costs.f.amount")} inputMode="decimal" value={det.amount} onChange={(e) => setDet({ ...det, amount: e.target.value })} />
              <input className="input" type="date" aria-label={t("costs.f.date")} value={det.date} onChange={(e) => setDet({ ...det, date: e.target.value })} />
              <div style={{ gridColumn: "span 2", display: "flex", gap: 6 }}>
                <button className="btn btn-sm btn-primary" disabled={savingDet} onClick={async () => { const x = await runEdit({ id: r.id, ...det }); if (x.ok) setEditing(false); }}>{t("common.save")}</button>
                <button className="btn btn-sm" onClick={() => setEditing(false)}>{t("common.cancel")}</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", justifyContent: "space-between" }}>
                <div className="truncate" style={{ fontWeight: 600, fontSize: 16 }}>{r.supplier}</div>
                {editable ? (
                  <button className="btn btn-ghost btn-sm" style={{ height: 26, padding: "0 6px" }} onClick={() => setEditing(true)} aria-label={t("costs.editDetails")}>
                    <Icon name="PencilSimple" size={14} />
                  </button>
                ) : null}
              </div>
              <div style={{ fontSize: 13, color: "#5b6474" }}>{r.description}</div>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginTop: 6, flexWrap: "wrap" }}>
                <span className="n" style={{ fontSize: 20, fontWeight: 600 }}>{fmt.money(r.amountCents)}</span>
                <span style={{ fontSize: 12.5, color: "#5b6474" }}>{fmt.dateMed(new Date(`${r.date}T00:00:00Z`))} · {t("costs.inclVat")}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {r.payroll ? (
        <div style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 9, background: "#fcf5f7", color: "#7a1f3d", fontSize: 13 }}>
          <Icon name="UsersThree" size={18} />
          <span>{t("costs.payrollNote")}</span>
        </div>
      ) : (
        <>
          {!booked ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 600 }}>{t("costs.whatFor")}</div>
                {why ? (
                  <div style={{ fontSize: 12.5, color: "#5b6474", display: "flex", gap: 5, alignItems: "center" }}>
                    <Icon name="Sparkle" size={14} color="#7a1f3d" />
                    {why}
                  </div>
                ) : null}
              </div>
              <div className="search" style={{ height: 36, borderRadius: 8 }}>
                <Icon name="MagnifyingGlass" size={16} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("costs.searchPlaceholder")} aria-label={t("costs.whatFor")} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 340, overflowY: "auto", paddingRight: 2 }}>
                {groups.map((g) => (
                  <div key={g.key}>
                    <div style={{ fontSize: 11.5, fontWeight: 500, color: "#8a93a3", marginBottom: 5 }}>{g[lang]}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 6 }}>
                      {g.cats.map((x) => {
                        const on = cat === x.key;
                        return (
                          <button
                            key={x.key}
                            type="button"
                            disabled={!editable}
                            aria-pressed={on}
                            onClick={() => pick(x.key)}
                            className="cat-tile"
                            style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 9px", borderRadius: 8, border: `1px solid ${on ? "#7a1f3d" : "#e4e7ec"}`, background: on ? "#fcf5f7" : "#fff", boxShadow: on ? "0 0 0 3px #f1d5df" : "none", textAlign: "left", color: "#14171f", cursor: editable ? "pointer" : "default" }}
                          >
                            <Icon name={x.icon as IconName} size={17} color="#3a4250" style={{ marginTop: 1 }} />
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: "block", fontSize: 13, fontWeight: 500, lineHeight: 1.25 }}>{categoryLabel(x, locale)}</span>
                              <span className="n truncate" style={{ display: "block", fontSize: 11.5, color: "#8a93a3" }}>{an(x.account)}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {!groups.length ? <div style={{ fontSize: 13, color: "#8a93a3" }}>{t("common.emptySearch")}</div> : null}
              </div>
            </div>
          ) : null}

          {c ? (
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 13, padding: "12px 14px", borderRadius: 9, background: "#f9fafb", alignItems: "center" }}>
              {booked ? (
                <>
                  <span style={{ color: "#5b6474" }}>{t("costs.category")}</span>
                  <span>{categoryLabel(c, locale)}</span>
                </>
              ) : null}
              <span style={{ color: "#5b6474" }}>{t("costs.ledgerAccount")}</span>
              <span className="n" style={{ fontWeight: 600 }}>{an(c.account)}</span>
              <span style={{ color: "#5b6474" }}>{t("costs.vat")}</span>
              {editable ? (
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <select
                    className="select"
                    style={{ height: 30, fontSize: 13 }}
                    aria-label={t("costs.vat")}
                    value={vatOv ?? ""}
                    onChange={(e) => {
                      const v = (e.target.value || null) as Override | null;
                      setVatOv(v);
                      void runUpdate({ id: r.id, vatOverride: v });
                    }}
                  >
                    <option value="">{t("costs.vatDefault")}</option>
                    {(Object.keys(VAT_OVERRIDES) as Override[]).map((k) => (
                      <option key={k} value={k}>{VAT_OVERRIDES[k][lang]}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 12, color: "#5b6474" }}>{vatText}</span>
                </span>
              ) : (
                <span>{vatText}</span>
              )}
              {c.note ? (
                <>
                  <span style={{ color: "#5b6474" }}>{t("costs.goodToKnow")}</span>
                  <span>{c.note[lang]}</span>
                </>
              ) : null}
            </div>
          ) : null}

          <div>
            <div style={{ fontSize: 12.5, color: "#5b6474", marginBottom: 6 }}>{t("costs.paidWith")}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {PAID_OPTS.map((p) => {
                const on = paidBy === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    disabled={!editable}
                    aria-pressed={on}
                    onClick={() => setPaid(p.key)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 11px", borderRadius: 8, border: `1px solid ${on ? "#7a1f3d" : "#d5d9e0"}`, background: on ? "#f9eef2" : "#fff", color: on ? "#7a1f3d" : "#14171f", fontSize: 13, fontWeight: 500, cursor: editable ? "pointer" : "default" }}
                  >
                    <Icon name={p.icon} size={15} />
                    {t(`costs.paid.${p.key === "CARD" ? "cardLong" : p.key === "BANK" ? "bankLong" : "ownLong"}`)}
                  </button>
                );
              })}
              {paidBy === "OWN" ? (
                editable ? (
                  <div style={{ width: 150 }}>
                    <EmployeeInput
                      id={`emp-${r.id}`}
                      label={t("costs.whoPaid")}
                      value={employee}
                      employees={employees}
                      onChange={setEmployee}
                      onBlur={() => employee !== (r.employeeName ?? "") && void runUpdate({ id: r.id, employeeName: employee || null })}
                    />
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: "#5b6474" }}>
                    · {r.employeeName}
                    {r.claimPaid ? ` · ${t("costs.claimPaid")}` : ""}
                  </span>
                )
              ) : null}
            </div>
          </div>

          {editable && c ? (
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" className="checkbox" style={{ width: 16, height: 16 }} checked={ruleOn} onChange={(e) => setRuleOn(e.target.checked)} />
              {t("costs.rule", { supplier: r.supplier, label: categoryLabel(c, locale).toLowerCase() })}
            </label>
          ) : null}
        </>
      )}

      <div>
        <div style={{ fontSize: 12.5, color: "#5b6474", marginBottom: 6 }}>{t("costs.howItLands")}</div>
        {lines.length ? (
          <div style={{ border: "1px solid #e4e7ec", borderRadius: 9, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 92px 92px", gap: 10, padding: "7px 12px", fontSize: 12, fontWeight: 500, color: "#5b6474", background: "#f9fafb", borderBottom: "1px solid #e4e7ec" }}>
              <div>{t("costs.account")}</div>
              <div style={{ textAlign: "right" }}>{t("costs.debit")}</div>
              <div style={{ textAlign: "right" }}>{t("costs.credit")}</div>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="n" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 92px 92px", gap: 10, padding: "8px 12px", fontSize: 13, borderBottom: "1px solid #f0f2f5" }}>
                <span>
                  {an(l.account)}
                  {l.account === "1650" && employee ? ` · ${employee}` : ""}
                </span>
                <span style={{ textAlign: "right" }}>{l.debit ? fmt.money(l.debit) : ""}</span>
                <span style={{ textAlign: "right" }}>{l.credit ? fmt.money(l.credit) : ""}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#8a93a3", padding: 12, border: "1px dashed #d5d9e0", borderRadius: 9 }}>{t("costs.pickToSee")}</div>
        )}
      </div>

      {editable ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-primary" disabled={booking || !c} onClick={() => void runBook({ id: r.id, makeRule: ruleOn && Boolean(c) }).then((x) => x.ok && router.replace("/costs?tab=todo", { scroll: false }))}>
            <Icon name={booking ? "CircleNotch" : "Check"} size={16} className={booking ? "spin" : undefined} />
            {t("costs.book")}
          </button>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-ghost btn-danger btn-sm"
            disabled={deleting}
            onClick={async () => {
              if (!window.confirm(t("costs.confirmDelete"))) return;
              const x = await runDelete(r.id);
              if (x.ok) {
                router.replace("/costs?tab=todo", { scroll: false });
                router.refresh();
              }
            }}
          >
            <Icon name="Trash" size={15} />
            {t("common.delete")}
          </button>
        </div>
      ) : booked || r.payroll ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#157347" }}>
          <Icon name="CheckCircle" size={18} />
          {t("costs.bookedNote")}
        </div>
      ) : null}
    </div>
  );
}
