import type { AccountType, RelationKind } from "@prisma/client";
import type { Tx } from "@/lib/domain/types";
import { post, reverse, PostingError, type PostLine } from "@/lib/domain/ledger";
import { checkXaf, type XafFile, type XafRelation } from "./parse";
import { ACC } from "@/lib/domain/chart";
import { isEU, VAT } from "@/lib/domain/vat";
import { impliedRateBp, invoiceFromTransaction, spreadVat, type MappedLine } from "./invoices";
import { ACCOUNT_CODE, defaultIncluded, suggestMapping, type AccountTarget, type ChartAccount, type MappingRow } from "./mapping";

// Takes an auditfile over into an administration: missing ledger accounts and
// relations are created, the opening balance and every transaction are posted
// through the posting engine (source IMPORT, sourceId = the import batch).
// Nothing is touched before the user has reviewed the preview and the mapping.

export interface ImportTarget {
  administrationId: string;
  country: string;
  baseCurrency: string;
  ledgerLanguage: string;
  lockedThrough: Date | null;
  userId: string | null;
}

export interface ImportOptions {
  /** XAF account id → target account. Must cover every account used by what's imported. */
  mapping: Record<string, AccountTarget>;
  /** Journal ids to import. */
  journals: string[];
  opening: boolean;
  /** Also create relations without bookings in this file. */
  allRelations: boolean;
  /** Describe recognised sales and purchase invoices as invoice records (default on). */
  invoices?: boolean;
}

export type ImportProblem =
  | { code: "duplicate"; date: string }
  | { code: "closed"; date: string }
  | { code: "unbalanced"; count: number }
  | { code: "totals" }
  | { code: "openingUnbalanced"; cents: number }
  | { code: "currency"; currency: string }
  | { code: "empty" };

export interface ImportPreview {
  version: string;
  header: XafFile["header"];
  company: { name: string; taxRegIdent: string; ident: string };
  totals: { transactions: number; lines: number; debit: number; credit: number; first: string; last: string };
  journals: { id: string; desc: string; type: string; transactions: number; lines: number; include: boolean }[];
  opening: { date: string; lines: number; openItems: number; total: number } | null;
  relations: { total: number; used: number; matched: number };
  mapping: MappingRow[];
  chart: ChartAccount[];
  /** Entries already in the administration within the file's period. */
  overlap: number;
  problems: ImportProblem[];
}

const day = (s: string) => new Date(s + "T00:00:00Z");

/** Relation id as stored on our side, so a later file of the same package finds it again. */
export const externalRef = (file: XafFile, id: string) => `xaf:${(file.header.software || "unknown").slice(0, 40)}:${id}`;

/** Dutch auditfiles often omit the country prefix of VAT numbers ("822742342B01"). */
export function vatNumberOf(taxRegIdent: string, country: string): string | null {
  const v = taxRegIdent.replace(/[\s.-]/g, "").toUpperCase();
  if (!v) return null;
  if (/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(v)) return v;
  if (/^\d{9}B\d{2}$/.test(v)) return "NL" + v;
  return country ? country + v : v;
}

function ibanOf(s: string): string | null {
  const v = s.replace(/\s/g, "").toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v) ? v : null;
}

const KIND: Record<string, RelationKind> = { C: "CUSTOMER", S: "SUPPLIER" };

/** Which relations the selected part of the file books on. */
function usedRelations(file: XafFile, journals: Set<string>, opening: boolean) {
  const used = new Set<string>();
  if (opening) for (const o of file.opening?.openItems ?? []) if (o.relation) used.add(o.relation);
  for (const j of file.journals) if (journals.has(j.id)) for (const t of j.transactions) for (const l of t.lines) if (l.relation) used.add(l.relation);
  return used;
}

type ExistingRelation = { id: string; name: string; vatNumber: string | null; externalRef: string | null };

function matchRelation(file: XafFile, r: XafRelation, existing: ExistingRelation[], country: string) {
  const ref = externalRef(file, r.id);
  const vat = vatNumberOf(r.taxRegIdent, r.address.country || country);
  const name = r.name.trim().toLowerCase();
  return (
    existing.find((e) => e.externalRef === ref) ??
    (vat ? existing.find((e) => e.vatNumber && e.vatNumber.replace(/\s/g, "").toUpperCase() === vat) : undefined) ??
    existing.find((e) => e.name.trim().toLowerCase() === name)
  );
}

