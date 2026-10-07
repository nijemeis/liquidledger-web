"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, useAction, useToast } from "@/components/client";
import { Icon, type IconName } from "@/components/icon";
import { useI18n } from "@/i18n/client";
import { acceptAll, addBankAccount, importStatement, matchLine, reconcileOther, sepaPreview } from "./actions";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TodoRow {
  id: string;
  date: Date;
  counterparty: string;
  description: string;
  amountCents: number;
  sug: { icon: IconName; label: string; reason: string } | null;
}

interface DocOption {
  id: string;
  number: string;
  party: string;
  outstandingCents: number;
  dueDate: Date;
}

interface Options {
  sales: DocOption[];
  purchases: DocOption[];
  receipts: { id: string; supplier: string; description: string; date: Date; amountCents: number }[];
  ledger: { code: string; name: string; alt: string }[];
}

const COLS = "70px minmax(0,1.3fr) 120px minmax(0,1.6fr) 170px";

// ── To reconcile table ───────────────────────────────────────────────────────

export function BankTodo({ rows, currency, canEdit, options }: { rows: TodoRow[]; currency: string; canEdit: boolean; options: Options }) {
  const { t, fmt } = useI18n();
  const [other, setOther] = useState<TodoRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [match] = useAction(matchLine);

  if (!rows.length) {
    return (
      <div className="empty">
        <Icon name="Confetti" size={32} color="#157347" />
        <div className="empty-title">{t("common.allCaughtUp")}</div>
        {t("bank.allBooked")}
      </div>
    );
  }

  return (
    <div className="tbl">
      <div style={{ minWidth: 900 }}>
        <div className="tbl-head" style={{ gridTemplateColumns: COLS }}>
          <div>{t("common.date")}</div>
          <div>{t("bank.counterparty")}</div>
          <div className="right">{t("common.amount")}</div>
          <div>{t("bank.suggested")}</div>
          <div />
        </div>
        {rows.map((x) => (
          <div key={x.id} className="tbl-row hover" style={{ gridTemplateColumns: COLS }}>
            <div className="n muted">{fmt.date(x.date)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="cell-main truncate">{x.counterparty}</div>
              <div className="cell-sub truncate" title={x.description}>{x.description}</div>
            </div>
            <div className="n right" style={{ fontWeight: 600, color: x.amountCents > 0 ? "#157347" : "#14171f" }}>
              {fmt.money(x.amountCents, { sign: true, currency })}
            </div>
            {x.sug ? (
              <div className="suggest">
                <Icon name={x.sug.icon} size={17} color="#7a1f3d" />
                <div style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 500 }}>{x.sug.label}</div>
                  <div className="truncate" style={{ fontSize: 12, color: "#5b6474" }}>{x.sug.reason}</div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 10px", borderRadius: 8, border: "1px dashed #d5d9e0", color: "#5b6474", fontSize: 13 }}>
                <Icon name="Question" size={17} />
                {t("bank.noSuggestion")}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              {canEdit ? (
                <>
                  {x.sug ? (
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy !== null}
                      onClick={async () => {
                        setBusy(x.id);
                        await match(x.id);
                        setBusy(null);
                      }}
                    >
                      <Icon name={busy === x.id ? "CircleNotch" : "Check"} size={14} className={busy === x.id ? "spin" : undefined} />
                      {t("bank.match")}
                    </button>
                  ) : null}
                  <button className="btn btn-sm" style={{ padding: "0 10px", fontWeight: 400 }} disabled={busy !== null} onClick={() => setOther(x)}>
                    {t("bank.other")}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {other ? <OtherModal row={other} currency={currency} options={options} onClose={() => setOther(null)} /> : null}
    </div>
  );
}

// ── "Other…" modal ───────────────────────────────────────────────────────────

type Mode = "invoice" | "receipt" | "ledger";

function OtherModal({ row, currency, options, onClose }: { row: TodoRow; currency: string; options: Options; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const incoming = row.amountCents > 0;
  const amount = Math.abs(row.amountCents);
  const docs = incoming ? options.sales : options.purchases;
  const [mode, setMode] = useState<Mode>(docs.some((d) => d.outstandingCents === amount) ? "invoice" : "ledger");
  const [q, setQ] = useState("");
  const [docId, setDocId] = useState<string | null>(() => docs.find((d) => d.outstandingCents === amount)?.id ?? null);
  const [receiptId, setReceiptId] = useState<string | null>(() => options.receipts.find((r) => r.amountCents === amount)?.id ?? null);
  const [account, setAccount] = useState<string | null>(null);
  const [vat, setVat] = useState<0 | 900 | 2100>(0);
  const [remember, setRemember] = useState(false);
  const [run, pending] = useAction(reconcileOther, { onDone: (r) => r.ok && onClose() });

  const needle = q.trim().toLowerCase();
  const docList = useMemo(() => {
    const list = docs.filter((d) => !needle || `${d.number} ${d.party} ${(d.outstandingCents / 100).toFixed(2)}`.toLowerCase().includes(needle));
    return [...list].sort((a, b) => Number(b.outstandingCents === amount) - Number(a.outstandingCents === amount));
  }, [docs, needle, amount]);
  const receiptList = useMemo(
    () => options.receipts.filter((r) => !needle || `${r.supplier} ${r.description} ${(r.amountCents / 100).toFixed(2)}`.toLowerCase().includes(needle)).sort((a, b) => Number(b.amountCents === amount) - Number(a.amountCents === amount)),
    [options.receipts, needle, amount],
  );
  const ledgerList = useMemo(
    () => options.ledger.filter((l) => !needle || `${l.code} ${l.name} ${l.alt}`.toLowerCase().includes(needle)),
    [options.ledger, needle],
  );

  const modes: { key: Mode; label: string }[] = [
    { key: "invoice", label: incoming ? t("bank.otherModal.salesInvoice") : t("bank.otherModal.purchaseInvoice") },
    ...(!incoming ? [{ key: "receipt" as Mode, label: t("bank.otherModal.receipt") }] : []),
    { key: "ledger", label: t("bank.otherModal.ledger") },
  ];

  const canSubmit = mode === "invoice" ? Boolean(docId) : mode === "receipt" ? Boolean(receiptId) : Boolean(account);
  const submit = () => {
    if (!canSubmit) return;
    if (mode === "invoice") run({ txId: row.id, kind: incoming ? "sales" : "purchase", invoiceId: docId! });
    else if (mode === "receipt") run({ txId: row.id, kind: "receipt", receiptId: receiptId! });
    else run({ txId: row.id, kind: "ledger", account: account!, vatRateBp: vat, remember });
  };

  const listBox: React.CSSProperties = { border: "1px solid #e4e7ec", borderRadius: 10, maxHeight: 260, overflowY: "auto" };
  const item = (on: boolean): React.CSSProperties => ({
    display: "grid",
    gap: 10,
    alignItems: "center",
    width: "100%",
    padding: "9px 12px",
    border: 0,
    borderBottom: "1px solid #eef0f3",
    borderLeft: `3px solid ${on ? "#7a1f3d" : "transparent"}`,
    background: on ? "#fcf5f7" : "#fff",
    textAlign: "left",
    fontSize: 13.5,
  });

  return (
    <Modal
      open
      onClose={onClose}
      width={600}
      title={t("bank.otherModal.title")}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={!canSubmit || pending} onClick={submit}>
            <Icon name={pending ? "CircleNotch" : "Check"} size={16} className={pending ? "spin" : undefined} />
            {t("bank.otherModal.book")}
          </button>
        </>
      }
    >
      <div className="infobox" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <div className="cell-main truncate">{row.counterparty}</div>
          <div className="cell-sub truncate">{fmt.date(row.date)} · {row.description}</div>
        </div>
        <div className="n" style={{ fontWeight: 600, fontSize: 15, color: incoming ? "#157347" : "#14171f" }}>{fmt.money(row.amountCents, { sign: true, currency })}</div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="radiogroup">
        {modes.map((m) => (
          <button key={m.key} type="button" className="chip" aria-pressed={mode === m.key} onClick={() => { setMode(m.key); setQ(""); }}>
            {m.label}
          </button>
        ))}
      </div>

      <label className="search" style={{ height: 36 }}>
        <Icon name="MagnifyingGlass" size={16} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={mode === "ledger" ? t("bank.otherModal.searchLedger") : mode === "receipt" ? t("bank.otherModal.searchReceipt") : t("bank.otherModal.searchInvoice")}
          aria-label={t("common.search_")}
        />
      </label>

      {mode === "invoice" ? (
        <div style={listBox} role="listbox">
          {docList.length ? (
            docList.map((d) => (
              <button key={d.id} type="button" role="option" aria-selected={docId === d.id} onClick={() => setDocId(d.id)} style={{ ...item(docId === d.id), gridTemplateColumns: "minmax(0,1fr) auto" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }} className="truncate">
                    <span className="n" style={{ color: "#7a1f3d" }}>{d.number}</span> · {d.party}
                  </div>
                  <div className="cell-sub">{t("bank.otherModal.dueOn", { date: fmt.date(d.dueDate) })}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="n" style={{ fontWeight: 600 }}>{fmt.money(d.outstandingCents)}</div>
                  {d.outstandingCents === amount ? <span className="pill pill-green">{t("bank.otherModal.sameAmount")}</span> : null}
                </div>
              </button>
            ))
          ) : (
            <div style={{ padding: 16, color: "#5b6474", fontSize: 13 }}>{incoming ? t("bank.otherModal.noSales") : t("bank.otherModal.noPurchases")}</div>
          )}
        </div>
      ) : mode === "receipt" ? (
        <div style={listBox} role="listbox">
          {receiptList.length ? (
            receiptList.map((r) => (
              <button key={r.id} type="button" role="option" aria-selected={receiptId === r.id} onClick={() => setReceiptId(r.id)} style={{ ...item(receiptId === r.id), gridTemplateColumns: "minmax(0,1fr) auto" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 500 }}>{r.supplier}</div>
                  <div className="cell-sub truncate">{fmt.date(r.date)} · {r.description}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="n" style={{ fontWeight: 600 }}>{fmt.money(r.amountCents)}</div>
                  {r.amountCents === amount ? <span className="pill pill-green">{t("bank.otherModal.sameAmount")}</span> : null}
                </div>
              </button>
            ))
          ) : (
            <div style={{ padding: 16, color: "#5b6474", fontSize: 13 }}>{t("bank.otherModal.noReceipts")}</div>
          )}
        </div>
      ) : (
        <>
          <div style={listBox} role="listbox">
            {ledgerList.length ? (
              ledgerList.map((l) => (
                <button key={l.code} type="button" role="option" aria-selected={account === l.code} onClick={() => setAccount(l.code)} style={{ ...item(account === l.code), gridTemplateColumns: "48px minmax(0,1fr)" }}>
                  <span className="n" style={{ fontWeight: 600 }}>{l.code}</span>
                  <span className="truncate">
                    {l.name}
                    {l.alt !== l.name ? <span style={{ color: "#8a93a3" }}> · {l.alt}</span> : null}
                  </span>
                </button>
              ))
            ) : (
              <div style={{ padding: 16, color: "#5b6474", fontSize: 13 }}>{t("common.emptySearch")}</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <span className="field-label">{t("bank.otherModal.vat")}</span>
            <div style={{ display: "flex", gap: 6 }}>
              {([0, 900, 2100] as const).map((r) => (
                <button key={r} type="button" className="chip" aria-pressed={vat === r} onClick={() => setVat(r)} style={{ height: 30 }}>
                  {fmt.pct(r)}
                </button>
              ))}
            </div>
            {vat ? (
              <span className="cell-sub n">
                {t("bank.otherModal.vatSplit", { net: fmt.money(Math.round((amount * 10_000) / (10_000 + vat))), vat: fmt.money(amount - Math.round((amount * 10_000) / (10_000 + vat))) })}
              </span>
            ) : null}
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
            <input type="checkbox" className="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {t("bank.otherModal.remember", { name: row.counterparty })}
          </label>
        </>
      )}
    </Modal>
  );
}

// ── Header actions ───────────────────────────────────────────────────────────

interface AccountOpt {
  id: string;
  name: string;
  currency: string;
  iban: string | null;
  accountCode: string;
}

export function BankActions({ accounts, selectedId, suggestCount, reconcilable, ledger10 }: { accounts: AccountOpt[]; selectedId: string | null; suggestCount: number; reconcilable: boolean; ledger10: { code: string; name: string }[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<null | "import" | "add" | "sepa">(null);
  const [accept, accepting] = useAction(acceptAll);
  return (
    <>
      {accounts.length ? (
        <button className="btn" onClick={() => setOpen("import")}>
          <Icon name="UploadSimple" size={16} />
          {t("bank.importStatement")}
        </button>
      ) : null}
      <button className="btn" onClick={() => setOpen("add")}>
        <Icon name="Plus" size={16} />
        {t("bank.addAccount")}
      </button>
      {accounts.length ? (
        <button className="btn" onClick={() => setOpen("sepa")}>
          <Icon name="PaperPlaneTilt" size={16} />
          {t("bank.paySuppliers")}
        </button>
      ) : null}
      {reconcilable && suggestCount > 0 && selectedId ? (
        <button className="btn btn-primary" disabled={accepting} onClick={() => accept(selectedId)}>
          <Icon name={accepting ? "CircleNotch" : "Checks"} size={16} className={accepting ? "spin" : undefined} />
          {t("bank.acceptAll", { n: suggestCount })}
        </button>
      ) : null}
      {open === "import" ? <ImportModal accounts={accounts} selectedId={selectedId} onClose={() => setOpen(null)} /> : null}
      {open === "add" ? <AddAccountModal ledger10={ledger10} onClose={() => setOpen(null)} /> : null}
      {open === "sepa" ? <SepaModal selectedId={selectedId} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function ImportModal({ accounts, selectedId, onClose }: { accounts: AccountOpt[]; selectedId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const [accountId, setAccountId] = useState(selectedId ?? accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [run, pending] = useAction(importStatement, { onDone: (r) => r.ok && onClose() });
  const submit = () => {
    if (!file) return;
    const fd = new FormData();
    fd.set("accountId", accountId);
    fd.set("file", file);
    run(fd);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t("bank.import.title")}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={!file || pending} onClick={submit}>
            <Icon name={pending ? "CircleNotch" : "UploadSimple"} size={16} className={pending ? "spin" : undefined} />
            {t("bank.import.submit")}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">{t("bank.import.account")}</span>
        <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} {a.iban ? `· ${a.iban}` : ""} · {a.currency}
            </option>
          ))}
        </select>
      </label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) setFile(f);
        }}
        onClick={() => input.current?.click()}
        style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 12, border: `1.5px dashed ${drag ? "#7a1f3d" : "#c4cbd6"}`, background: drag ? "#f9eef2" : "#fff", cursor: "pointer" }}
      >
        <div className="tile" style={{ width: 40, height: 40, borderRadius: 10, background: "#f8e9ee", color: "#7a1f3d" }}>
          <Icon name={file ? "FileText" : "FileArrowUp"} size={21} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="truncate" style={{ fontWeight: 600 }}>{file ? file.name : t("bank.import.drop")}</div>
          <div style={{ fontSize: 13, color: "#5b6474" }}>{t("bank.import.formats")}</div>
        </div>
        <input ref={input} type="file" accept=".xml,.csv,.txt,application/xml,text/xml,text/csv" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div style={{ fontSize: 12.5, color: "#5b6474" }}>{t("bank.import.csvHint")}</div>
    </Modal>
  );
}

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "DKK", "NOK", "PLN"];

function AddAccountModal({ ledger10, onClose }: { ledger10: { code: string; name: string }[]; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const nextFree = () => {
    for (let c = 1000; c <= 1099; c++) if (!ledger10.some((l) => l.code === String(c))) return String(c);
    return "";
  };
  const [f, setF] = useState({ name: "", iban: "", currency: "EUR", mode: (ledger10.length ? "existing" : "new") as "existing" | "new", accountCode: ledger10[0]?.code ?? "1000", newCode: nextFree(), ledgerName: "", openingBalance: "" });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const [run, pending] = useAction(addBankAccount, {
    onDone: (r) => {
      if (r.ok) {
        onClose();
        if (typeof r.accountId === "string") router.push(`/bank?account=${r.accountId}`);
      }
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run({ name: f.name, iban: f.iban, currency: f.currency, mode: f.mode, accountCode: f.mode === "new" ? f.newCode : f.accountCode, ledgerName: f.ledgerName, openingBalance: f.openingBalance });
  };
  return (
    <Modal open onClose={onClose} title={t("bank.add.title")} width={520}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label className="field">
          <span className="field-label">{t("bank.add.name")}</span>
          <input className="input" required autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("bank.add.namePh")} />
        </label>
        <div className="form-grid" style={{ gridTemplateColumns: "minmax(0,1fr) 110px" }}>
          <label className="field">
            <span className="field-label">IBAN</span>
            <input className="input n" value={f.iban} onChange={(e) => set({ iban: e.target.value.toUpperCase() })} placeholder="NL91 INGB 0006 6544 71" />
          </label>
          <label className="field">
            <span className="field-label">{t("bank.add.currency")}</span>
            <select className="select" value={f.currency} onChange={(e) => set({ currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="field">
          <span className="field-label">{t("bank.add.ledger")}</span>
          <div style={{ display: "flex", gap: 6 }}>
            {ledger10.length ? (
              <button type="button" className="chip" aria-pressed={f.mode === "existing"} onClick={() => set({ mode: "existing" })} style={{ height: 30 }}>
                {t("bank.add.existing")}
              </button>
            ) : null}
            <button type="button" className="chip" aria-pressed={f.mode === "new"} onClick={() => set({ mode: "new" })} style={{ height: 30 }}>
              {t("bank.add.new")}
            </button>
          </div>
          {f.mode === "existing" ? (
            <select className="select" value={f.accountCode} onChange={(e) => set({ accountCode: e.target.value })}>
              {ledger10.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.code} {l.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="form-grid" style={{ gridTemplateColumns: "100px minmax(0,1fr)" }}>
              <input className="input n" value={f.newCode} onChange={(e) => set({ newCode: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="1030" aria-label={t("bank.add.code")} />
              <input className="input" value={f.ledgerName} onChange={(e) => set({ ledgerName: e.target.value })} placeholder={f.name || t("bank.add.ledgerNamePh")} aria-label={t("bank.add.ledgerName")} />
            </div>
          )}
          <span style={{ fontSize: 12, color: "#5b6474", fontWeight: 400 }}>{t("bank.add.ledgerHint")}</span>
        </div>
        <label className="field">
          <span className="field-label">{t("bank.add.opening", { currency: f.currency })}</span>
          <input className="input n" inputMode="decimal" value={f.openingBalance} onChange={(e) => set({ openingBalance: e.target.value })} placeholder="0.00" />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={pending || !f.name.trim()}>
            <Icon name={pending ? "CircleNotch" : "Plus"} size={16} className={pending ? "spin" : undefined} />
            {t("bank.add.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Preview = {
  debtors: { id: string; name: string; iban: string; valid: boolean }[];
  pay: { id: string; supplier: string; number: string; dueDate: Date | null; amountCents: number; iban: string; scheduled: boolean }[];
  skipped: { id: string; supplier: string; number: string; amountCents: number; currency: string; reason: "noIban" | "badIban" | "currency" }[];
};

function SepaModal({ selectedId, onClose }: { selectedId: string | null; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const [debtor, setDebtor] = useState("");
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    sepaPreview()
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          setData({ debtors: r.debtors, pay: r.pay, skipped: r.skipped } as Preview);
          const ok = r.debtors.filter((d) => d.valid);
          setDebtor((ok.find((d) => d.id === selectedId) ?? ok[0])?.id ?? "");
        }
        else setError(r.error);
      })
      .catch(() => live && setError(t("common.error")));
    return () => {
      live = false;
    };
  }, [t, selectedId]);
  const total = data?.pay.reduce((a, p) => a + p.amountCents, 0) ?? 0;
  const reason = (r: string) => t(`bank.sepa.skip.${r}`);
  return (
    <Modal
      open
      onClose={onClose}
      width={600}
      title={t("bank.sepa.title")}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.close")}</button>
          {data?.pay.length && debtor ? (
            <a
              className="btn btn-primary"
              href={`/bank/sepa?account=${debtor}`}
              download
              onClick={() => {
                toast(t("bank.sepa.downloaded", { n: data.pay.length, amount: fmt.money(total) }));
                setTimeout(onClose, 600);
              }}
            >
              <Icon name="DownloadSimple" size={16} />
              {t("bank.sepa.download")}
            </a>
          ) : null}
        </>
      }
    >
      {error ? <div className="banner banner-error">{error}</div> : null}
      {!data && !error ? (
        <div className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Icon name="CircleNotch" className="spin" size={16} /> {t("common.loading")}
        </div>
      ) : null}
      {data ? (
        <>
          <div style={{ fontSize: 13.5, color: "#3a4250" }}>{t("bank.sepa.intro")}</div>
          {data.debtors.some((d) => d.valid) ? (
            <label className="field">
              <span className="field-label">{t("bank.sepa.from")}</span>
              <select className="select" value={debtor} onChange={(e) => setDebtor(e.target.value)}>
                {data.debtors.map((a) => (
                  <option key={a.id} value={a.id} disabled={!a.valid}>
                    {a.name} · {a.iban}
                    {a.valid ? "" : ` · ${t("bank.sepa.badIban")}`}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="banner banner-warn">{t("bank.sepa.noDebtor")}</div>
          )}
          {data.pay.length ? (
            <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
              {data.pay.map((p) => (
                <div key={p.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, padding: "9px 12px", borderBottom: "1px solid #eef0f3", fontSize: 13.5 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="truncate" style={{ fontWeight: 500 }}>{p.supplier}</div>
                    <div className="cell-sub truncate n">
                      {p.number} · {p.iban.replace(/(.{4})/g, "$1 ").trim()} · {p.scheduled ? t("bank.sepa.scheduled") : p.dueDate ? t("bank.otherModal.dueOn", { date: fmt.date(p.dueDate) }) : ""}
                    </div>
                  </div>
                  <div className="n" style={{ fontWeight: 600 }}>{fmt.money(p.amountCents)}</div>
                </div>
              ))}
              <div className="n" style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", fontWeight: 600, background: "#f9fafb" }}>
                <span>{t("bank.sepa.total", { n: data.pay.length })}</span>
                <span>{fmt.money(total)}</span>
              </div>
            </div>
          ) : (
            <div className="infobox" style={{ fontSize: 13.5 }}>{t("bank.sepa.nothing")}</div>
          )}
          {data.skipped.length ? (
            <div className="banner banner-warn" style={{ flexDirection: "column", gap: 4 }}>
              <div style={{ fontWeight: 600 }}>{t("bank.sepa.skipped", { n: data.skipped.length })}</div>
              {data.skipped.map((s) => (
                <div key={s.id}>
                  {s.supplier} · {s.number} · {fmt.money(s.amountCents)} — {reason(s.reason)}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
