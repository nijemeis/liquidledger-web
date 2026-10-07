import type { Product, TaxRegime } from "@prisma/client";
import type { Tx } from "./types";
import { ACC, REVENUE_ACCOUNT, STOCK_ACCOUNT } from "./chart";
import { exciseForQty, exciseFormula, ratesOn, type RateRow } from "./excise";
import { nextNumber, post, PostingError } from "./ledger";
import { stockLevels, unitsIn } from "./stock";
import { DOMESTIC_RATE, salesVatCode, STANDARD_RATE, VAT } from "./vat";

// Sales tax engine (DOMAIN_AND_DATA.md §5–6):
//  · Domestic: excise per bottle; VAT over price + excise + deposit.
//  · EU B2B: shipped duty-suspended under EMCS → no excise; VAT reverse-charged (ICP, box 3b).
//  · Export: no excise; VAT 0% (box 3a); export declaration drafted.

export interface CalcLineInput {
  product: Pick<Product, "id" | "name" | "sku" | "category" | "volumeMl" | "abvBp" | "platoTenths" | "depositCents">;
  qtyUnits: number;
  unitPriceCents: number;
}

export interface CalcLine {
  productId: string;
  description: string;
  qtyUnits: number;
  unitPriceCents: number;
  netCents: number;
  exciseCents: number;
  exciseFormula: string;
  depositCents: number;
  vatRateBp: number;
  vatCode: string;
  vatCents: number;
}

export function calcInvoice(input: { country: string; regime: TaxRegime; lines: CalcLineInput[]; rates: Map<string, RateRow> }) {
  const { country, regime } = input;
  const domestic = regime === "DOMESTIC";
  const lines: CalcLine[] = input.lines.map((l) => {
    const netCents = Math.round(l.qtyUnits * l.unitPriceCents);
    const rate = input.rates.get(l.product.category);
    const exciseCents = domestic ? exciseForQty(l.product, rate, l.qtyUnits) : 0;
    const depositCents = domestic ? l.qtyUnits * l.product.depositCents : 0;
    const vatRateBp = domestic ? (DOMESTIC_RATE[country]?.[l.product.category] ?? STANDARD_RATE[country] ?? 2100) : 0;
    const vatCents = Math.round(((netCents + exciseCents + depositCents) * vatRateBp) / 10_000);
    return {
      productId: l.product.id,
      description: l.product.name,
      qtyUnits: l.qtyUnits,
      unitPriceCents: l.unitPriceCents,
      netCents,
      exciseCents,
      exciseFormula: domestic ? exciseFormula(l.product, rate, l.qtyUnits) : "not charged",
      depositCents,
      vatRateBp,
      vatCode: salesVatCode(regime, vatRateBp, country),
      vatCents,
    };
  });
  const sum = (k: keyof Pick<CalcLine, "netCents" | "exciseCents" | "depositCents" | "vatCents">) => lines.reduce((a, l) => a + l[k], 0);
  const net = sum("netCents");
  const excise = sum("exciseCents");
  const deposit = sum("depositCents");
  const vat = sum("vatCents");
  return { lines, netCents: net, exciseCents: excise, depositCents: deposit, vatCents: vat, totalCents: net + excise + deposit + vat };
}

export interface DraftInput {
  administrationId: string;
  invoiceId?: string | null;
  customerId: string;
  issueDate: Date;
  dueDate?: Date | null;
  warehouseId?: string | null;
  reference?: string | null;
  notes?: string | null;
  regime: TaxRegime;
  lines: { productId: string; qtyUnits: number; unitPriceCents: number }[];
  createdById?: string | null;
}

