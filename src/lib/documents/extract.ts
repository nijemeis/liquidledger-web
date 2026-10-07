// AI document reading: send a PDF or photo to Claude with a strict JSON schema
// (structured outputs), then turn the extraction into a booking proposal by
// matching it against the administration's relations, products, warehouses
// and shipments. Never books anything: the result is a TO_APPROVE proposal.
//
// `proposeFromExtraction` is pure (no I/O) so it can be unit-tested with a
// fake extraction object.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { PurchaseVatTreatment, ProductCategory, WarehouseKind } from "@prisma/client";
import { CATEGORIES } from "../domain/categories";
import { STOCK_ACCOUNT } from "../domain/chart";
import { suggestTreatment, type PurchaseLineInput } from "../domain/purchases";
import { STANDARD_RATE } from "../domain/vat";

export const DEFAULT_MODEL = "claude-opus-5-5";

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const str = { anyOf: [{ type: "string" }, { type: "null" }] };
const num = { anyOf: [{ type: "number" }, { type: "null" }] };

/** JSON schema sent to the API (structured outputs). Mirrors `InvoiceExtraction`. */
export const INVOICE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["supplier", "invoice_number", "issue_date", "due_date", "currency", "lines", "totals", "iban", "references", "confidence"],
  properties: {
    supplier: {
      type: "object",
      additionalProperties: false,
      required: ["name", "country", "vat_number"],
      properties: {
        name: { type: "string", description: "Legal name of the company that issued the invoice (not the buyer)." },
        country: { ...str, description: "ISO 3166-1 alpha-2 country code of the supplier, e.g. FR." },
        vat_number: { ...str, description: "Supplier VAT number including country prefix, without spaces." },
      },
    },
    invoice_number: str,
    issue_date: { ...str, description: "Invoice date as YYYY-MM-DD." },
    due_date: { ...str, description: "Payment due date as YYYY-MM-DD, if stated or derivable from the payment terms." },
    currency: { type: "string", description: "ISO 4217 currency code of the amounts, e.g. EUR, GBP, MXN." },
    lines: {
      type: "array",
      description: "Invoice lines (goods and services). Do not include VAT, subtotal or total rows as lines.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unit_price", "line_total", "vat_rate", "volume_l", "alcohol_pct", "code"],
        properties: {
          description: { type: "string" },
          quantity: { type: "number", description: "Number of units (bottles/cans/kegs) — convert cases to units when the case size is stated." },
          unit_price: { ...num, description: "Price per unit excluding VAT, in the invoice currency." },
          line_total: { ...num, description: "Line amount excluding VAT, in the invoice currency." },
          vat_rate: { ...num, description: "VAT percentage applied to the line, e.g. 21. 0 when reverse-charged or exempt." },
          volume_l: { ...num, description: "For drinks: volume per unit in litres, e.g. 0.75." },
          alcohol_pct: { ...num, description: "For drinks: alcohol by volume in percent, e.g. 13.5." },
          code: { ...str, description: "Product code, SKU or EAN barcode printed on the line, if any." },
        },
      },
    },
    totals: {
      type: "object",
      additionalProperties: false,
      required: ["net", "vat", "total"],
      properties: { net: num, vat: num, total: num },
    },
    iban: { ...str, description: "Supplier bank account (IBAN) for payment." },
    references: {
      type: "array",
      items: { type: "string" },
      description: "Purchase order, order, shipment, container or contract references mentioned on the document, e.g. PO-0932, SHP-1182.",
    },
    confidence: { type: "integer", description: "Your confidence 0-100 that every extracted field is correct." },
  },
} as const;

const nStr = z.string().nullable();
const nNum = z.number().nullable();

export const InvoiceExtraction = z.object({
  supplier: z.object({ name: z.string(), country: nStr, vat_number: nStr }),
  invoice_number: nStr,
  issue_date: nStr,
  due_date: nStr,
  currency: z.string(),
  lines: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unit_price: nNum,
      line_total: nNum,
      vat_rate: nNum,
      volume_l: nNum,
      alcohol_pct: nNum,
      code: nStr,
    }),
  ),
  totals: z.object({ net: nNum, vat: nNum, total: nNum }),
  iban: nStr,
  references: z.array(z.string()),
  confidence: z.number(),
});
export type InvoiceExtraction = z.infer<typeof InvoiceExtraction>;

export const RECEIPT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["supplier", "date", "description", "currency", "total", "vat_amount", "vat_rate", "confidence"],
  properties: {
    supplier: { type: "string", description: "Shop, restaurant or company name on the receipt." },
    date: { ...str, description: "Receipt date as YYYY-MM-DD." },
    description: { type: "string", description: "Short plain description of what was bought, e.g. 'Printer paper & toner'." },
    currency: { type: "string" },
    total: { type: "number", description: "Total paid including VAT." },
    vat_amount: num,
    vat_rate: { ...num, description: "Main VAT percentage on the receipt, e.g. 21 or 9." },
    confidence: { type: "integer", description: "Confidence 0-100." },
  },
} as const;

