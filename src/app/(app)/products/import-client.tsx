"use client";
import { useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { Modal, useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { newProductIssues, parseProductSheet, TEMPLATE_CSV, type RowIssue } from "@/lib/domain/product-import";
import { importProducts } from "./actions";

const PREVIEW_ROWS = 200;

/** Statement/CSV files: UTF-8, or Windows-1252 from older Excel versions. */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

export function ImportProductsButton({ existingSkus }: { existingSkus: string[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        <Icon name="UploadSimple" size={16} />
        {t("products.import.button")}
      </button>
      {open ? <ImportModal existingSkus={existingSkus} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ImportModal({ existingSkus, onClose }: { existingSkus: string[]; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [update, setUpdate] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const [run, pending] = useAction(importProducts, { onDone: (r) => r.ok && onClose() });
  const existing = useMemo(() => new Set(existingSkus), [existingSkus]);
  const sheet = useMemo(() => (text.trim() ? parseProductSheet(text) : null), [text]);

  const rows = (sheet?.rows ?? []).map((r) => {
    const exists = existing.has(r.product.sku);
    const extra = !exists && r.product.sku ? newProductIssues(r.product).filter((i) => !r.issues.some((x) => x.code === i.code)) : [];
    const issues = [...r.issues, ...extra];
    const status: "new" | "update" | "skip" | "error" = issues.length ? "error" : exists ? (update ? "update" : "skip") : "new";
    return { ...r, issues, status };
  });
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const importable = count("new") + count("update");

  const fieldLabel = (f: string) => t(`products.import.col.${f}`);
  const issueText = (i: RowIssue) => {
    switch (i.code) {
      case "number":
        return t("products.import.issue.number", { field: fieldLabel(i.field), value: i.value });
      case "price":
        return t("products.import.issue.price", { list: i.list, value: i.value });
      case "category":
        return i.value ? t("products.import.issue.category", { value: i.value }) : t("products.import.issue.noCategory");
      case "volume":
        return i.value ? t("products.import.issue.volume", { value: i.value }) : t("products.import.issue.noVolume");
      case "country":
        return t("products.import.issue.country", { value: i.value });
      case "duplicateSku":
        return t("products.import.issue.duplicateSku", { sku: i.sku });
      default:
        return t(`products.import.issue.${i.code}`);
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob(["﻿" + TEMPLATE_CSV], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "liquid-ledger-products.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={980}
      title={t("products.import.title")}
      footer={
        <>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginRight: "auto", cursor: "pointer" }}>
            <input type="checkbox" className="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
            {t("products.import.update")}
          </label>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" disabled={pending || !importable || !!sheet?.missing.includes("sku")} onClick={() => run({ text, update })}>
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="UploadSimple" size={16} />}
            {t("products.import.submit", { n: fmt.int(importable) })}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t("products.import.text")}</p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => input.current?.click()}>
          <Icon name="FileArrowUp" size={16} />
          {fileName ?? t("products.import.chooseFile")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={downloadTemplate}>
          <Icon name="DownloadSimple" size={16} />
          {t("products.import.template")}
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,.txt,.tsv,text/csv,text/plain"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFileName(f.name);
            setText(await readText(f));
          }}
        />
      </div>
      <textarea
        className="textarea n"
        rows={sheet ? 4 : 9}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFileName(null);
        }}
        placeholder={t("products.import.placeholder")}
        style={{ fontSize: 12.5, whiteSpace: "pre", overflowX: "auto" }}
      />

      {sheet ? (
        <>
          {sheet.missing.length ? (
            <div className="banner banner-error" style={{ fontSize: 13 }}>
              <Icon name="WarningCircle" size={16} />
              {t("products.import.missing", { cols: sheet.missing.map(fieldLabel).join(", ") })}
            </div>
          ) : null}
          {sheet.ignored.length ? (
            <div className="banner banner-warn" style={{ fontSize: 13 }}>
              <Icon name="Warning" size={16} />
              {t("products.import.ignored", { cols: sheet.ignored.join(", ") })}
            </div>
          ) : null}
          <div className="row" style={{ gap: 8, flexWrap: "wrap", fontSize: 13 }}>
            <span className="pill pill-green">{t("products.import.countNew", { n: count("new") })}</span>
            <span className="pill pill-blue">{t("products.import.countUpdate", { n: count("update") })}</span>
            {count("skip") ? <span className="pill pill-gray">{t("products.import.countSkip", { n: count("skip") })}</span> : null}
            {count("error") ? <span className="pill pill-red">{t("products.import.countError", { n: count("error") })}</span> : null}
            <span className="muted">{t("products.import.columns", { cols: [...sheet.columns.fields.map(fieldLabel), ...sheet.columns.priceLists].join(" · ") })}</span>
          </div>
          <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto", maxHeight: 340 }}>
            <div className="tbl-head" style={{ gridTemplateColumns: "44px 110px minmax(160px,1.6fr) 100px 70px 60px minmax(120px,1fr) minmax(160px,1.4fr)", minWidth: 860, position: "sticky", top: 0 }}>
              <span>#</span>
              <span>{fieldLabel("sku")}</span>
              <span>{fieldLabel("name")}</span>
              <span>{fieldLabel("category")}</span>
              <span className="right">{fieldLabel("volume")}</span>
              <span className="right">{fieldLabel("abv")}</span>
              <span>{t("products.import.prices")}</span>
              <span>{t("products.import.status")}</span>
            </div>
            {rows.slice(0, PREVIEW_ROWS).map((r) => (
              <div key={r.line} className="tbl-row" style={{ gridTemplateColumns: "44px 110px minmax(160px,1.6fr) 100px 70px 60px minmax(120px,1fr) minmax(160px,1.4fr)", minWidth: 860, padding: "8px 16px", alignItems: "start", fontSize: 13 }}>
                <span className="muted n">{r.line}</span>
                <span className="n truncate">{r.product.sku || "—"}</span>
                <span className="truncate">{r.product.name ?? "—"}</span>
                <span>{r.product.category ? t(`products.cat${r.product.category}`) : "—"}</span>
                <span className="n right">{r.product.volumeMl ? `${fmt.num(r.product.volumeMl / 1000, 3).replace(/[.,]?0+$/, "")} L` : "—"}</span>
                <span className="n right">{r.product.abvBp !== undefined ? `${fmt.num(r.product.abvBp / 100, 1)}%` : "—"}</span>
                <span className="n" style={{ fontSize: 12 }}>
                  {Object.entries(r.product.prices)
                    .map(([l, c]) => `${l.slice(0, 1)} ${fmt.money(c)}`)
                    .join(" · ") || "—"}
                </span>
                <span style={{ fontSize: 12.5, color: r.status === "error" ? "#b42318" : r.status === "skip" ? "#5b6474" : r.status === "update" ? "#1d4ed8" : "#157347" }}>
                  {t(`products.import.state.${r.status}`)}
                  {r.issues.length ? `: ${r.issues.map(issueText).join("; ")}` : ""}
                </span>
              </div>
            ))}
            {rows.length > PREVIEW_ROWS ? <div className="muted" style={{ padding: "8px 16px", fontSize: 12.5 }}>{t("products.import.more", { n: fmt.int(rows.length - PREVIEW_ROWS) })}</div> : null}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