export async function previewImport(tx: Tx, file: XafFile, fileHash: string, target: ImportTarget): Promise<ImportPreview> {
  const A = target.administrationId;
  const check = checkXaf(file);
  const [chartRows, relations, duplicate] = await Promise.all([
    tx.ledgerAccount.findMany({ where: { administrationId: A, active: true }, orderBy: { code: "asc" }, select: { code: true, nameNl: true, nameEn: true, type: true } }),
    tx.relation.findMany({ where: { administrationId: A }, select: { id: true, name: true, vatNumber: true, externalRef: true } }),
    tx.importBatch.findFirst({ where: { administrationId: A, fileHash, reversedAt: null } }),
  ]);
  const first = file.opening?.date && (!check.first || file.opening.date < check.first) ? file.opening.date : check.first;
  const overlap =
    first && check.last ? await tx.journalEntry.count({ where: { administrationId: A, date: { gte: day(first), lte: day(check.last) } } }) : 0;

  const problems: ImportProblem[] = [];
  if (duplicate) problems.push({ code: "duplicate", date: duplicate.createdAt.toISOString().slice(0, 10) });
  if (target.lockedThrough && first && day(first) <= target.lockedThrough) problems.push({ code: "closed", date: target.lockedThrough.toISOString().slice(0, 10) });
  if (check.unbalanced.length) problems.push({ code: "unbalanced", count: check.unbalanced.length });
  if (!check.totalsMatch) problems.push({ code: "totals" });
  if (!check.openingBalanced) problems.push({ code: "openingUnbalanced", cents: check.openingDiff });
  if (file.header.currency && file.header.currency !== target.baseCurrency) problems.push({ code: "currency", currency: file.header.currency });
  if (!check.transactions && !file.opening?.lines.length) problems.push({ code: "empty" });

  const journals = file.journals.map((j) => ({
    id: j.id,
    desc: j.desc,
    type: j.type,
    transactions: j.transactions.length,
    lines: j.transactions.reduce((a, t) => a + t.lines.length, 0),
    include: defaultIncluded(j),
  }));
  const used = usedRelations(file, new Set(file.journals.map((j) => j.id)), true);
  return {
    version: file.version,
    header: file.header,
    company: { name: file.company.name, taxRegIdent: file.company.taxRegIdent, ident: file.company.ident },
    totals: { transactions: check.transactions, lines: check.lines, debit: check.debit, credit: check.credit, first: check.first, last: check.last },
    journals,
    opening: file.opening
      ? { date: file.opening.date || file.header.startDate, lines: file.opening.lines.length, openItems: file.opening.openItems.length, total: file.opening.lines.reduce((a, l) => a + Math.max(l.amount, 0), 0) }
      : null,
    relations: {
      total: file.relations.length,
      used: used.size,
      matched: file.relations.filter((r) => used.has(r.id) && matchRelation(file, r, relations, target.country)).length,
    },
    mapping: suggestMapping(file, chartRows),
    chart: chartRows,
    overlap,
    problems,
  };
}

export interface ImportResult {
  batchId: string;
  entries: number;
  skipped: number;
  accountsCreated: number;
  relationsCreated: number;
  relationsMatched: number;
  salesInvoices: number;
  purchaseInvoices: number;
  first: string;
  last: string;
}