/** Create or update a draft; totals are always derived server-side. */
export async function saveDraft(tx: Tx, input: DraftInput) {
  const [admin, customer] = await Promise.all([
    tx.administration.findUniqueOrThrow({ where: { id: input.administrationId } }),
    tx.relation.findUniqueOrThrow({ where: { id: input.customerId } }),
  ]);
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await tx.product.findMany({ where: { id: { in: productIds } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const rates = await ratesOn(tx, admin.country, input.issueDate);
  const calc = calcInvoice({
    country: admin.country,
    regime: input.regime,
    rates,
    lines: input.lines
      .filter((l) => l.qtyUnits > 0 && byId.has(l.productId))
      .map((l) => ({ product: byId.get(l.productId)!, qtyUnits: l.qtyUnits, unitPriceCents: l.unitPriceCents })),
  });
  if (!calc.lines.length) throw new PostingError("Add at least one line.");
  const dueDate = input.dueDate ?? new Date(input.issueDate.getTime() + customer.paymentTermsDays * 86400_000);
  const data = {
    customerId: customer.id,
    issueDate: input.issueDate,
    dueDate,
    taxRegime: input.regime,
    warehouseId: input.warehouseId ?? null,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    netCents: calc.netCents,
    exciseCents: calc.exciseCents,
    depositCents: calc.depositCents,
    vatCents: calc.vatCents,
    totalCents: calc.totalCents,
  };
  const lineData = calc.lines.map((l, i) => ({ ...l, administrationId: input.administrationId, sort: i }));
  if (input.invoiceId) {
    const existing = await tx.salesInvoice.findUniqueOrThrow({ where: { id: input.invoiceId } });
    if (existing.status !== "DRAFT") throw new PostingError("Only drafts can be edited. Credit the invoice instead.");
    await tx.salesInvoiceLine.deleteMany({ where: { invoiceId: existing.id } });
    return tx.salesInvoice.update({ where: { id: existing.id }, data: { ...data, lines: { create: lineData } }, include: { lines: true } });
  }
  return tx.salesInvoice.create({
    data: { ...data, administrationId: input.administrationId, createdById: input.createdById ?? null, lines: { create: lineData } },
    include: { lines: true },
  });
}

/** Preview the next invoice number without consuming it. */
export async function peekInvoiceNumber(tx: Tx, administrationId: string, year: number, prefix: string) {
  const seq = await tx.sequence.findUnique({ where: { administrationId_name: { administrationId, name: `sales:${year}` } } });
  return formatInvoiceNumber(prefix, year, seq?.next ?? 1);
}

export function formatInvoiceNumber(prefix: string, year: number, n: number) {
  return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}

/**
 * Finalise a draft: assign the next sequential number, post the journal entry,
 * move stock (releasing excise from bonded stock for domestic sales) and draft
 * customs documents for EU and export shipments.
 */
export async function sendInvoice(tx: Tx, input: { administrationId: string; invoiceId: string; userId?: string | null }) {
  const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: input.invoiceId }, include: { lines: true } });
  if (inv.status !== "DRAFT") throw new PostingError("This invoice was already sent.");
  const [admin, customer] = await Promise.all([
    tx.administration.findUniqueOrThrow({ where: { id: input.administrationId } }),
    tx.relation.findUniqueOrThrow({ where: { id: inv.customerId } }),
  ]);
  const warehouses = await tx.warehouse.findMany({ where: { administrationId: admin.id, archivedAt: null } });
  const wh =
    warehouses.find((w) => w.id === inv.warehouseId) ??
    (inv.taxRegime === "DOMESTIC" ? warehouses.find((w) => w.kind === "DUTY_PAID") : undefined) ??
    warehouses.find((w) => w.kind === "BONDED") ??
    warehouses[0];
  if (!wh) throw new PostingError("Add a warehouse before sending invoices.");
  const fromBond = wh.kind !== "DUTY_PAID";

  // Re-derive everything at send time.
  const products = await tx.product.findMany({ where: { id: { in: inv.lines.map((l) => l.productId!).filter(Boolean) } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const levels = await stockLevels(tx, admin.id);
  const need = new Map<string, number>();
  for (const l of inv.lines) if (l.productId) need.set(l.productId, (need.get(l.productId) ?? 0) + l.qtyUnits);
  for (const [pid, qty] of need) {
    const have = unitsIn(levels, pid, wh.id);
    if (have < qty) throw new PostingError(`Not enough stock of ${byId.get(pid)?.name ?? "product"} in ${wh.name}: ${have} available, ${qty} needed.`);
  }

  const year = inv.issueDate.getUTCFullYear();
  const n = await nextNumber(tx, admin.id, `sales:${year}`);
  const number = formatInvoiceNumber(admin.invoicePrefix, year, n);

  // Journal lines.
  const lines: Parameters<typeof post>[1]["lines"] = [];
  lines.push({ account: ACC.receivables, debit: inv.totalCents, relationId: customer.id, description: number });
  const revenue = new Map<string, number>();
  let cogs = 0;
  for (const l of inv.lines) {
    const p = l.productId ? byId.get(l.productId) : undefined;
    const acc = p ? REVENUE_ACCOUNT[p.category] : "8090";
    revenue.set(acc, (revenue.get(acc) ?? 0) + l.netCents);
    if (p) cogs += p.costCents * l.qtyUnits;
  }
  const zeroCode = inv.taxRegime === "EU_B2B" ? VAT.ICP : inv.taxRegime === "EXPORT" ? VAT.EXPORT : null;
  for (const [acc, amt] of revenue) {
    lines.push({ account: acc, credit: amt, ...(zeroCode ? { vatCode: zeroCode, vatBase: amt, relationId: customer.id } : {}) });
  }
  if (inv.exciseCents) lines.push({ account: fromBond ? ACC.excisePayable : ACC.prepaidExcise, credit: inv.exciseCents });
  if (inv.depositCents) lines.push({ account: ACC.deposits, credit: inv.depositCents });
  const vatByCode = new Map<string, { vat: number; base: number }>();
  for (const l of inv.lines) {
    if (!l.vatCents && inv.taxRegime !== "DOMESTIC") continue;
    const cur = vatByCode.get(l.vatCode) ?? { vat: 0, base: 0 };
    cur.vat += l.vatCents;
    cur.base += l.netCents + l.exciseCents + l.depositCents;
    vatByCode.set(l.vatCode, cur);
  }
  for (const [code, v] of vatByCode) lines.push({ account: ACC.vatPayable, credit: v.vat, vatCode: code, vatBase: v.base });
  if (cogs) lines.push({ account: ACC.cogs, debit: cogs }, { account: STOCK_ACCOUNT[wh.kind], credit: cogs });

  const entry = await post(tx, {
    administrationId: admin.id,
    date: inv.issueDate,
    title: `Sales ${number} · ${customer.name}`,
    source: "SALES",
    sourceId: inv.id,
    createdById: input.userId,
    lines,
  });

  // Stock out; domestic sales from bond are releases for consumption.
  for (const l of inv.lines) {
    if (!l.productId) continue;
    const p = byId.get(l.productId)!;
    await tx.stockMovement.create({
      data: {
        administrationId: admin.id,
        productId: p.id,
        fromWarehouseId: wh.id,
        qty: l.qtyUnits,
        reason: "SALE",
        unitCostCents: p.costCents,
        exciseReleased: inv.taxRegime === "DOMESTIC" && fromBond && l.exciseCents > 0,
        exciseCents: inv.taxRegime === "DOMESTIC" && fromBond ? l.exciseCents : 0,
        documentType: "sales_invoice",
        documentId: inv.id,
        documentRef: number,
        at: inv.issueDate,
        createdById: input.userId ?? null,
      },
    });
  }

  let customsDoc: string | null = null;
  if (inv.taxRegime === "EU_B2B" || inv.taxRegime === "EXPORT") {
    const type = inv.taxRegime === "EU_B2B" ? "E_AD" : "EXPORT_DECLARATION";
    await tx.customsDocument.create({
      data: { administrationId: admin.id, type, salesInvoiceId: inv.id, status: "DRAFT", notes: `Drafted from ${number} · ${customer.name}` },
    });
    customsDoc = type;
  }

  const updated = await tx.salesInvoice.update({
    where: { id: inv.id },
    data: { number, status: "OPEN", sentAt: new Date(), journalEntryId: entry.id, warehouseId: wh.id },
  });
  return { invoice: updated, customer, customsDoc, warehouse: wh };
}

/** Book an incoming payment against an invoice (bank reconciliation). */
export async function registerSalesPayment(
  tx: Tx,
  input: { administrationId: string; invoiceId: string; amountCents: number; date: Date; bankAccountCode: string; userId?: string | null; sourceId?: string },
) {
  const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: input.invoiceId } });
  if (inv.status === "DRAFT") throw new PostingError("Send the invoice before booking payments.");
  const entry = await post(tx, {
    administrationId: input.administrationId,
    date: input.date,
    title: `Payment ${inv.number}`,
    source: "BANK",
    sourceId: input.sourceId ?? inv.id,
    createdById: input.userId,
    lines: [
      { account: input.bankAccountCode, debit: input.amountCents },
      { account: ACC.receivables, credit: input.amountCents, relationId: inv.customerId, description: inv.number },
    ],
  });
  const paid = inv.paidCents + input.amountCents;
  const full = paid >= inv.totalCents;
  await tx.salesInvoice.update({
    where: { id: inv.id },
    data: { paidCents: paid, status: full ? "PAID" : inv.status, paidAt: full ? input.date : null },
  });
  return { entry, remaining: Math.max(0, inv.totalCents - paid), full };
}