export const ReceiptExtraction = z.object({
  supplier: z.string(),
  date: nStr,
  description: z.string(),
  currency: z.string(),
  total: z.number(),
  vat_amount: nNum,
  vat_rate: nNum,
  confidence: z.number(),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtraction>;

// ── Calling Claude ───────────────────────────────────────────────────────────

export type ReadResult<T> = { ok: true; data: T; model: string } | { ok: false; reason: "no_key" | "unsupported" | "refused" | "failed"; detail?: string };

const INVOICE_PROMPT =
  "This is a supplier invoice received by a drinks importer/wholesaler. Extract the fields exactly as printed. " +
  "Amounts are numbers in the invoice currency (no thousands separators). For wine, beer and spirits lines include the bottle volume in litres and the alcohol percentage when stated in the description. " +
  "If a field is not on the document, use null. Set confidence lower when the scan is unclear or amounts don't add up.";

const RECEIPT_PROMPT =
  "This is a receipt or small expense bill. Extract the supplier, date, a short description of what was bought, the total paid including VAT and the VAT amount/rate. " +
  "If a field is not on the receipt, use null.";

async function readWithClaude<T>(bytes: Uint8Array, mime: string, schema: Record<string, unknown>, prompt: string, parser: z.ZodType<T>): Promise<ReadResult<T>> {
  if (!aiEnabled()) return { ok: false, reason: "no_key" };
  const data = Buffer.from(bytes).toString("base64");
  let block: Anthropic.Beta.Messages.BetaContentBlockParam;
  if (mime === "application/pdf") block = { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  else if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") block = { type: "image", source: { type: "base64", media_type: mime, data } };
  else return { ok: false, reason: "unsupported" }; // HEIC: not accepted by the API — keep the file, fill in by hand
  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  try {
    const client = new Anthropic();
    const res = await client.beta.messages.create(
      {
        model,
        max_tokens: 16000,
        // Route policy declines to a fallback model automatically.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }],
      },
      { timeout: 90_000 },
    );
    if (res.stop_reason === "refusal") return { ok: false, reason: "refused" };
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const parsed = parser.safeParse(JSON.parse(text));
    if (!parsed.success) return { ok: false, reason: "failed", detail: parsed.error.message };
    return { ok: true, data: parsed.data, model: res.model };
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.error("[extract] Claude API error", e.status, e.message);
      return { ok: false, reason: "failed", detail: `API ${e.status}` };
    }
    console.error("[extract]", e);
    return { ok: false, reason: "failed", detail: e instanceof Error ? e.message : String(e) };
  }
}

export function readInvoice(bytes: Uint8Array, mime: string) {
  return readWithClaude(bytes, mime, INVOICE_JSON_SCHEMA as unknown as Record<string, unknown>, INVOICE_PROMPT, InvoiceExtraction);
}

export function readReceipt(bytes: Uint8Array, mime: string) {
  return readWithClaude(bytes, mime, RECEIPT_JSON_SCHEMA as unknown as Record<string, unknown>, RECEIPT_PROMPT, ReceiptExtraction);
}

// ── Matching helpers ─────────────────────────────────────────────────────────

const LEGAL_FORMS = /\b(b\.?v\.?|n\.?v\.?|gmbh|ag|sarl|sas|sa|s\.?a\.?s?|s\.?l\.?|s\.?p\.?a\.?|s\.?r\.?l\.?|ltd|limited|llc|inc|lda|plc|bvba|sp\.? z o\.?o\.?|co|company)\b/g;

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(" ").filter((w) => w.length >= 2));
}

/** Overlap of the smaller token set with the larger (0-1). */
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

function companyKey(s: string) {
  return normalize(s).replace(LEGAL_FORMS, " ").replace(/\s+/g, " ").trim();
}

const vatKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Ledger account for a non-stock line, by keywords ("transport" → 4300, "storage" → 4400). */
export function guessAccount(description: string): string {
  const d = normalize(description);
  const rules: [RegExp, string][] = [
    [/\b(duty|duties|invoerrecht\w*|droits de douane)\b/, "4310"],
    [/\b(transport|freight|shipping|carriage|haulage|trucking|delivery|vracht\w*|forwarding|inklaring|customs clearance|clearance|container|pallet transport)\b/, "4300"],
    [/\b(storage|warehousing|opslag\w*|bonded storage|pallets?|handling)\b/, "4400"],
    [/\b(insurance|verzekering\w*|assurance)\b/, "4800"],
  ];
  for (const [re, acc] of rules) if (re.test(d)) return acc;
  for (const c of CATEGORIES) {
    if (c.importOnly || !c.keywords) continue;
    if (c.keywords.split(" ").some((k) => k.length > 3 && new RegExp(`\\b${k}\\b`).test(d))) return c.account;
  }
  return "4900";
}