export async function runImport(
  tx: Tx,
  file: XafFile,
  meta: { fileName: string; fileHash: string },
  target: ImportTarget,
  opts: ImportOptions,
): Promise<ImportResult> {
  const A = target.administrationId;
  const nl = target.ledgerLanguage === "nl";
  const check = checkXaf(file);
  const journalIds = new Set(opts.journals);
  const journals = file.journals.filter((j) => journalIds.has(j.id));
  const opening = opts.opening && file.opening?.lines.length ? file.opening : null;
  if (!journals.length && !opening) throw new PostingError("Nothing selected to import.");

  // ── Integrity of what's selected ──────────────────────────────────────────
  if (check.unbalanced.some((u) => journalIds.has(u.journal))) throw new PostingError("The file contains transactions that don't balance; it can't be imported.");
  if (opening && !check.openingBalanced) throw new PostingError("The opening balance in the file doesn't balance.");
  if (file.header.currency && file.header.currency !== target.baseCurrency)
    throw new PostingError(`The file is in ${file.header.currency}; this administration books in ${target.baseCurrency}.`);
  if (await tx.importBatch.findFirst({ where: { administrationId: A, fileHash: meta.fileHash, reversedAt: null } }))
    throw new PostingError("This file has already been imported. Reverse that import first to import it again.");
  const dates = [...journals.flatMap((j) => j.transactions.map((t) => t.date)), ...(opening ? [opening.date || file.header.startDate] : [])].filter(Boolean).sort();
  if (dates.length !== journals.reduce((a, j) => a + j.transactions.length, 0) + (opening ? 1 : 0)) throw new PostingError("Some transactions in the file have no date.");
  const first = dates[0] ?? "";
  const last = dates[dates.length - 1] ?? "";
  if (target.lockedThrough && first && day(first) <= target.lockedThrough)
    throw new PostingError(`The books are closed through ${target.lockedThrough.toISOString().slice(0, 10)}. Reopen that period before importing.`);

  // ── Accounts ──────────────────────────────────────────────────────────────
  const usedAccounts = new Set<string>();
  for (const l of opening?.lines ?? []) usedAccounts.add(l.account);
  for (const j of journals) for (const t of j.transactions) for (const l of t.lines) usedAccounts.add(l.account);
  const chart = await tx.ledgerAccount.findMany({ where: { administrationId: A }, select: { code: true, active: true, type: true } });
  const chartCodes = new Map(chart.map((c) => [c.code, c.active]));
  const toCreate = new Map<string, { name: string; type: AccountType }>();
  const accountOf = new Map<string, string>();
  for (const id of usedAccounts) {
    const m = opts.mapping[id];
    if (!m) throw new PostingError(`Account ${id} from the file has no mapping.`);
    const code = String(m.code).trim();
    if (!ACCOUNT_CODE.test(code)) throw new PostingError(`"${code}" isn't a valid account code (4 to 6 digits).`);
    if (m.create) {
      if (chartCodes.has(code)) throw new PostingError(`Account ${code} already exists; map ${id} to it or pick another code.`);
      if (!toCreate.has(code)) toCreate.set(code, { name: (m.name || id).trim().slice(0, 120), type: m.type });
    } else if (!chartCodes.get(code)) throw new PostingError(`Account ${code} doesn't exist or is inactive.`);
    accountOf.set(id, code);
  }
  const accountTypes = new Set<AccountType>(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COST"]);
  for (const [code, a] of toCreate) {
    if (!accountTypes.has(a.type)) throw new PostingError(`Invalid account type for ${code}.`);
  }
  const typeOfCode = new Map<string, AccountType>(chart.map((c) => [c.code, c.type]));
  for (const [code, a] of toCreate) typeOfCode.set(code, a.type);
  if (toCreate.size)
    await tx.ledgerAccount.createMany({
      data: [...toCreate].map(([code, a]) => ({ administrationId: A, code, nameNl: a.name, nameEn: a.name, type: a.type })),
    });

  // ── Relations ─────────────────────────────────────────────────────────────
  const used = usedRelations(file, journalIds, !!opening);
  const existing = await tx.relation.findMany({ where: { administrationId: A }, select: { id: true, name: true, vatNumber: true, externalRef: true } });
  const relationOf = new Map<string, string>();
  let relationsCreated = 0;
  let relationsMatched = 0;
  const createdHere = new Map<string, RelationKind>();
  for (const r of file.relations) {
    if (!opts.allRelations && !used.has(r.id)) continue;
    const hit = matchRelation(file, r, existing, target.country);
    if (hit) {
      relationOf.set(r.id, hit.id);
      relationsMatched++;
      const kind = KIND[r.type] ?? "BOTH";
      // The same party as customer and as supplier in the other package becomes one relation.
      const prev = createdHere.get(hit.id);
      const both = !!prev && prev !== "BOTH" && prev !== kind;
      if (both) createdHere.set(hit.id, "BOTH");
      if (!hit.externalRef || both) await tx.relation.update({ where: { id: hit.id }, data: { ...(hit.externalRef ? {} : { externalRef: externalRef(file, r.id) }), ...(both ? { kind: "BOTH" } : {}) } });
      continue;
    }
    const country = (r.address.country || /^[A-Z]{2}/.exec(r.taxRegIdent.toUpperCase())?.[0] || target.country).slice(0, 2).toUpperCase();
    const kind = KIND[r.type] ?? "BOTH";
    const created = await tx.relation.create({
      data: {
        administrationId: A,
        kind,
        name: r.name.slice(0, 200),
        country,
        addressLine: r.address.street || null,
        postcode: r.address.postalCode || null,
        city: r.address.city || null,
        email: r.email || null,
        phone: r.phone || null,
        vatNumber: vatNumberOf(r.taxRegIdent, country),
        iban: ibanOf(r.iban),
        paymentTermsDays: kind === "SUPPLIER" ? 30 : 14,
        externalRef: externalRef(file, r.id),
      },
      select: { id: true, name: true, vatNumber: true, externalRef: true },
    });
    existing.push(created);
    createdHere.set(created.id, kind);
    relationOf.set(r.id, created.id);
    relationsCreated++;
  }

  const batch = await tx.importBatch.create({
    data: {
      administrationId: A,
      fileName: meta.fileName.slice(0, 200),
      fileHash: meta.fileHash,
      software: [file.header.software, file.header.softwareVersion].filter(Boolean).join(" ").slice(0, 100) || "unknown",
      companyName: file.company.name.slice(0, 200),
      periodStart: first ? day(first) : null,
      periodEnd: last ? day(last) : null,
      createdById: target.userId,
    },
  });
  const base = { administrationId: A, source: "IMPORT" as const, sourceId: batch.id, createdById: target.userId };
  const amounts = (cents: number) => (cents >= 0 ? { debit: cents } : { credit: -cents });

  // ── Opening balance (receivables/payables split per relation when the file says how) ──
  let entries = 0;
  let skipped = 0;
  if (opening) {
    const items = new Map<string, typeof opening.openItems>();
    for (const o of opening.openItems) (items.get(o.obLineNr) ?? items.set(o.obLineNr, []).get(o.obLineNr)!).push(o);
    const lines: PostLine[] = [];
    for (const l of opening.lines) {
      const its = items.get(l.nr) ?? [];
      if (its.length && its.reduce((a, o) => a + o.amount, 0) === l.amount && its.every((o) => o.relation)) {
        const perRelation = new Map<string, { amount: number; refs: string[] }>();
        for (const o of its) {
          const p = perRelation.get(o.relation) ?? { amount: 0, refs: [] };
          p.amount += o.amount;
          if (o.invRef) p.refs.push(o.invRef);
          perRelation.set(o.relation, p);
        }
        for (const [rel, p] of perRelation) {
          if (!p.amount) continue;
          const refs = p.refs.length > 6 ? `${p.refs.slice(0, 6).join(", ")} +${p.refs.length - 6}` : p.refs.join(", ");
          lines.push({ account: accountOf.get(l.account)!, ...amounts(p.amount), relationId: relationOf.get(rel) ?? null, description: `${nl ? "Openstaande posten" : "Open items"}${refs ? `: ${refs}` : ""}`.slice(0, 500) });
        }
      } else lines.push({ account: accountOf.get(l.account)!, ...amounts(l.amount) });
    }
    if (lines.filter((l) => l.debit || l.credit).length >= 2) {
      const date = opening.date || file.header.startDate;
      await post(tx, { ...base, date: day(date), title: `${nl ? "Beginbalans" : "Opening balance"} ${date.slice(0, 4)} · ${file.header.software || "XAF"}`, lines });
      entries++;
    }
  }

  // ── Invoice records: what's still open per relation + invoice reference ──
  const withInvoices = opts.invoices !== false;
  const settle = new Map<string, { sum: number; moves: { tx: string; date: string }[] }>();
  const refOf = (l: { invRef: string; docRef: string }) => (l.invRef && l.invRef !== "0" ? l.invRef : l.docRef && l.docRef !== "0" ? l.docRef : "");
  const track = (account: string, relation: string, ref: string, amount: number, txKey: string, date: string) => {
    const code = accountOf.get(account);
    const rel = relationOf.get(relation);
    if (!rel || !ref || (code !== ACC.receivables && code !== ACC.payables)) return;
    const k = `${rel}|${ref}`;
    const s = settle.get(k) ?? { sum: 0, moves: [] };
    s.sum += amount;
    s.moves.push({ tx: txKey, date });
    settle.set(k, s);
  };
  const lineOf = new Map(opening?.lines.map((l) => [l.nr, l.account]) ?? []);
  for (const o of opening?.openItems ?? []) track(lineOf.get(o.obLineNr) ?? "", o.relation, o.invRef, o.amount, "opening", opening!.date);
  for (const j of journals) for (const t of j.transactions) for (const l of t.lines) track(l.account, l.relation, refOf(l), l.amount, `${j.id}:${t.nr}`, t.date);
  const relInfo = new Map(
    (await tx.relation.findMany({ where: { administrationId: A, id: { in: [...new Set(relationOf.values())] } }, select: { id: true, name: true, country: true, paymentTermsDays: true } })).map((r) => [r.id, r]),
  );
  const usedSalesNumbers = new Set((await tx.salesInvoice.findMany({ where: { administrationId: A, number: { not: null } }, select: { number: true } })).map((i) => i.number!));
  let salesInvoices = 0;
  let purchaseInvoices = 0;
  const note = `${nl ? "Overgenomen uit" : "Imported from"} ${file.header.software || "XAF"}`;
  const addDays = (d: string, n: number) => new Date(day(d).getTime() + n * 86_400_000);

  // ── Transactions ──────────────────────────────────────────────────────────
  for (const j of journals) {
    for (const t of j.transactions) {
      const lines: PostLine[] = t.lines
        .filter((l) => l.amount !== 0)
        .map((l) => ({ account: accountOf.get(l.account)!, ...amounts(l.amount), relationId: l.relation ? (relationOf.get(l.relation) ?? null) : null, description: l.desc.slice(0, 500) || null }));
      if (lines.length < 2) {
        skipped++;
        continue;
      }
      const refs = new Set(t.lines.map((l) => l.invRef || l.docRef).filter((r) => r && r !== "0"));
      const title = [t.desc || j.desc, refs.size === 1 ? [...refs][0] : ""].filter(Boolean).join(" · ").slice(0, 200);
      const entry = await post(tx, { ...base, date: day(t.date), title: title || `${j.desc} ${t.nr}`, lines });
      entries++;
      if (!withInvoices) continue;

      const mapped: MappedLine[] = t.lines
        .filter((l) => l.amount !== 0)
        .map((l) => ({ account: accountOf.get(l.account)!, amount: l.amount, relationId: l.relation ? (relationOf.get(l.relation) ?? null) : null, desc: l.desc, ref: refOf(l) }));
      const inv = invoiceFromTransaction(mapped, (c) => typeOfCode.get(c));
      const rel = inv ? relInfo.get(inv.relationId) : undefined;
      if (!inv || !rel) continue;
      const s = settle.get(`${inv.relationId}|${inv.number}`);
      const outstanding = s ? (inv.kind === "sales" ? s.sum : -s.sum) : inv.totalCents;
      const settled = outstanding === 0;
      const paidAt = settled ? (s?.moves.filter((m) => m.tx !== `${j.id}:${t.nr}`).map((m) => m.date).sort().pop() ?? t.date) : null;
      const describe = (d: string) => (d || t.desc || rel.name).slice(0, 500);
      const vatPer = spreadVat(inv.lines, inv.vatCents);
      const rateBp = impliedRateBp(inv.netCents, inv.vatCents);

      if (inv.kind === "sales") {
        if (usedSalesNumbers.has(inv.number)) continue;
        usedSalesNumbers.add(inv.number);
        const regime = inv.vatCents !== 0 || rel.country === target.country ? "DOMESTIC" : isEU(rel.country) ? "EU_B2B" : "EXPORT";
        const vatCode = inv.vatCents !== 0 ? (rateBp >= 2100 ? VAT.SALES_HIGH : VAT.SALES_LOW) : regime === "EXPORT" ? VAT.EXPORT : regime === "EU_B2B" ? VAT.ICP : VAT.SALES_ZERO;
        await tx.salesInvoice.create({
          data: {
            administrationId: A,
            number: inv.number,
            customerId: inv.relationId,
            issueDate: day(t.date),
            dueDate: addDays(t.date, rel.paymentTermsDays),
            taxRegime: regime,
            status: inv.totalCents < 0 ? "CREDITED" : settled ? "PAID" : "OPEN",
            currency: target.baseCurrency,
            netCents: inv.netCents,
            vatCents: inv.vatCents,
            totalCents: inv.totalCents,
            paidCents: Math.min(Math.max(inv.totalCents - outstanding, 0), Math.max(inv.totalCents, 0)),
            notes: note,
            sentAt: day(t.date),
            paidAt: paidAt ? day(paidAt) : null,
            journalEntryId: entry.id,
            createdById: target.userId,
            lines: {
              create: inv.lines.map((l, i) => ({
                administrationId: A,
                description: describe(l.description),
                qtyUnits: 1,
                unitPriceCents: l.netCents,
                netCents: l.netCents,
                vatRateBp: rateBp,
                vatCode,
                vatCents: vatPer[i]!,
                sort: i,
              })),
            },
          },
        });
        salesInvoices++;
      } else {
        const treatment = inv.vatCents !== 0 ? "DOMESTIC" : rel.country === target.country ? "NONE" : isEU(rel.country) ? "EU_ACQUISITION" : "IMPORT";
        await tx.purchaseInvoice.create({
          data: {
            administrationId: A,
            supplierId: inv.relationId,
            supplierName: rel.name,
            supplierCountry: rel.country,
            number: inv.number.slice(0, 100),
            issueDate: day(t.date),
            dueDate: addDays(t.date, rel.paymentTermsDays),
            currency: target.baseCurrency,
            totalSourceCents: inv.totalCents,
            netCents: inv.netCents,
            vatCents: inv.vatCents,
            totalCents: inv.totalCents,
            paidCents: settled ? inv.totalCents : Math.max(inv.totalCents - outstanding, 0),
            vatTreatment: treatment,
            status: settled ? "PAID" : "BOOKED",
            bookedAt: day(t.date),
            journalEntryId: entry.id,
            lines: {
              create: inv.lines.map((l, i) => ({
                administrationId: A,
                description: describe(l.description),
                accountCode: l.account,
                qty: 1,
                unitPriceSrcCents: l.netCents,
                amountSrcCents: l.netCents,
                amountCents: l.netCents,
                vatRateBp: rateBp,
                vatCents: vatPer[i]!,
                sort: i,
              })),
            },
          },
        });
        purchaseInvoices++;
      }
    }
  }

  await tx.importBatch.update({ where: { id: batch.id }, data: { entries, accountsCreated: toCreate.size, relationsCreated } });
  return { batchId: batch.id, entries, skipped, accountsCreated: toCreate.size, relationsCreated, relationsMatched, salesInvoices, purchaseInvoices, first, last };
}

/** Undo an import with reversing entries (history stays intact). */
export async function reverseImport(tx: Tx, administrationId: string, batchId: string, userId: string | null) {
  const batch = await tx.importBatch.findFirst({ where: { id: batchId, administrationId } });
  if (!batch) throw new PostingError("Import not found.");
  if (batch.reversedAt) throw new PostingError("This import has already been reversed.");
  const entries = await tx.journalEntry.findMany({
    where: { administrationId, source: "IMPORT", sourceId: batch.id, reversalOfId: null },
    orderBy: { number: "asc" },
    select: { id: true, date: true },
  });
  // The invoice records only described imported bookings; they go with them.
  const ids = entries.map((e) => e.id);
  await tx.salesInvoice.deleteMany({ where: { administrationId, journalEntryId: { in: ids } } });
  await tx.purchaseInvoice.deleteMany({ where: { administrationId, journalEntryId: { in: ids } } });
  for (const e of entries) await reverse(tx, e.id, e.date, userId);
  await tx.importBatch.update({ where: { id: batch.id }, data: { reversedAt: new Date() } });
  return { batch, reversed: entries.length };
}
