"use client";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { Icon } from "./icon";

export function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  return (
    <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, padding: 14, background: "#f9fafb" }}>
      <div className="n" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", fontFamily: "ui-monospace, monospace", fontSize: 14 }}>
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          <Icon name={copied ? "Check" : "Copy"} />
          {copied ? t("auth.codesCopied") : t("auth.codesCopy")}
        </button>
        <a className="btn btn-sm" href={`data:text/plain;charset=utf-8,${encodeURIComponent("Liquid Ledger recovery codes\n\n" + text + "\n")}`} download="liquid-ledger-recovery-codes.txt">
          <Icon name="DownloadSimple" />
          {t("auth.codesDownload")}
        </a>
      </div>
    </div>
  );
}
