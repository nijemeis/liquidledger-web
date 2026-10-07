"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n/client";
import { parseMoney } from "@/lib/format";
import { UrlDrawer, UrlModal, useHref } from "../reports/_components/nav";
import { createAccount, postJournal, reverseEntry, setPeriodClose } from "./actions";

export type AccountOption = { code: string; name: string; other: string; type: string };

// ── Searchable account picker ────────────────────────────────────────────────

function AccountPicker({ accounts, value, onChange, label }: { accounts: AccountOption[]; value: string; onChange: (code: string) => void; label: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const selected = accounts.find((a) => a.code === value);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const r = s ? accounts.filter((a) => a.code.startsWith(s) || a.name.toLowerCase().includes(s) || a.other.toLowerCase().includes(s)) : accounts;
    return r.slice(0, 60);
  }, [accounts, q]);
  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
    setQ("");
  };
  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <input
        className="input"
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        placeholder={t("ledger.new.pickAccount")}
        value={open ? q : selected ? `${selected.code} ${selected.name}` : ""}
        onFocus={() => {
          setOpen(true);
          setHi(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, list.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open && list[hi]) {
            e.preventDefault();
            pick(list[hi]!.code);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open ? (
        <div className="menu" style={{ top: 40, left: 0, right: "auto", width: 340, maxHeight: 280, overflowY: "auto" }}>
          {list.length ? (
            list.map((a, i) => (
              <button
                key={a.code}
                type="button"
                className="menu-item"
                style={{ background: i === hi ? "#f3f5f8" : undefined, fontSize: 13.5 }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(a.code);
                }}
                onMouseEnter={() => setHi(i)}
              >
                <span className="n" style={{ color: "#5b6474", width: 40, flex: "none" }}>
                  {a.code}
                </span>
                <span style={{ minWidth: 0 }} className="truncate">
                  {a.name} <span style={{ color: "#8a93a3", fontSize: 12 }}>{a.other}</span>
                </span>
              </button>
            ))
          ) : (
            <div className="menu-label">{t("common.emptySearch")}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── New journal entry ────────────────────────────────────────────────────────

type Line = { id: number; account: string; debit: string; credit: string; vatCode: string; description: string };

const VAT_CODES = ["S_HIGH", "S_LOW", "S_ZERO", "EXPORT", "ICP", "IMPORT", "EU_ACQ", "EU_SRV", "INPUT"];

export function NewEntryDrawer({ accounts, today, lockedThrough }: { accounts: AccountOption[]; today: string; lockedThrough: string | null }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const href = useHref();
  const seq = useRef(3);
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { id: 1, account: "", debit: "", credit: "", vatCode: "", description: "" },
    { id: 2, account: "", debit: "", credit: "", vatCode: "", description: "" },
  ]);
  const [run, pending] = useAction(postJournal, { onDone: (r) => r.ok && router.push(href({ new: null }), { scroll: false }) });

  const cents = (s: string) => (s.trim() ? parseMoney(s) : 0);
  const parsed = lines.map((l) => ({ ...l, d: cents(l.debit), c: cents(l.credit) }));
  const invalid = parsed.some((l) => l.d === null || l.c === null || (l.d ?? 0) < 0 || (l.c ?? 0) < 0 || ((l.d ?? 0) > 0 && (l.c ?? 0) > 0));
  const used = parsed.filter((l) => l.account && ((l.d ?? 0) > 0 || (l.c ?? 0) > 0));
  const missingAccount = parsed.some((l) => !l.account && ((l.d ?? 0) > 0 || (l.c ?? 0) > 0));
  const dr = parsed.reduce((a, l) => a + (l.d ?? 0), 0);
  const cr = parsed.reduce((a, l) => a + (l.c ?? 0), 0);
  const balanced = dr === cr && dr > 0;
  const inLocked = lockedThrough !== null && date <= lockedThrough;
  const ok = balanced && !invalid && !missingAccount && used.length >= 2 && title.trim().length >= 2 && !!date && !inLocked;

  const set = (id: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, [k]: v } : l)));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    void run({
      date,
      title: title.trim(),
      lines: used.map((l) => ({ account: l.account, debit: l.d ?? 0, credit: l.c ?? 0, vatCode: l.vatCode || null, description: l.description || null })),
    });
  };
  const fillDiff = (id: number) => {
    const diff = dr - cr;
    if (!diff) return;
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, debit: diff < 0 ? fmt.num(-diff / 100, 2) : "", credit: diff > 0 ? fmt.num(diff / 100, 2) : "" } : l)));
  };

  const COLS = "minmax(180px,1.6fr) 110px 110px 110px minmax(120px,1fr) 32px";
  return (
    <UrlDrawer
      close={["new"]}
      width={900}
      title={t("ledger.new.title")}
      subtitle={t("ledger.new.subtitle")}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, width: "100%", flexWrap: "wrap" }}>
          <div className="n" style={{ fontSize: 13.5, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <span>
              <span className="muted">{t("ledger.debit")} </span>
              <b>{fmt.money(dr)}</b>
            </span>
            <span>
              <span className="muted">{t("ledger.credit")} </span>
              <b>{fmt.money(cr)}</b>
            </span>
            {balanced ? (
              <span style={{ color: "#157347", display: "inline-flex", gap: 5, alignItems: "center", fontWeight: 500 }}>
                <Icon name="CheckCircle" size={16} />
                {t("ledger.new.balanced")}
              </span>
            ) : (
              <span style={{ color: "#b42318", display: "inline-flex", gap: 5, alignItems: "center", fontWeight: 500 }}>
                <Icon name="WarningCircle" size={16} />
                {t("ledger.new.difference", { amount: fmt.money(Math.abs(dr - cr)) })}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={() => router.push(href({ new: null }), { scroll: false })}>
              {t("common.cancel")}
            </button>
            <button type="submit" form="journal-entry" className="btn btn-primary" disabled={!ok || pending}>
              {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Check" size={16} />}
              {t("ledger.new.post")}
            </button>
          </div>
        </div>
      }
    >
      <form id="journal-entry" className="stack" onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "170px minmax(0,1fr)", gap: 12 }}>
          <label className="field">
            {t("common.date")}
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required aria-invalid={inLocked} />
          </label>
          <label className="field">
            {t("ledger.new.description")}
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("ledger.new.descriptionPh")} maxLength={200} required />
          </label>
        </div>
        {inLocked ? (
          <div className="banner banner-warn">
            <Icon name="LockSimple" size={17} style={{ marginTop: 1 }} />
            <div>{t("ledger.new.lockedWarn", { date: fmt.dateMed(new Date(lockedThrough + "T00:00:00Z")) })}</div>
          </div>
        ) : null}
        <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "visible" }}>
          <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 8, borderRadius: "10px 10px 0 0", padding: "8px 10px" }}>
            <div>{t("ledger.new.account")}</div>
            <div style={{ textAlign: "right" }}>{t("ledger.debit")}</div>
            <div style={{ textAlign: "right" }}>{t("ledger.credit")}</div>
            <div>{t("ledger.new.vatCode")}</div>
            <div>{t("ledger.new.lineDescription")}</div>
            <div />
          </div>
          {lines.map((l, i) => {
            const p = parsed[i]!;
            return (
              <div key={l.id} style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "8px 10px", borderBottom: "1px solid #f0f2f5", alignItems: "center" }}>
                <AccountPicker accounts={accounts} value={l.account} onChange={(c) => set(l.id, "account", c)} label={t("ledger.new.account")} />
                <input
                  className="input n"
                  inputMode="decimal"
                  style={{ textAlign: "right" }}
                  aria-label={t("ledger.debit")}
                  aria-invalid={p.d === null}
                  value={l.debit}
                  onChange={(e) => set(l.id, "debit", e.target.value)}
                  onDoubleClick={() => fillDiff(l.id)}
                  disabled={!!l.credit.trim()}
                />
                <input
                  className="input n"
                  inputMode="decimal"
                  style={{ textAlign: "right" }}
                  aria-label={t("ledger.credit")}
                  aria-invalid={p.c === null}
                  value={l.credit}
                  onChange={(e) => set(l.id, "credit", e.target.value)}
                  onDoubleClick={() => fillDiff(l.id)}
                  disabled={!!l.debit.trim()}
                />
                <select className="select" aria-label={t("ledger.new.vatCode")} value={l.vatCode} onChange={(e) => set(l.id, "vatCode", e.target.value)}>
                  <option value="">—</option>
                  {VAT_CODES.map((c) => (
                    <option key={c} value={c}>
                      {t(`ledger.vatCode.${c}`)}
                    </option>
                  ))}
                </select>
                <input className="input" aria-label={t("ledger.new.lineDescription")} value={l.description} onChange={(e) => set(l.id, "description", e.target.value)} maxLength={200} />
                <button type="button" className="btn btn-icon btn-ghost" aria-label={t("common.delete")} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} style={{ width: 32, height: 32 }}>
                  <Icon name="Trash" size={16} />
                </button>
              </div>
            );
          })}
          <div style={{ padding: "8px 10px", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines((ls) => [...ls, { id: seq.current++, account: "", debit: "", credit: "", vatCode: "", description: "" }])}>
              <Icon name="Plus" size={15} />
              {t("ledger.new.addLine")}
            </button>
            <span className="hint" style={{ fontSize: 12.5, color: "#5b6474" }}>
              {t("ledger.new.hint")}
            </span>
          </div>
        </div>
        <div className="infobox" style={{ fontSize: 12.5, color: "#5b6474", display: "flex", gap: 8 }}>
          <Icon name="Info" size={16} style={{ marginTop: 1 }} />
          <span>{t("ledger.new.vatHint")}</span>
        </div>
      </form>
    </UrlDrawer>
  );
}

