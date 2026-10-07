import type { StockReason, WarehouseKind } from "@prisma/client";
import type { Tx } from "./types";
import { ACC, STOCK_ACCOUNT } from "./chart";
import { exciseForQty, ratesOn } from "./excise";
import { post, PostingError } from "./ledger";

export type StockLevels = Map<string, Map<string, number>>; // productId → warehouseId → units

/** Current units per product per warehouse (sum of movements). */
export async function stockLevels(tx: Tx, administrationId: string, at?: Date): Promise<StockLevels> {
  const until = at ?? new Date("9999-12-31");
  const rows = await tx.$queryRaw<{ product_id: string; warehouse_id: string; qty: bigint }[]>`
    SELECT product_id, warehouse_id, SUM(qty)::bigint AS qty FROM (
      SELECT product_id, to_warehouse_id AS warehouse_id, qty FROM stock_movements
        WHERE administration_id = ${administrationId} AND to_warehouse_id IS NOT NULL AND at <= ${until}
      UNION ALL
      SELECT product_id, from_warehouse_id AS warehouse_id, -qty FROM stock_movements
        WHERE administration_id = ${administrationId} AND from_warehouse_id IS NOT NULL AND at <= ${until}
    ) m GROUP BY product_id, warehouse_id`;
  const map: StockLevels = new Map();
  for (const r of rows) {
    if (!map.has(r.product_id)) map.set(r.product_id, new Map());
    map.get(r.product_id)!.set(r.warehouse_id, Number(r.qty));
  }
  return map;
}

export function unitsIn(levels: StockLevels, productId: string, warehouseId?: string): number {
  const w = levels.get(productId);
  if (!w) return 0;
  if (warehouseId) return w.get(warehouseId) ?? 0;
  let n = 0;
  for (const v of w.values()) n += v;
  return n;
}

export class StockError extends PostingError {}

async function ensureAvailable(tx: Tx, administrationId: string, productId: string, warehouseId: string, qty: number, label: string) {
  const levels = await stockLevels(tx, administrationId);
  const have = unitsIn(levels, productId, warehouseId);
  if (have < qty) throw new StockError(`Not enough stock of ${label}: ${have} available, ${qty} needed.`);
}

interface MoveBase {
  administrationId: string;
  productId: string;
  qty: number;
  at?: Date;
  createdById?: string | null;
  note?: string | null;
}

/**
 * Move stock between warehouses. Bonded → duty paid is a release for
 * consumption: excise becomes payable and is held as prepaid excise on the
 * duty-paid stock until it's sold. In transit → bonded/duty paid is an arrival.
 */