/** Days overdue (0 when not overdue). */
export function daysOverdue(inv: { status: string; dueDate: Date }, today = new Date()): number {
  if (inv.status !== "OPEN") return 0;
  const d = Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - inv.dueDate.getTime()) / 86400_000);
  return d > 0 ? d : 0;
}

/** Unit price for a customer: their default price list, else Horeca, else the first list. */
export function listPriceFor(prices: { list: string; unitPriceCents: number; validFrom?: Date }[], list?: string | null): number {
  const pick = (l: string) =>
    prices
      .filter((p) => p.list.toLowerCase() === l.toLowerCase())
      .sort((a, b) => (b.validFrom?.getTime() ?? 0) - (a.validFrom?.getTime() ?? 0))[0];
  return (list ? pick(list) : undefined)?.unitPriceCents ?? pick("Horeca")?.unitPriceCents ?? prices[0]?.unitPriceCents ?? 0;
}

export const isCreditNote = (inv: { totalCents: number; number?: string | null }) => inv.totalCents < 0 || Boolean(inv.number?.startsWith("CN-"));

/**
 * Credit a sent invoice in full. Creates a numbered credit note (CN-yyyy-nnnn)
 * that mirrors the invoice, posts the mirror image of the sales entry (revenue,
 * VAT, excise, deposit, cost of sales), returns the goods to the warehouse they
 * left from and voids customs documents still in draft. Both documents end up
 * CREDITED. History is never edited.
 */
