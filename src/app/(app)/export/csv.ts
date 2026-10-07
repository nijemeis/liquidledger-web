import "server-only";
import { getAppContext, tenant, type AppContext } from "@/lib/app-context";
import { canView, type Permission } from "@/lib/permissions";
import type { Tx } from "@/lib/db";

// CSV exports for the accountant. Dutch users get `;` and a decimal comma (what
// Excel expects with NL regional settings); everyone else `,` and a dot.
// UTF-8 with BOM so Excel detects the encoding.

export type Cell = string | number | null | undefined;

export interface CsvFormat {
  sep: string;
  /** Cents → "1234,56" / "1234.56" (no thousands separator, so it stays numeric). */
  money: (cents: number | null | undefined) => string;
  num: (n: number, decimals: number) => string;
  date: (d: Date | null | undefined) => string;
}

export function csvFormat(locale: string): CsvFormat {
  const comma = locale === "nl";
  const fix = (s: string) => (comma ? s.replace(".", ",") : s);
  return {
    sep: comma ? ";" : ",",
    money: (c) => (c === null || c === undefined ? "" : fix((c / 100).toFixed(2))),
    num: (n, d) => fix(n.toFixed(d)),
    date: (d) => (d ? d.toISOString().slice(0, 10) : ""),
  };
}

function escape(v: Cell, sep: string): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formulas in free-text cells (CSV injection).
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  if (s.includes(sep) || s.includes('"') || s.includes("\n") || s.includes("\r")) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows: Cell[][], sep: string): string {
  return "﻿" + rows.map((r) => r.map((c) => escape(c, sep)).join(sep)).join("\r\n") + "\r\n";
}

export function csvResponse(filename: string, rows: Cell[][], sep: string): Response {
  return new Response(toCsv(rows, sep), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Signed-in, may view `perm`; runs `fn` in the tenant transaction. */
export async function withExport(perm: Permission, fn: (ctx: AppContext, tx: Tx, f: CsvFormat) => Promise<Response>): Promise<Response> {
  const ctx = await getAppContext();
  if (!ctx) return new Response("Not signed in", { status: 401 });
  if (!canView(ctx.role, perm)) return new Response("Not allowed", { status: 403 });
  const f = csvFormat(ctx.locale);
  return tenant(ctx, (tx) => fn(ctx, tx, f));
}

/** "2026-09-30" → Date at UTC midnight, or null. */
export function parseDay(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}
