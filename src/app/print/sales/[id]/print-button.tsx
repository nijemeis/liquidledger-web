"use client";
import { useEffect } from "react";
import { Icon } from "@/components/icon";

/** Print toolbar button; opens the print dialog on load when `auto` is set. */
export function PrintButton({ label, auto }: { label: string; auto: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <button className="btn btn-primary" onClick={() => window.print()}>
      <Icon name="Printer" size={16} />
      {label}
    </button>
  );
}
