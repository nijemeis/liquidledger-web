import type { PaidBy } from "@prisma/client";
import type { Tx } from "./types";
import { ACC } from "./chart";
import { CATEGORY_BY_KEY, splitGross } from "./categories";
import { post, PostingError } from "./ledger";
import { STANDARD_RATE, VAT } from "./vat";

/** Tax-free mileage allowance per km (NL 2026), in cents. */
export const MILEAGE_RATE_CENTS = 23;

export const OFFSET_ACCOUNT: Record<PaidBy, string> = { CARD: ACC.card, BANK: ACC.bank, OWN: ACC.claims };

/** VAT overrides a receipt can carry instead of the category default. */
export const VAT_OVERRIDES = {
  EU_SERVICES: { en: "EU service · VAT reverse-charged (box 4b)", nl: "EU-dienst · btw verlegd (rubriek 4b)" },
  FOREIGN_VAT: { en: "Foreign VAT · reclaim via the EU refund portal", nl: "Buitenlandse btw · terugvragen via het EU-teruggaafportaal" },
  NO_VAT: { en: "No VAT on this receipt", nl: "Geen btw op deze bon" },
} as const;

export type ReceiptLine = { account: string; debit: number; credit: number; vatCode?: string; vatBase?: number };

/** The journal lines a receipt will produce ("How it lands in the books"). */
export function receiptLines(r: {
  amountCents: number;
  categoryKey: string | null;
  paidBy: PaidBy;
  vatOverride?: string | null;
  payroll?: unknown;
  country?: string;
}): ReceiptLine[] {
  if (Array.isArray(r.payroll)) {
    return (r.payroll as { account: string; debit: number; credit: number }[]).map((l) => ({ account: l.account, debit: l.debit, credit: l.credit }));
  }
  const c = r.categoryKey ? CATEGORY_BY_KEY[r.categoryKey] : undefined;
  if (!c) return [];
  const offset = OFFSET_ACCOUNT[r.paidBy];
  if (r.vatOverride === "EU_SERVICES") {
    const vat = Math.round((r.amountCents * (STANDARD_RATE[r.country ?? "NL"] ?? 2100)) / 10_000);
    return [
      { account: c.account, debit: r.amountCents, credit: 0 },
      { account: ACC.vatReclaim, debit: vat, credit: 0, vatCode: VAT.INPUT },
      { account: ACC.vatPayable, debit: 0, credit: vat, vatCode: VAT.EU_SERVICES, vatBase: r.amountCents },
      { account: offset, debit: 0, credit: r.amountCents },
    ];
  }
  const { net, vat } = splitGross(r.amountCents, c, r.vatOverride);
  return [
    { account: c.account, debit: net, credit: 0 },
    ...(vat ? [{ account: ACC.vatReclaim, debit: vat, credit: 0, vatCode: VAT.INPUT }] : []),
    { account: offset, debit: 0, credit: r.amountCents },
  ];
}