export async function transferStock(tx: Tx, input: MoveBase & { fromWarehouseId: string; toWarehouseId: string; country: string }) {
  if (input.qty <= 0) throw new StockError("Quantity must be positive.");
  const [product, from, to] = await Promise.all([
    tx.product.findUniqueOrThrow({ where: { id: input.productId } }),
    tx.warehouse.findUniqueOrThrow({ where: { id: input.fromWarehouseId } }),
    tx.warehouse.findUniqueOrThrow({ where: { id: input.toWarehouseId } }),
  ]);
  if (from.id === to.id) throw new StockError("Pick two different locations.");
  await ensureAvailable(tx, input.administrationId, product.id, from.id, input.qty, product.name);
  const at = input.at ?? new Date();
  const release = from.kind !== "DUTY_PAID" && to.kind === "DUTY_PAID";
  let exciseCents = 0;
  if (release) {
    const rates = await ratesOn(tx, input.country, at);
    exciseCents = exciseForQty(product, rates.get(product.category), input.qty);
  }
  const mv = await tx.stockMovement.create({
    data: {
      administrationId: input.administrationId,
      productId: product.id,
      fromWarehouseId: from.id,
      toWarehouseId: to.id,
      qty: input.qty,
      reason: release ? "RELEASE_FOR_CONSUMPTION" : "TRANSFER",
      unitCostCents: product.costCents,
      exciseReleased: release && exciseCents > 0,
      exciseCents,
      at,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
  });
  const value = product.costCents * input.qty;
  const fromAcc = STOCK_ACCOUNT[from.kind];
  const toAcc = STOCK_ACCOUNT[to.kind];
  const lines = [] as { account: string; debit?: number; credit?: number }[];
  if (fromAcc !== toAcc && value) lines.push({ account: toAcc, debit: value }, { account: fromAcc, credit: value });
  if (exciseCents) lines.push({ account: ACC.prepaidExcise, debit: exciseCents }, { account: ACC.excisePayable, credit: exciseCents });
  if (lines.length) {
    await post(tx, {
      administrationId: input.administrationId,
      date: at,
      title: `${release ? "Release for consumption" : "Stock transfer"} · ${input.qty} × ${product.name} · ${from.name} → ${to.name}`,
      source: "STOCK",
      sourceId: mv.id,
      createdById: input.createdById,
      lines,
    });
  }
  return { movement: mv, exciseCents, release };
}

/** Bottles taken as samples. From bonded stock they still owe excise. */
export async function takeSample(tx: Tx, input: MoveBase & { warehouseId: string; country: string }) {
  if (input.qty <= 0) throw new StockError("Quantity must be positive.");
  const [product, wh] = await Promise.all([
    tx.product.findUniqueOrThrow({ where: { id: input.productId } }),
    tx.warehouse.findUniqueOrThrow({ where: { id: input.warehouseId } }),
  ]);
  await ensureAvailable(tx, input.administrationId, product.id, wh.id, input.qty, product.name);
  const at = input.at ?? new Date();
  const bonded = wh.kind !== "DUTY_PAID";
  const rates = await ratesOn(tx, input.country, at);
  const exciseCents = bonded ? exciseForQty(product, rates.get(product.category), input.qty) : 0;
  const mv = await tx.stockMovement.create({
    data: {
      administrationId: input.administrationId,
      productId: product.id,
      fromWarehouseId: wh.id,
      qty: input.qty,
      reason: "SAMPLE",
      unitCostCents: product.costCents,
      exciseReleased: exciseCents > 0,
      exciseCents,
      at,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
  });
  const value = product.costCents * input.qty;
  await post(tx, {
    administrationId: input.administrationId,
    date: at,
    title: `Samples · ${input.qty} × ${product.name}`,
    source: "STOCK",
    sourceId: mv.id,
    createdById: input.createdById,
    lines: [
      { account: "4570", debit: value + exciseCents },
      { account: STOCK_ACCOUNT[wh.kind], credit: value },
      { account: ACC.excisePayable, credit: exciseCents },
    ],
  });
  return { movement: mv, exciseCents };
}

/** Stock count: book the difference between counted and recorded units. */
export async function countStock(tx: Tx, input: Omit<MoveBase, "qty"> & { warehouseId: string; counted: number }) {
  const [product, wh] = await Promise.all([
    tx.product.findUniqueOrThrow({ where: { id: input.productId } }),
    tx.warehouse.findUniqueOrThrow({ where: { id: input.warehouseId } }),
  ]);
  const levels = await stockLevels(tx, input.administrationId);
  const have = unitsIn(levels, product.id, wh.id);
  const diff = input.counted - have;
  if (diff === 0) return { diff: 0 };
  const at = input.at ?? new Date();
  const mv = await tx.stockMovement.create({
    data: {
      administrationId: input.administrationId,
      productId: product.id,
      ...(diff > 0 ? { toWarehouseId: wh.id } : { fromWarehouseId: wh.id }),
      qty: Math.abs(diff),
      reason: diff > 0 ? "COUNT" : "LOSS",
      unitCostCents: product.costCents,
      at,
      note: input.note ?? `Counted ${input.counted}, recorded ${have}`,
      createdById: input.createdById ?? null,
    },
  });
  const value = Math.abs(diff) * product.costCents;
  if (value) {
    await post(tx, {
      administrationId: input.administrationId,
      date: at,
      title: `Stock count · ${product.name} · ${diff > 0 ? "+" : ""}${diff}`,
      source: "STOCK",
      sourceId: mv.id,
      createdById: input.createdById,
      lines:
        diff > 0
          ? [{ account: STOCK_ACCOUNT[wh.kind], debit: value }, { account: ACC.stockDiff, credit: value }]
          : [{ account: ACC.stockDiff, debit: value }, { account: STOCK_ACCOUNT[wh.kind], credit: value }],
    });
  }
  return { diff };
}

/** Record an inbound movement and update the product's moving-average landed cost. */
export async function receiveStock(
  tx: Tx,
  input: MoveBase & { warehouseId: string; unitCostCents: number; reason?: StockReason; documentType?: string; documentId?: string; documentRef?: string },
) {
  const product = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
  const levels = await stockLevels(tx, input.administrationId);
  const onHand = Math.max(0, unitsIn(levels, product.id));
  const newCost = onHand + input.qty > 0 ? Math.round((onHand * product.costCents + input.qty * input.unitCostCents) / (onHand + input.qty)) : input.unitCostCents;
  await tx.product.update({ where: { id: product.id }, data: { costCents: newCost } });
  return tx.stockMovement.create({
    data: {
      administrationId: input.administrationId,
      productId: product.id,
      toWarehouseId: input.warehouseId,
      qty: input.qty,
      reason: input.reason ?? "PURCHASE",
      unitCostCents: input.unitCostCents,
      documentType: input.documentType,
      documentId: input.documentId,
      documentRef: input.documentRef,
      at: input.at ?? new Date(),
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
  });
}

export const WAREHOUSE_EXCISE_ON_RELEASE: Record<WarehouseKind, boolean> = { BONDED: true, IN_TRANSIT: true, DUTY_PAID: false };