export async function creditInvoice(tx: Tx, input: { administrationId: string; invoiceId: string; date: Date; userId?: string | null; reason?: string | null }) {
  const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: input.invoiceId }, include: { lines: { orderBy: { sort: "asc" } } } });
  if (inv.status === "DRAFT") throw new PostingError("Drafts aren't booked yet. Delete the draft instead.");
  if (inv.status === "CREDITED") throw new PostingError("This invoice has already been credited.");
  if (isCreditNote(inv)) throw new PostingError("A credit note can't be credited.");
  if (!inv.journalEntryId) throw new PostingError("This invoice has no journal entry to reverse.");
  const [customer, original] = await Promise.all([
    tx.relation.findUniqueOrThrow({ where: { id: inv.customerId } }),
    tx.journalEntry.findUniqueOrThrow({ where: { id: inv.journalEntryId }, include: { lines: true } }),
  ]);
  const year = input.date.getUTCFullYear();
  const n = await nextNumber(tx, input.administrationId, `credit:${year}`);
  const number = formatInvoiceNumber("CN", year, n);

  const cn = await tx.salesInvoice.create({
    data: {
      administrationId: input.administrationId,
      number,
      customerId: inv.customerId,
      issueDate: input.date,
      dueDate: input.date,
      taxRegime: inv.taxRegime,
      status: "CREDITED",
      currency: inv.currency,
      warehouseId: inv.warehouseId,
      netCents: -inv.netCents,
      exciseCents: -inv.exciseCents,
      depositCents: -inv.depositCents,
      vatCents: -inv.vatCents,
      totalCents: -inv.totalCents,
      reference: inv.number,
      notes: input.reason ?? null,
      sentAt: new Date(),
      createdById: input.userId ?? null,
      lines: {
        create: inv.lines.map((l) => ({
          administrationId: input.administrationId,
          productId: l.productId,
          description: l.description,
          qtyUnits: -l.qtyUnits,
          unitPriceCents: l.unitPriceCents,
          netCents: -l.netCents,
          exciseCents: -l.exciseCents,
          exciseFormula: l.exciseFormula,
          depositCents: -l.depositCents,
          vatRateBp: l.vatRateBp,
          vatCode: l.vatCode,
          vatCents: -l.vatCents,
          sort: l.sort,
        })),
      },
    },
  });

  const entry = await post(tx, {
    administrationId: input.administrationId,
    date: input.date,
    title: `Credit note ${number} · ${inv.number} · ${customer.name}`,
    source: "SALES",
    sourceId: cn.id,
    reversalOfId: original.id,
    createdById: input.userId,
    lines: original.lines.map((l) => ({
      account: l.accountCode,
      debit: l.creditCents,
      credit: l.debitCents,
      vatCode: l.vatCode,
      vatBase: l.vatBaseCents ? -l.vatBaseCents : null,
      relationId: l.relationId,
      description: l.accountCode === ACC.receivables ? number : l.description,
    })),
  });

  // Goods back into the warehouse they left from.
  const moves = await tx.stockMovement.findMany({
    where: { administrationId: input.administrationId, documentType: "sales_invoice", documentId: inv.id, reason: "SALE" },
  });
  let units = 0;
  for (const m of moves) {
    if (!m.fromWarehouseId) continue;
    await tx.stockMovement.create({
      data: {
        administrationId: input.administrationId,
        productId: m.productId,
        toWarehouseId: m.fromWarehouseId,
        qty: m.qty,
        reason: "SALE",
        unitCostCents: m.unitCostCents,
        // Excise released by the sale is credited on the excise return.
        exciseReleased: m.exciseReleased,
        exciseCents: m.exciseReleased ? -m.exciseCents : 0,
        documentType: "sales_credit",
        documentId: cn.id,
        documentRef: number,
        note: `Returned · credit note ${number} for ${inv.number}`,
        at: input.date,
        createdById: input.userId ?? null,
      },
    });
    units += m.qty;
  }

  const voided = await tx.customsDocument.updateMany({
    where: { administrationId: input.administrationId, salesInvoiceId: inv.id, status: "DRAFT" },
    data: { status: "REJECTED", notes: `Cancelled · ${inv.number} credited by ${number}` },
  });

  await tx.salesInvoice.update({ where: { id: cn.id }, data: { journalEntryId: entry.id } });
  const updated = await tx.salesInvoice.update({ where: { id: inv.id }, data: { status: "CREDITED" } });
  return { invoice: updated, creditNote: { ...cn, journalEntryId: entry.id }, units, customsVoided: voided.count, refundCents: inv.paidCents };
}
