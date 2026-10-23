"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountType } from "@prisma/client";
import { useI18n } from "@/i18n/client";
import { Modal, useAction, useToast } from "@/components/client";
import { Icon } from "@/components/icon";
import type { ImportPreview, ImportResult } from "@/lib/xaf/import";
import type { AccountTarget } from "@/lib/xaf/mapping";
import { importXaf, previewXaf, reverseXafImport } from "./actions";

const TYPES: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COST"];
const CODE = /^\d{4,6}$/;
const CHECK: React.CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, cursor: "pointer" };
// Server Actions accept 12 MB; the gzipped XML has to fit (≈100 MB of XML).
const MAX_UPLOAD = 11.5 * 1024 * 1024;

async function gzip(f: File): Promise<Blob> {
  if (typeof CompressionStream === "undefined") return f;
  return new Response(f.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

export function XafImport({ canLock, lockedThrough }: { canLock: boolean; lockedThrough: string | null }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [blob, setBlob] = useState<{ data: Blob; name: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [journals, setJournals] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState(true);
  const [allRelations, setAllRelations] = useState(false);
  const [invoices, setInvoices] = useState(true);
  const [lock, setLock] = useState(false);
  const [mapping, setMapping] = useState<Record<string, AccountTarget>>({});
  const [done, setDone] = useState<ImportResult | null>(null);
  const [drag, setDrag] = useState(false);

  async function choose(f: File | undefined) {
    if (!f || reading) return;
    setReading(true);
    setDone(null);
    try {
      const data = await gzip(f);
      if (data.size > MAX_UPLOAD) {
        toast(t("xaf.err.tooLarge"), "error");
        return;
      }
      const fd = new FormData();
      fd.append("file", data, f.name);
      fd.append("name", f.name);
      const r = await previewXaf(fd);
      if (!r.ok || !r.preview) {
        toast(r.ok ? t("xaf.err.parse", { detail: "" }) : r.error, "error");
        return;
      }
      const p = r.preview;
      setBlob({ data, name: f.name });
      setPreview(p);
      setJournals(new Set(p.journals.filter((j) => j.include).map((j) => j.id)));
      setOpening(!!p.opening && !p.problems.some((x) => x.code === "openingUnbalanced"));
      setAllRelations(false);
      setInvoices(true);
      const thisMonth = new Date().toISOString().slice(0, 7);
      setLock(canLock && !!p.totals.last && p.totals.last.slice(0, 7) < thisMonth);
      setMapping(Object.fromEntries(p.mapping.map((m) => [m.accId, m.target])));
    } catch {
      toast(t("xaf.err.parse", { detail: "" }), "error");
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  }

  const [runImport, importing] = useAction(importXaf, {
    onDone: (r) => {
      if (r.ok && r.result) {
        setDone(r.result);
        setPreview(null);
        setBlob(null);
      }
    },
  });

  const chartCodes = useMemo(() => new Set(preview?.chart.map((c) => c.code)), [preview]);
  const rows = useMemo(() => {
    if (!preview) return [];
    return preview.mapping.filter((m) => m.usedIn.some((u) => (u === "opening" ? opening : journals.has(u))));
  }, [preview, journals, opening]);

  const rowError = (accId: string): string | null => {
    const m = mapping[accId];
    if (!m) return t("xaf.map.required");
    if (!CODE.test(m.code)) return t("xaf.map.badCode");
    if (m.create && chartCodes.has(m.code)) return t("xaf.map.taken", { code: m.code });
    if (m.create && !m.name.trim()) return t("xaf.map.noName");
    return null;
  };

  if (done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="banner banner-ok">
          <Icon name="CheckCircle" size={17} />
          <div>
            <div style={{ fontWeight: 600 }}>{t("xaf.done.title", { n: fmt.int(done.entries) })}</div>
            <div style={{ fontSize: 13 }}>
              {t("xaf.done.text", { accounts: done.accountsCreated, relations: done.relationsCreated, matched: done.relationsMatched })}
              {done.salesInvoices || done.purchaseInvoices ? ` ${t("xaf.done.invoices", { sales: done.salesInvoices, purchases: done.purchaseInvoices })}` : ""}
              {done.skipped ? ` ${t("xaf.done.skipped", { n: done.skipped })}` : ""}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn-primary" href="/ledger?source=IMPORT&period=all">
            <Icon name="Books" size={16} />
            {t("xaf.done.view")}
          </Link>
          <button className="btn" onClick={() => setDone(null)}>
            {t("xaf.done.another")}
          </button>
        </div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-busy={reading}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void choose(e.dataTransfer.files[0]);
        }}
        style={{
          border: `1.5px dashed ${drag ? "#7a1f3d" : "#cfd4dc"}`,
          background: drag ? "#f9eef2" : "#fafbfc",
          borderRadius: 12,
          padding: "26px 16px",
          textAlign: "center",
          cursor: reading ? "progress" : "pointer",
        }}
      >
        <input ref={input} type="file" accept=".xaf,.xml,application/xml,text/xml" hidden onChange={(e) => void choose(e.target.files?.[0])} />
        <Icon name={reading ? "CircleNotch" : "FileArrowUp"} size={28} className={reading ? "spin" : undefined} />
        <div style={{ fontWeight: 600, marginTop: 8 }}>{reading ? t("xaf.import.reading") : t("xaf.import.drop")}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{t("xaf.import.dropHint")}</div>
      </div>
    );
  }

  const p = preview;
  const blocking = p.problems.filter((x) => x.code === "duplicate" || x.code === "closed" || x.code === "currency" || x.code === "empty" || x.code === "unbalanced");
  const warnings = p.problems.filter((x) => x.code === "totals" || x.code === "openingUnbalanced");
  const problemText = (x: ImportPreview["problems"][number]) => {
    switch (x.code) {
      case "duplicate":
        return t("xaf.problem.duplicate", { date: x.date });
      case "closed":
        return t("xaf.problem.closed", { date: lockedThrough ?? x.date });
      case "unbalanced":
        return t("xaf.problem.unbalanced", { n: x.count });
      case "totals":
        return t("xaf.problem.totals");
      case "openingUnbalanced":
        return t("xaf.problem.openingUnbalanced", { amount: fmt.money(x.cents) });
      case "currency":
        return t("xaf.problem.currency", { currency: x.currency });
      case "empty":
        return t("xaf.problem.empty");
    }
  };
  const errors = rows.map((r) => rowError(r.accId)).filter(Boolean).length;
  const selectedTransactions = p.journals.filter((j) => journals.has(j.id)).reduce((a, j) => a + j.transactions, 0) + (opening && p.opening ? 1 : 0);
  const set = (accId: string, patch: Partial<AccountTarget>) => setMapping((m) => ({ ...m, [accId]: { ...m[accId]!, ...patch } }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <dl className="dl" style={{ margin: 0, padding: "12px 14px", background: "#f9fafb", border: "1px solid #e4e7ec", borderRadius: 10 }}>
        <div>
          <dt>{t("xaf.preview.file")}</dt>
          <dd>{blob?.name}</dd>
        </div>
        <div>
          <dt>{t("xaf.preview.company")}</dt>
          <dd>{p.company.name || "—"}</dd>
        </div>
        <div>
          <dt>{t("xaf.preview.software")}</dt>
          <dd>
            {[p.header.software, p.header.softwareVersion].filter(Boolean).join(" ") || "—"} · XAF {p.version === "unknown" ? "?" : p.version}
          </dd>
        </div>
        <div>
          <dt>{t("xaf.preview.period")}</dt>
          <dd>
            {p.header.startDate} – {p.header.endDate}
          </dd>
        </div>
        <div>
          <dt>{t("xaf.preview.transactions")}</dt>
          <dd className="n">
            {fmt.int(p.totals.transactions)} · {t("xaf.preview.lines", { n: fmt.int(p.totals.lines) })}
          </dd>
        </div>
        <div>
          <dt>{t("xaf.preview.totals")}</dt>
          <dd className="n">
            {fmt.money(p.totals.debit)} / {fmt.money(p.totals.credit)}{" "}
            {p.totals.debit === p.totals.credit ? <Icon name="CheckCircle" size={14} style={{ color: "#157347", verticalAlign: "-2px" }} /> : null}
          </dd>
        </div>
      </dl>

      {blocking.map((x, i) => (
        <div key={`b${i}`} className="banner banner-error">
          <Icon name="WarningCircle" size={17} />
          {problemText(x)}
        </div>
      ))}
      {warnings.map((x, i) => (
        <div key={`w${i}`} className="banner banner-warn">
          <Icon name="Warning" size={17} />
          {problemText(x)}
        </div>
      ))}
      {p.overlap ? (
        <div className="banner banner-warn">
          <Icon name="Warning" size={17} />
          {t("xaf.problem.overlap", { n: fmt.int(p.overlap) })}
        </div>
      ) : null}

      <div>
        <div className="section-label">{t("xaf.preview.what")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {p.opening ? (
            <label style={CHECK}>
              <input type="checkbox" className="checkbox" style={{ marginTop: 3 }} checked={opening} onChange={(e) => setOpening(e.target.checked)} disabled={p.problems.some((x) => x.code === "openingUnbalanced")} />
              <span>
                {t("xaf.preview.opening", { date: p.opening.date, amount: fmt.money(p.opening.total) })}
                {p.opening.openItems ? <span className="muted"> · {t("xaf.preview.openItems", { n: fmt.int(p.opening.openItems) })}</span> : null}
              </span>
            </label>
          ) : null}
          {p.journals.map((j) => (
            <label key={j.id} style={CHECK}>
              <input
                type="checkbox"
                checked={journals.has(j.id)}
                onChange={(e) =>
                  setJournals((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(j.id);
                    else n.delete(j.id);
                    return n;
                  })
                }
              />
              <span>
                {j.desc} <span className="muted">· {t("xaf.preview.journalCount", { n: fmt.int(j.transactions) })}</span>
                {!j.include ? <span className="muted" style={{ display: "block", fontSize: 12.5 }}>{t("xaf.preview.resultJournal")}</span> : null}
              </span>
            </label>
          ))}
          <label style={CHECK}>
            <input type="checkbox" className="checkbox" style={{ marginTop: 3 }} checked={allRelations} onChange={(e) => setAllRelations(e.target.checked)} />
            <span>
              {t("xaf.preview.allRelations", { total: fmt.int(p.relations.total), used: fmt.int(p.relations.used) })}
              {p.relations.matched ? <span className="muted"> · {t("xaf.preview.matched", { n: fmt.int(p.relations.matched) })}</span> : null}
            </span>
          </label>
          <label style={CHECK}>
            <input type="checkbox" className="checkbox" style={{ marginTop: 3 }} checked={invoices} onChange={(e) => setInvoices(e.target.checked)} />
            <span>{t("xaf.preview.invoices")}</span>
          </label>
          {canLock ? (
            <label style={CHECK}>
              <input type="checkbox" className="checkbox" style={{ marginTop: 3 }} checked={lock} onChange={(e) => setLock(e.target.checked)} />
              <span>{t("xaf.preview.lock")}</span>
            </label>
          ) : null}
        </div>
      </div>

      <div className="banner banner-info">
        <Icon name="Info" size={17} />
        <div style={{ fontSize: 13 }}>{t("xaf.preview.notes")}</div>
      </div>

      <div>
        <div className="section-label">{t("xaf.map.title", { n: rows.length })}</div>
        <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>{t("xaf.map.text")}</p>
        <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflowX: "auto" }}>
          <div className="tbl-head" style={{ gridTemplateColumns: "minmax(180px,1.2fr) 110px minmax(320px,1.6fr)", minWidth: 640 }}>
            <span>{t("xaf.map.fileAccount")}</span>
            <span className="right">{t("xaf.map.balance")}</span>
            <span>{t("xaf.map.bookOn")}</span>
          </div>
          {rows.map((r) => {
            const m = mapping[r.accId]!;
            const err = rowError(r.accId);
            return (
              <div key={r.accId} className="tbl-row" style={{ gridTemplateColumns: "minmax(180px,1.2fr) 110px minmax(320px,1.6fr)", minWidth: 640, alignItems: "start" }}>
                <div style={{ minWidth: 0 }}>
                  <div>
                    <span className="n" style={{ fontWeight: 600 }}>{r.accId}</span> {r.desc}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 2 }} className="muted">
                    {t("xaf.map.lines", { n: r.lines })}
                    {r.reason === "control" ? <span className="pill pill-green" style={{ marginLeft: 6 }}>{t("xaf.map.recognised")}</span> : null}
                    {r.reason === "renumbered" ? <span className="pill pill-amber" style={{ marginLeft: 6 }}>{t("xaf.map.renumbered")}</span> : null}
                  </div>
                </div>
                <span className="n right">{fmt.money(r.balance)}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <select
                    className="select"
                    aria-label={t("xaf.map.bookOn")}
                    value={m.create ? "__new" : m.code}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__new") {
                        const orig = p.mapping.find((x) => x.accId === r.accId)!.target;
                        set(r.accId, orig.create ? { ...orig } : { create: true, code: CODE.test(r.accId) && !chartCodes.has(r.accId) ? r.accId : "", name: r.desc.slice(0, 120) });
                      } else {
                        const c = p.chart.find((x) => x.code === v)!;
                        set(r.accId, { create: false, code: c.code, name: c.nameNl, type: c.type });
                      }
                    }}
                  >
                    <option value="__new">{t("xaf.map.newAccount")}</option>
                    {p.chart.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.nameNl}
                      </option>
                    ))}
                  </select>
                  {m.create ? (
                    <div style={{ display: "grid", gridTemplateColumns: "84px minmax(0,1fr) 120px", gap: 6 }}>
                      <input className="input n" aria-label={t("xaf.map.code")} value={m.code} inputMode="numeric" maxLength={6} onChange={(e) => set(r.accId, { code: e.target.value.replace(/\D/g, "") })} />
                      <input className="input" aria-label={t("xaf.map.name")} value={m.name} maxLength={120} onChange={(e) => set(r.accId, { name: e.target.value })} />
                      <select className="select" aria-label={t("xaf.map.type")} value={m.type} onChange={(e) => set(r.accId, { type: e.target.value as AccountType })}>
                        {TYPES.map((ty) => (
                          <option key={ty} value={ty}>
                            {t(`ledger.type.${ty}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  {err ? <div style={{ color: "#b42318", fontSize: 12.5 }}>{err}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn btn-ghost"
          disabled={importing}
          onClick={() => {
            setPreview(null);
            setBlob(null);
          }}
        >
          {t("xaf.import.cancel")}
        </button>
        <button
          className="btn btn-primary"
          disabled={importing || !!blocking.length || !!errors || !selectedTransactions || !blob}
          onClick={() => {
            if (!blob) return;
            const fd = new FormData();
            fd.append("file", blob.data, blob.name);
            fd.append("name", blob.name);
            const used = Object.fromEntries(rows.map((r) => [r.accId, mapping[r.accId]!]));
            fd.append("options", JSON.stringify({ mapping: used, journals: [...journals], opening: opening && !!p.opening, allRelations, invoices, lock }));
            void runImport(fd).then(() => router.refresh());
          }}
        >
          {importing ? <Icon name="CircleNotch" className="spin" /> : <Icon name="UploadSimple" />}
          {importing ? t("xaf.import.importing") : t("xaf.import.go", { n: fmt.int(selectedTransactions) })}
        </button>
      </div>
      {errors ? <div style={{ color: "#b42318", fontSize: 13, textAlign: "right" }}>{t("xaf.map.fix", { n: errors })}</div> : null}
    </div>
  );
}

export function XafExport({ years }: { years: { value: number; label: string }[] }) {
  const { t } = useI18n();
  const [year, setYear] = useState(years[0]?.value ?? new Date().getUTCFullYear());
  return (
    <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <label className="field" style={{ minWidth: 200 }}>
        {t("xaf.export.year")}
        <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y.value} value={y.value}>
              {y.label}
            </option>
          ))}
        </select>
      </label>
      <a className="btn btn-primary" href={`/export/xaf?year=${year}`} download>
        <Icon name="DownloadSimple" size={16} />
        {t("xaf.export.download")}
      </a>
    </div>
  );
}

type HistoryRow = { id: string; when: string; file: string; software: string; company: string; period: string; entries: string; created: string; reversed: string | null };

export function XafHistory({ rows, canReverse }: { rows: HistoryRow[]; canReverse: boolean }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState<HistoryRow | null>(null);
  const [reverse, reversing] = useAction(reverseXafImport, { onDone: (r) => r.ok && setConfirm(null) });
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <div className="tbl-head" style={{ gridTemplateColumns: "100px minmax(200px,1.5fr) minmax(160px,1fr) 90px 130px", minWidth: 720 }}>
          <span>{t("xaf.history.when")}</span>
          <span>{t("xaf.history.file")}</span>
          <span>{t("xaf.history.period")}</span>
          <span className="right">{t("xaf.history.entries")}</span>
          <span />
        </div>
        {rows.map((r) => (
          <div key={r.id} className="tbl-row" style={{ gridTemplateColumns: "100px minmax(200px,1.5fr) minmax(160px,1fr) 90px 130px", minWidth: 720 }}>
            <span className="muted">{r.when}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.file}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {r.company} · {r.software} · {r.created}
              </div>
            </div>
            <span className="muted">{r.period}</span>
            <span className="n right">{r.entries}</span>
            <span className="right">
              {r.reversed ? (
                <span className="pill pill-gray">{t("xaf.history.reversed", { date: r.reversed })}</span>
              ) : canReverse ? (
                <button className="btn btn-ghost btn-danger" onClick={() => setConfirm(r)}>
                  <Icon name="ArrowCounterClockwise" size={16} />
                  {t("xaf.history.reverse")}
                </button>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={t("xaf.history.confirmTitle")}
        footer={
          <>
            <button className="btn" onClick={() => setConfirm(null)}>
              {t("xaf.import.cancel")}
            </button>
            <button className="btn btn-primary btn-danger" disabled={reversing} onClick={() => confirm && reverse(confirm.id)}>
              {reversing ? <Icon name="CircleNotch" className="spin" /> : <Icon name="ArrowCounterClockwise" />}
              {t("xaf.history.reverse")}
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }}>{confirm ? t("xaf.history.confirmText", { file: confirm.file, n: confirm.entries }) : null}</p>
      </Modal>
    </>
  );
}
