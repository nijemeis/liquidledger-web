"use client";
import { useEffect } from "react";

/** Centered dialog styled like the admin prototype's invite modal. */
export function AdminModal({ open, onClose, title, children, footer, width = 460 }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(20,23,31,0.36)", display: "grid", placeItems: "center", padding: 20 }}>
      <div
        role="dialog"
        aria-modal="true"
        className="adm-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: `min(${width}px,100%)`, maxHeight: "calc(100vh - 40px)", overflowY: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 24px 60px rgba(20,23,31,0.25)", padding: 22, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ fontWeight: 600, fontSize: 18 }}>{title}</div>
        {children}
        {footer ? <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4, flexWrap: "wrap" }}>{footer}</div> : null}
      </div>
    </div>
  );
}

/** Choice chip (filled burgundy when selected). */
export function ChoiceChip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", height: 32, padding: "0 11px", borderRadius: 8, border: `1px solid ${on ? "#7a1f3d" : "#d5d9e0"}`, background: on ? "#7a1f3d" : "#fff", color: on ? "#fff" : "#14171f", fontSize: 13, fontWeight: 500 }}
    >
      {children}
    </button>
  );
}
