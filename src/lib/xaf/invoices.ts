import type { AccountType } from "@prisma/client";
import { ACC } from "@/lib/domain/chart";

// Recognises sales and purchase invoices among imported transactions, so they
// show up in the Sales and Purchases screens (and open ones can be matched to
// bank payments later). The bookings themselves are the imported journal
// entries; these records only describe them. Pure: no database access.

export interface MappedLine {
  account: string; // our account code
  amount: number; // signed cents, debit > 0
  relationId: string | null;
  desc: string;
  ref: string; // invoice reference (invRef, else docRef)
}

export interface InvoiceLineDraft {
  description: string;
  account: string;
  netCents: number; // revenue for sales (positive = invoiced), cost for purchases (positive = charged)
}

export interface InvoiceDraft {
  kind: "sales" | "purchase";
  relationId: string;
  number: string;
  netCents: number;
  vatCents: number;
  totalCents: number;
  lines: InvoiceLineDraft[];
}

const VAT_ACCOUNTS = new Set<string>([ACC.vatPayable, ACC.vatReclaim]);

/**
 * A transaction is a sales invoice when it books on receivables for one
 * relation together with revenue; a purchase invoice when it books on payables
 * for one relation together with costs or assets. Payments (bank ↔ receivables
 * or payables only) and anything that doesn't add up are left alone.
 */
export function invoiceFromTransaction(lines: MappedLine[], typeOf: (code: string) => AccountType | undefined): InvoiceDraft | null {
  const ar = lines.filter((l) => l.account === ACC.receivables);
  const ap = lines.filter((l) => l.account === ACC.payables);
  if (ar.length && ap.length) return null;
  const control = ar.length ? ar : ap;
  if (!control.length) return null;
  const relations = new Set(control.map((l) => l.relationId));
  if (relations.size !== 1 || !control[0]!.relationId) return null;
  const refs = new Set(control.map((l) => l.ref).filter(Boolean));
  if (refs.size !== 1) return null;
  if (lines.some((l) => l.account === ACC.bank)) return null;

  const kind = ar.length ? "sales" : "purchase";
  const rest = lines.filter((l) => l.account !== ACC.receivables && l.account !== ACC.payables);
  const vat = rest.filter((l) => VAT_ACCOUNTS.has(l.account));
  const other = rest.filter((l) => !VAT_ACCOUNTS.has(l.account));
  if (!other.length) return null;
  if (kind === "sales" && !other.some((l) => typeOf(l.account) === "REVENUE")) return null;
  if (kind === "purchase" && !other.some((l) => typeOf(l.account) === "COST" || typeOf(l.account) === "ASSET")) return null;

  // Sales: revenue is credit, so flip signs; purchases: costs are debit.
  const sign = kind === "sales" ? -1 : 1;
  const draftLines = other.map((l) => ({ description: l.desc, account: l.account, netCents: sign * l.amount }));
  const netCents = draftLines.reduce((a, l) => a + l.netCents, 0);
  const vatCents = sign * vat.reduce((a, l) => a + l.amount, 0);
  const totalCents = -sign * control.reduce((a, l) => a + l.amount, 0);
  if (netCents + vatCents !== totalCents) return null;
  return { kind, relationId: control[0]!.relationId!, number: [...refs][0]!, netCents, vatCents, totalCents, lines: draftLines };
}

/** VAT rate (basis points) implied by net and VAT, snapped to the usual Dutch rates when close. */
export function impliedRateBp(netCents: number, vatCents: number): number {
  if (!netCents || !vatCents) return 0;
  const bp = Math.round((vatCents / netCents) * 10_000);
  for (const r of [2100, 900, 600, 1900]) if (Math.abs(bp - r) <= 15) return r;
  return Math.max(0, bp);
}

/** Spread the invoice VAT over its lines by net amount; the last line takes the rounding. */
export function spreadVat(lines: { netCents: number }[], vatCents: number): number[] {
  const net = lines.reduce((a, l) => a + l.netCents, 0);
  if (!net) return lines.map((_, i) => (i === lines.length - 1 ? vatCents : 0));
  let left = vatCents;
  return lines.map((l, i) => {
    if (i === lines.length - 1) return left;
    const v = Math.round((vatCents * l.netCents) / net);
    left -= v;
    return v;
  });
}
