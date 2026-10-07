import "server-only";
import type { Tx } from "@/lib/db";
import { excisePerUnit, ratesOn } from "@/lib/domain/excise";
import { stockLevels, unitsIn } from "@/lib/domain/stock";

export interface ArrivalLine {
  productId: string;
  name: string;
  sku: string;
  fromWarehouseId: string;
  qty: number;
  excisePerUnit: number; // fractional cents, at today's rates
}

/**
 * Units of an import shipment still waiting in an "In transit" location:
 * what its booked purchase invoices received into In transit, minus what was
 * already booked out for this shipment, capped by what is actually there.
 */
export async function pendingArrival(tx: Tx, administrationId: string, shipmentId: string, country: string): Promise<ArrivalLine[]> {
  const invoices = await tx.purchaseInvoice.findMany({
    where: { administrationId, shipmentId, status: { in: ["BOOKED", "PAID"] } },
    select: { id: true },
  });
  if (!invoices.length) return [];
  const transit = await tx.warehouse.findMany({ where: { administrationId, kind: "IN_TRANSIT" }, select: { id: true } });
  if (!transit.length) return [];
  const transitIds = transit.map((w) => w.id);
  const [received, booked] = await Promise.all([
    tx.stockMovement.findMany({
      where: { administrationId, documentType: "purchase_invoice", documentId: { in: invoices.map((i) => i.id) }, toWarehouseId: { in: transitIds } },
      select: { productId: true, toWarehouseId: true, qty: true },
    }),
    tx.stockMovement.findMany({
      where: { administrationId, documentType: "shipment", documentId: shipmentId, fromWarehouseId: { in: transitIds } },
      select: { productId: true, fromWarehouseId: true, qty: true },
    }),
  ]);
  const key = (p: string, w: string) => `${p}|${w}`;
  const want = new Map<string, number>();
  for (const m of received) want.set(key(m.productId, m.toWarehouseId!), (want.get(key(m.productId, m.toWarehouseId!)) ?? 0) + m.qty);
  for (const m of booked) want.set(key(m.productId, m.fromWarehouseId!), (want.get(key(m.productId, m.fromWarehouseId!)) ?? 0) - m.qty);
  const open = [...want].filter(([, q]) => q > 0);
  if (!open.length) return [];
  const levels = await stockLevels(tx, administrationId);
  const products = await tx.product.findMany({ where: { administrationId, id: { in: open.map(([k]) => k.split("|")[0]!) } } });
  const rates = await ratesOn(tx, country, new Date());
  const out: ArrivalLine[] = [];
  for (const [k, q] of open) {
    const [productId, fromWarehouseId] = k.split("|") as [string, string];
    const p = products.find((x) => x.id === productId);
    if (!p) continue;
    const qty = Math.min(q, unitsIn(levels, productId, fromWarehouseId));
    if (qty <= 0) continue;
    out.push({ productId, name: p.name, sku: p.sku, fromWarehouseId, qty, excisePerUnit: excisePerUnit(p, rates.get(p.category)) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Next free SHP-number after the highest existing one. */
export async function nextShipmentRef(tx: Tx, administrationId: string): Promise<string> {
  const refs = await tx.shipment.findMany({ where: { administrationId }, select: { ref: true } });
  let max = 1000;
  for (const r of refs) {
    const m = /^SHP-(\d+)$/i.exec(r.ref);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `SHP-${max + 1}`;
}

export const STAGES = ["BOOKED", "IN_TRANSIT", "AT_CUSTOMS", "ARRIVED"] as const;
