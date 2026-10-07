"use client";
import { useState } from "react";
import { Dropdown } from "@/components/client";
import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n/client";

/** "Export for accountant": journal, trial balance and P&L as CSV. */
export function ExportMenu({ from, to, month }: { from: string; to: string; month: string }) {
  const { t } = useI18n();
  const [range, setRange] = useState({ from, to });
  const q = `from=${range.from}&to=${range.to}`;
  return (
    <Dropdown
      width={320}
      trigger={(open, toggle) => (
        <button type="button" className="btn" aria-expanded={open} onClick={toggle}>
          <Icon name="DownloadSimple" size={16} />
          {t("reports.exportBtn")}
          <Icon name="CaretDown" size={14} />
        </button>
      )}
    >
      {(close) => (
        <div style={{ padding: 6, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="menu-label" style={{ padding: 0 }}>{t("reports.exportRange")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label className="field">
              <span className="field-label">{t("reports.from")}</span>
              <input type="date" className="input" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            </label>
            <label className="field">
              <span className="field-label">{t("reports.to")}</span>
              <input type="date" className="input" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            </label>
          </div>
          <div className="divider" />
          <a className="menu-item" href={`/export/journal?${q}`} download onClick={close}>
            <Icon name="Books" size={16} />
            <span style={{ flex: 1 }}>
              {t("reports.exportJournal")}
              <span className="cell-sub" style={{ display: "block" }}>{t("reports.exportJournalSub")}</span>
            </span>
          </a>
          <a className="menu-item" href={`/export/trial-balance?${q}`} download onClick={close}>
            <Icon name="Scales" size={16} />
            <span style={{ flex: 1 }}>
              {t("reports.exportTb")}
              <span className="cell-sub" style={{ display: "block" }}>{t("reports.exportTbSub")}</span>
            </span>
          </a>
          <a className="menu-item" href={`/export/pnl?month=${month}`} download onClick={close}>
            <Icon name="ChartLineUp" size={16} />
            <span style={{ flex: 1 }}>
              {t("reports.exportPnl")}
              <span className="cell-sub" style={{ display: "block" }}>{t("reports.exportPnlSub")}</span>
            </span>
          </a>
        </div>
      )}
    </Dropdown>
  );
}