export async function bookReceipt(tx: Tx, input: { administrationId: string; receiptId: string; userId?: string | null; makeRule?: boolean }) {
  const r = await tx.receipt.findUniqueOrThrow({ where: { id: input.receiptId } });
  if (r.status === "BOOKED") throw new PostingError("This receipt is already booked.");
  if (!r.payroll && !r.categoryKey) throw new PostingError("Pick what it was for first.");
  if (r.paidBy === "OWN" && !r.employeeName) throw new PostingError("Say who paid with their own money.");
  const admin = await tx.administration.findUniqueOrThrow({ where: { id: input.administrationId } });
  const lines = receiptLines({ ...r, country: admin.country });
  const entry = await post(tx, {
    administrationId: admin.id,
    date: r.date,
    title: `${r.payroll ? "Payroll" : "Receipt"} · ${r.supplier} · ${r.description}`,
    source: r.payroll ? "PAYROLL_IMPORT" : "RECEIPT",
    sourceId: r.id,
    createdById: input.userId,
    lines: lines.map((l) => ({
      account: l.account,
      debit: l.debit,
      credit: l.credit,
      vatCode: l.vatCode,
      vatBase: l.vatBase,
      description: l.account === ACC.claims ? r.employeeName : null,
    })),
  });
  let ruleCreated = false;
  if (input.makeRule && r.categoryKey && !r.payroll) {
    const existing = await tx.bookingRule.findFirst({
      where: { administrationId: admin.id, matchType: "supplier", pattern: { equals: r.supplier, mode: "insensitive" } },
    });
    if (existing) {
      await tx.bookingRule.update({ where: { id: existing.id }, data: { categoryKey: r.categoryKey, accountCode: CATEGORY_BY_KEY[r.categoryKey]!.account } });
    } else {
      await tx.bookingRule.create({
        data: {
          administrationId: admin.id,
          matchType: "supplier",
          pattern: r.supplier,
          categoryKey: r.categoryKey,
          accountCode: CATEGORY_BY_KEY[r.categoryKey]!.account,
          createdById: input.userId ?? null,
        },
      });
      ruleCreated = true;
    }
  }
  const updated = await tx.receipt.update({ where: { id: r.id }, data: { status: "BOOKED", bookedAt: new Date(), journalEntryId: entry.id } });
  return { receipt: updated, ruleCreated };
}

/** Suggest a category for a new receipt: booking rules → history → keywords (supplier, then description). */
export async function suggestCategory(tx: Tx, administrationId: string, supplier: string, description?: string | null): Promise<{ categoryKey: string; reason: string; kind: "rule" | "history" | "keyword"; count?: number } | null> {
  const rule = await tx.bookingRule.findFirst({
    where: { administrationId, matchType: "supplier", pattern: { equals: supplier, mode: "insensitive" }, categoryKey: { not: null } },
  });
  if (rule?.categoryKey) return { categoryKey: rule.categoryKey, reason: `Rule: always book ${supplier} this way`, kind: "rule" };
  const history = await tx.receipt.groupBy({
    by: ["categoryKey"],
    where: { administrationId, status: "BOOKED", supplier: { equals: supplier, mode: "insensitive" }, categoryKey: { not: null } },
    _count: true,
    orderBy: { _count: { categoryKey: "desc" } },
    take: 1,
  });
  if (history[0]?.categoryKey) {
    const c = CATEGORY_BY_KEY[history[0].categoryKey];
    return { categoryKey: history[0].categoryKey, reason: `Booked as ${c?.label.en.toLowerCase() ?? "this"} ${history[0]._count} time${history[0]._count === 1 ? "" : "s"} before`, kind: "history", count: history[0]._count };
  }
  // Keyword match on the supplier name, then on the description (whole words).
  for (const text of [supplier, description ?? ""]) {
    const s = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, " ")} `;
    for (const c of Object.values(CATEGORY_BY_KEY)) {
      if (c.importOnly || !c.keywords) continue;
      if (c.keywords.split(" ").some((k) => k.length > 2 && (text === supplier ? s.includes(k) : s.includes(` ${k} `)))) {
        return { categoryKey: c.key, reason: `Looks like ${c.label.en.toLowerCase()}`, kind: "keyword" };
      }
    }
  }
  return null;
}

/**
 * Pay out employee expense claims. Marks the claims as paid and returns the
 * transfers to make; the bank line is booked against 1650 on reconciliation.
 */
export async function payClaims(tx: Tx, input: { administrationId: string; date: Date }) {
  const claims = await tx.receipt.findMany({
    where: { administrationId: input.administrationId, paidBy: "OWN", status: "BOOKED", claimPaidAt: null },
  });
  const per = new Map<string, number>();
  for (const c of claims) per.set(c.employeeName ?? "?", (per.get(c.employeeName ?? "?") ?? 0) + c.amountCents);
  const total = claims.reduce((a, c) => a + c.amountCents, 0);
  if (claims.length) await tx.receipt.updateMany({ where: { id: { in: claims.map((c) => c.id) } }, data: { claimPaidAt: input.date } });
  return { total, people: [...per].map(([name, cents]) => ({ name, cents })) };
}