// ── Reverse ──────────────────────────────────────────────────────────────────

export function ReverseButton({ id, number }: { id: string; number: number }) {
  const { t } = useI18n();
  const [run, pending] = useAction(reverseEntry);
  return (
    <button type="button" className="btn btn-sm btn-ghost" style={{ height: 26, padding: "0 8px", fontSize: 12.5 }} disabled={pending} onClick={() => confirm(t("ledger.confirmReverse", { n: number })) && run({ id })}>
      <Icon name="ArrowCounterClockwise" size={14} />
      {t("ledger.reverse")}
    </button>
  );
}

// ── Add ledger account ───────────────────────────────────────────────────────

export function AddAccountModal() {
  const { t } = useI18n();
  const router = useRouter();
  const href = useHref();
  const [f, setF] = useState({ code: "", nameNl: "", nameEn: "", type: "COST" });
  const [run, pending] = useAction(createAccount, { onDone: (r) => r.ok && router.push(href({ addAccount: null }), { scroll: false }) });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <UrlModal
      close={["addAccount"]}
      title={t("ledger.addAccount")}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, width: "100%" }}>
          <button type="button" className="btn" onClick={() => router.push(href({ addAccount: null }), { scroll: false })}>
            {t("common.cancel")}
          </button>
          <button type="submit" form="add-account" className="btn btn-primary" disabled={pending}>
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Plus" size={16} />}
            {t("ledger.addAccount")}
          </button>
        </div>
      }
    >
      <form
        id="add-account"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(f as Parameters<typeof createAccount>[0]);
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr)", gap: 12 }}>
          <label className="field">
            {t("ledger.acc.code")}
            <input className="input n" value={f.code} onChange={set("code")} inputMode="numeric" pattern="\d{4,6}" placeholder="4910" required autoFocus />
          </label>
          <label className="field">
            {t("ledger.acc.type")}
            <select className="select" value={f.type} onChange={set("type")}>
              {["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COST"].map((x) => (
                <option key={x} value={x}>
                  {t(`ledger.type.${x}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          {t("ledger.acc.nameNl")}
          <input className="input" value={f.nameNl} onChange={set("nameNl")} required maxLength={120} />
        </label>
        <label className="field">
          {t("ledger.acc.nameEn")}
          <input className="input" value={f.nameEn} onChange={set("nameEn")} required maxLength={120} />
        </label>
        <span className="field-label" style={{ fontSize: 12.5, color: "#5b6474" }}>
          {t("ledger.acc.hint")}
        </span>
      </form>
    </UrlModal>
  );
}

// ── Period close ─────────────────────────────────────────────────────────────

export function PeriodCloseModal({ current, options }: { current: string | null; options: { value: string; label: string }[] }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const href = useHref();
  const [through, setThrough] = useState(current ?? options[0]?.value ?? "");
  const [run, pending] = useAction(setPeriodClose, { onDone: (r) => r.ok && router.push(href({ close: null }), { scroll: false }) });
  const reopening = current !== null && (through === "" || through < current);
  const fmtDay = (s: string) => fmt.dateMed(new Date(s + "T00:00:00Z"));
  return (
    <UrlModal
      close={["close"]}
      width={520}
      title={t("ledger.close.title")}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, width: "100%" }}>
          <button type="button" className="btn" onClick={() => router.push(href({ close: null }), { scroll: false })}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={reopening ? "btn btn-danger" : "btn btn-primary"}
            disabled={pending || through === (current ?? "")}
            onClick={() => {
              const msg = reopening ? (through ? t("ledger.close.confirmReopen", { date: fmtDay(through) }) : t("ledger.close.confirmReopenAll")) : t("ledger.close.confirmClose", { date: fmtDay(through) });
              if (confirm(msg)) void run({ through: through || null });
            }}
          >
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name={reopening ? "LockKeyOpen" : "LockSimple"} size={16} />}
            {reopening ? t("ledger.close.reopenBtn") : t("ledger.close.closeBtn")}
          </button>
        </div>
      }
    >
      <div className="infobox" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Icon name={current ? "LockSimple" : "LockKeyOpen"} size={20} color={current ? "#7a1f3d" : "#5b6474"} />
        <div>
          <div style={{ fontWeight: 600 }}>{current ? t("ledger.close.closedThrough", { date: fmtDay(current) }) : t("ledger.close.allOpen")}</div>
          <div style={{ fontSize: 12.5, color: "#5b6474" }}>{t("ledger.close.explain")}</div>
        </div>
      </div>
      <label className="field">
        {t("ledger.close.closeThrough")}
        <select className="select" value={through} onChange={(e) => setThrough(e.target.value)}>
          <option value="">{t("ledger.close.nothing")}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {reopening ? (
        <div className="banner banner-warn">
          <Icon name="Warning" size={17} style={{ marginTop: 1 }} />
          <div>{t("ledger.close.reopenWarn")}</div>
        </div>
      ) : null}
    </UrlModal>
  );
}