// ── Proposal ─────────────────────────────────────────────────────────────────

export interface ProposalRefs {
  adminCountry: string;
  suppliers: { id: string; name: string; country: string; vatNumber: string | null }[];
  products: { id: string; sku: string; name: string; producer: string | null; ean: string | null; category: ProductCategory; volumeMl: number; abvBp: number }[];
  warehouses: { id: string; name: string; kind: WarehouseKind }[];
  shipments: { id: string; ref: string; direction: string; stage: string }[];
}

export interface Proposal {
  supplierId: string | null;
  supplierName: string;
  supplierCountry: string | null;
  newSupplier: { name: string; country: string | null; vatNumber: string | null; iban: string | null } | null;
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  currency: string;
  fxRate: number; // 0 = unknown, must be entered by hand
  fxDate: Date | null;
  vatTreatment: PurchaseVatTreatment;
  warehouseId: string | null;
  shipmentId: string | null;
  orderRef: string | null;
  lines: (PurchaseLineInput & { matched: boolean })[];
  ocrConfidence: number;
  warnings: string[];
}

export type WarnT = (key: string, vars?: Record<string, string | number>) => string;

function toDate(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const cents = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 100));

function matchProduct(line: InvoiceExtraction["lines"][number], products: ProposalRefs["products"]) {
  const hay = normalize(`${line.description} ${line.code ?? ""}`);
  const code = (line.code ?? "").replace(/\s/g, "");
  let best: { id: string; score: number; p: ProposalRefs["products"][number] } | null = null;
  for (const p of products) {
    let score = 0;
    if ((code && (code === p.sku || code === p.ean)) || hay.includes(normalize(p.sku)) || (p.ean && hay.includes(p.ean))) score = 1;
    else {
      score = similarity(line.description, `${p.name} ${p.producer ?? ""}`);
      if (line.volume_l && Math.abs(line.volume_l * 1000 - p.volumeMl) < 1) score += 0.1;
      if (line.alcohol_pct !== null && Math.abs(line.alcohol_pct * 100 - p.abvBp) < 6) score += 0.1;
    }
    if (!best || score > best.score) best = { id: p.id, score, p };
  }
  return best && best.score >= 0.5 ? best : null;
}

/**
 * Turn an extraction into a booking proposal. `fx` is the ECB rate for the
 * invoice currency (null when it couldn't be fetched → manual rate required).
 */
