import type { PurchaseVatTreatment } from "@prisma/client";
import type { Tx } from "./types";
import { ACC, STOCK_ACCOUNT } from "./chart";
import { exciseForQty, ratesOn } from "./excise";
import { post, PostingError } from "./ledger";
import { receiveStock } from "./stock";
import { isEU, STANDARD_RATE, VAT } from "./vat";

/** Suggest the VAT treatment from the supplier's country. */
export function suggestTreatment(adminCountry: string, supplierCountry: string | null | undefined, goods: boolean): PurchaseVatTreatment {
  const c = (supplierCountry ?? adminCountry).toUpperCase();
  if (c === adminCountry.toUpperCase()) return "DOMESTIC";
  if (isEU(c)) return goods ? "EU_ACQUISITION" : "EU_SERVICES";
  return "IMPORT";
}

export interface PurchaseLineInput {
  description: string;
  productId?: string | null;
  accountCode: string;
  qty: number;
  unitPriceSrcCents: number;
  vatRateBp?: number;
}

/** Recompute base-currency amounts and VAT for a purchase invoice. */
export function calcPurchase(input: { fxRate: number; treatment: PurchaseVatTreatment; lines: PurchaseLineInput[] }) {
  const lines = input.lines.map((l, i) => {
    const amountSrcCents = Math.round(l.qty * l.unitPriceSrcCents);
    const amountCents = Math.round(amountSrcCents * input.fxRate);
    const vatRateBp = input.treatment === "DOMESTIC" ? (l.vatRateBp ?? 0) : 0;
    const vatCents = Math.round((amountCents * vatRateBp) / 10_000);
    return { ...l, productId: l.productId ?? null, amountSrcCents, amountCents, vatRateBp, vatCents, sort: i };
  });
  const net = lines.reduce((a, l) => a + l.amountCents, 0);
  const vat = lines.reduce((a, l) => a + l.vatCents, 0);
  const src = lines.reduce((a, l) => a + l.amountSrcCents + Math.round((l.amountSrcCents * l.vatRateBp) / 10_000), 0);
  return { lines, netCents: net, vatCents: vat, totalCents: net + vat, totalSourceCents: src };
}

/**
 * Approve & book a purchase invoice: stock lines go to the stock account of
 * the destination warehouse (bonded: excise only due on release), costs to
 * their ledger account, VAT by treatment, and the total to accounts payable.
 */
export async function bookPurchase(tx: Tx, input: { administrationId: string; invoiceId: string; userId?: string | null; schedulePayment?: boolean }) {
  const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: input.invoiceId }, include: { lines: { orderBy: { sort: "asc" } } } });
  if (inv.status !== "TO_APPROVE") throw new PostingError("This invoice is already booked.");
  const admin = await tx.administration.findUniqueOrThrow({ where: { id: input.administrationId } });
  const hasStock = inv.lines.some((l) => l.productId);
  const warehouse = inv.warehouseId ? await tx.warehouse.findUnique({ where: { id: inv.warehouseId } }) : null;
  if (hasStock && !warehouse) throw new PostingError("Choose where the goods go before booking.");

  const lines: Parameters<typeof post>[1]["lines"] = [];
  for (const l of inv.lines) {
    const account = l.productId && warehouse ? STOCK_ACCOUNT[warehouse.kind] : l.accountCode;
    lines.push({ account, debit: l.amountCents, description: l.description });
  }
  const net = inv.lines.reduce((a, l) => a + l.amountCents, 0);
  const std = STANDARD_RATE[admin.country] ?? 2100;
  let payable = net;
  switch (inv.vatTreatment) {
    case "DOMESTIC": {
      const vat = inv.lines.reduce((a, l) => a + l.vatCents, 0);
      if (vat) lines.push({ account: ACC.vatReclaim, debit: vat, vatCode: VAT.INPUT });
      payable = net + vat;
      break;
    }
    case "EU_ACQUISITION":
    case "EU_SERVICES":
    case "IMPORT": {
      const code = inv.vatTreatment === "IMPORT" ? VAT.IMPORT : inv.vatTreatment === "EU_SERVICES" ? VAT.EU_SERVICES : VAT.EU_ACQ;
      const vat = Math.round((net * std) / 10_000);
      lines.push({ account: ACC.vatPayable, credit: vat, vatCode: code, vatBase: net });
      lines.push({ account: ACC.vatReclaim, debit: vat, vatCode: VAT.INPUT });
      break;
    }
    case "NONE":
      break;
  }
  lines.push({ account: ACC.payables, credit: payable, relationId: inv.supplierId, description: inv.number });

  const entry = await post(tx, {
    administrationId: admin.id,
    date: inv.issueDate,
    title: `Purchase ${inv.number} · ${inv.supplierName}`,
    source: "PURCHASE",
    sourceId: inv.id,
    createdById: input.userId,
    lines,
  });

  let units = 0;
  let exciseOnRelease = 0;
  if (warehouse) {
    const rates = await ratesOn(tx, admin.country, inv.issueDate);
    for (const l of inv.lines) {
      if (!l.productId || l.qty <= 0) continue;
      const product = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
      await receiveStock(tx, {
        administrationId: admin.id,
        productId: l.productId,
        qty: l.qty,
        warehouseId: warehouse.id,
        unitCostCents: Math.round(l.amountCents / l.qty),
        documentType: "purchase_invoice",
        documentId: inv.id,
        documentRef: inv.number,
        at: inv.issueDate,
        createdById: input.userId,
      });
      units += l.qty;
      if (warehouse.kind !== "DUTY_PAID") exciseOnRelease += exciseForQty(product, rates.get(product.category), l.qty);
    }
  }

  const updated = await tx.purchaseInvoice.update({
    where: { id: inv.id },
    data: {
      status: "BOOKED",
      bookedAt: new Date(),
      journalEntryId: entry.id,
      netCents: net,
      totalCents: payable,
      paymentScheduledAt: input.schedulePayment ? inv.dueDate ?? new Date() : null,
    },
  });
  return { invoice: updated, units, warehouse, exciseOnRelease };
}

export async function registerPurchasePayment(
  tx: Tx,
  input: { administrationId: string; invoiceId: string; amountCents: number; date: Date; bankAccountCode: string; userId?: string | null; sourceId?: string },
) {
  const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: input.invoiceId } });
  if (inv.status === "TO_APPROVE") throw new PostingError("Approve the invoice before booking its payment.");
  const entry = await post(tx, {
    administrationId: input.administrationId,
    date: input.date,
    title: `Payment ${inv.number} · ${inv.supplierName}`,
    source: "BANK",
    sourceId: input.sourceId ?? inv.id,
    createdById: input.userId,
    lines: [
      { account: ACC.payables, debit: input.amountCents, relationId: inv.supplierId, description: inv.number },
      { account: input.bankAccountCode, credit: input.amountCents },
    ],
  });
  const paid = inv.paidCents + input.amountCents;
  await tx.purchaseInvoice.update({ where: { id: inv.id }, data: { paidCents: paid, status: paid >= inv.totalCents ? "PAID" : inv.status } });
  return { entry };
}