export function proposeFromExtraction(x: InvoiceExtraction, refs: ProposalRefs, fx: { rate: number; date: Date } | null, t: WarnT, today = new Date()): Proposal {
  const warnings: string[] = [];
  const currency = (x.currency || "EUR").toUpperCase().slice(0, 3);

  // Supplier: VAT number first, then name.
  const vat = vatKey(x.supplier.vat_number);
  let supplier = vat ? refs.suppliers.find((s) => vatKey(s.vatNumber) === vat) : undefined;
  if (!supplier) {
    const key = companyKey(x.supplier.name);
    supplier = refs.suppliers.find((s) => companyKey(s.name) === key) ?? refs.suppliers.find((s) => key && (companyKey(s.name).includes(key) || key.includes(companyKey(s.name))));
    if (!supplier) {
      const scored = refs.suppliers.map((s) => ({ s, v: similarity(companyKey(s.name), key) })).sort((a, b) => b.v - a.v)[0];
      if (scored && scored.v >= 0.6) supplier = scored.s;
    }
  }
  const supplierCountry = (supplier?.country ?? x.supplier.country ?? null)?.toUpperCase() ?? null;
  const newSupplier = supplier ? null : { name: x.supplier.name.trim(), country: x.supplier.country?.toUpperCase() ?? null, vatNumber: x.supplier.vat_number, iban: x.iban };
  if (newSupplier) warnings.push(t("purchases.warn.newSupplier", { name: newSupplier.name }));

  // Lines.
  const fxRate = currency === "EUR" ? 1 : fx?.rate ?? 0;
  const raw = x.lines.map((l) => {
    const m = matchProduct(l, refs.products);
    const qty = Math.max(1, Math.round(l.quantity || 1));
    const unit = cents(l.unit_price) ?? (l.line_total !== null ? Math.round((l.line_total * 100) / qty) : 0);
    return { l, m, qty, unit };
  });
  const goods = raw.some((r) => r.m) || x.lines.some((l) => (l.alcohol_pct ?? 0) > 0);
  const vatTreatment = suggestTreatment(refs.adminCountry, supplierCountry, goods);

  // Shipment / order reference.
  const text = [...x.references, ...x.lines.map((l) => l.description)].join(" ").toUpperCase();
  const shipment = refs.shipments.find((s) => text.includes(s.ref.toUpperCase())) ?? null;
  const orderRef = x.references.length ? [...new Set(x.references.map((r) => r.trim()).filter(Boolean))].join(" · ").slice(0, 120) : shipment?.ref ?? null;

  // Destination warehouse.
  const productLines = raw.filter((r) => r.m);
  const allNonAlcoholic = productLines.length > 0 && productLines.every((r) => r.m!.p.category === "WATER" || r.m!.p.category === "SOFT");
  const byKind = (k: WarehouseKind) => refs.warehouses.find((w) => w.kind === k);
  let warehouse = null as ProposalRefs["warehouses"][number] | null;
  if (productLines.length) {
    if (allNonAlcoholic) warehouse = byKind("DUTY_PAID") ?? null;
    else if (shipment && shipment.direction === "IMPORT" && shipment.stage !== "ARRIVED") warehouse = byKind("IN_TRANSIT") ?? byKind("BONDED") ?? null;
    else warehouse = byKind("BONDED") ?? byKind("DUTY_PAID") ?? null;
    warehouse ??= refs.warehouses[0] ?? null;
  }

  const std = STANDARD_RATE[refs.adminCountry] ?? 2100;
  const lines = raw.map(({ l, m, qty, unit }) => ({
    description: l.description.slice(0, 200),
    productId: m?.id ?? null,
    accountCode: m ? STOCK_ACCOUNT[warehouse?.kind ?? "BONDED"] : guessAccount(l.description),
    qty,
    unitPriceSrcCents: unit,
    vatRateBp: vatTreatment === "DOMESTIC" ? (l.vat_rate !== null ? Math.round(l.vat_rate * 100) : std) : 0,
    matched: Boolean(m),
  }));
  const unmatchedDrinks = raw.filter((r) => !r.m && ((r.l.alcohol_pct ?? 0) > 0 || r.l.volume_l)).length;
  if (unmatchedDrinks) warnings.push(t("purchases.warn.unmatched", { n: unmatchedDrinks }));

  // FX.
  if (currency !== "EUR") {
    if (fx) warnings.push(t("purchases.warn.fx", { cur: currency, rate: fx.rate.toFixed(4), date: fx.date.toISOString().slice(0, 10) }));
    else warnings.push(t("purchases.warn.fxMissing", { cur: currency }));
  }

  // Totals check (in source currency).
  const net = lines.reduce((a, l) => a + l.qty * l.unitPriceSrcCents, 0);
  const docNet = cents(x.totals.net);
  if (docNet !== null && Math.abs(docNet - net) > Math.max(100, Math.abs(docNet) * 0.01)) {
    warnings.push(t("purchases.warn.totals", { doc: (docNet / 100).toFixed(2), lines: (net / 100).toFixed(2), cur: currency }));
  }
  if (!x.lines.length) warnings.push(t("purchases.warn.noLines"));

  const issueDate = toDate(x.issue_date) ?? today;
  const dueDate = toDate(x.due_date);
  return {
    supplierId: supplier?.id ?? null,
    supplierName: supplier?.name ?? x.supplier.name.trim(),
    supplierCountry,
    newSupplier,
    number: (x.invoice_number ?? "").trim().slice(0, 60),
    issueDate,
    dueDate,
    currency,
    fxRate,
    fxDate: currency === "EUR" ? null : fx?.date ?? null,
    vatTreatment,
    warehouseId: warehouse?.id ?? null,
    shipmentId: shipment?.id ?? null,
    orderRef,
    lines,
    ocrConfidence: Math.max(0, Math.min(100, Math.round(x.confidence))),
    warnings,
  };
}

/** Load what the proposal is matched against (inside the tenant transaction). */
export async function loadProposalRefs(tx: import("../domain/types").Tx, administrationId: string, adminCountry: string): Promise<ProposalRefs> {
  const [suppliers, products, warehouses, shipments] = await Promise.all([
    tx.relation.findMany({ where: { administrationId, kind: { in: ["SUPPLIER", "BOTH"] }, archivedAt: null }, select: { id: true, name: true, country: true, vatNumber: true } }),
    tx.product.findMany({ where: { administrationId, archivedAt: null }, select: { id: true, sku: true, name: true, producer: true, ean: true, category: true, volumeMl: true, abvBp: true } }),
    tx.warehouse.findMany({ where: { administrationId, archivedAt: null }, select: { id: true, name: true, kind: true } }),
    tx.shipment.findMany({ where: { administrationId }, select: { id: true, ref: true, direction: true, stage: true } }),
  ]);
  return { adminCountry, suppliers, products, warehouses, shipments };
}
