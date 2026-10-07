import type { JournalSource } from "@prisma/client";
import type { Tx } from "./types";

// Double-entry posting engine. Every booking in the app ends up here.
// Entries are immutable once posted (database trigger); corrections are
// reversing entries. Entries can't be dated inside a closed period (trigger).

export interface PostLine {
  account: string;
  debit?: number; // cents
  credit?: number; // cents
  vatCode?: string | null;
  vatBase?: number | null; // turnover the VAT code applies to (cents)
  relationId?: string | null;
  description?: string | null;
}

export interface PostInput {
  administrationId: string;
  date: Date;
  title: string;
  source: JournalSource;
  sourceId?: string | null;
  createdById?: string | null;
  reversalOfId?: string | null;
  lines: PostLine[];
}

export class PostingError extends Error {}

/** Gapless per-administration counter. Rolls back with the transaction. */
export async function nextNumber(tx: Tx, administrationId: string, name: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO sequences (administration_id, name, next) VALUES (${administrationId}, ${name}, 2)
    ON CONFLICT (administration_id, name) DO UPDATE SET next = sequences.next + 1
    RETURNING next - 1 AS value`;
  return Number(rows[0]!.value);
}

export async function post(tx: Tx, input: PostInput) {
  const lines = input.lines
    .map((l) => ({ ...l, debit: Math.round(l.debit ?? 0), credit: Math.round(l.credit ?? 0) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0 || (l.vatCode && l.vatBase));
  if (lines.length < 2) throw new PostingError("A journal entry needs at least two lines.");
  for (const l of lines) {
    if (l.debit < 0 || l.credit < 0) throw new PostingError("Negative amounts aren't allowed; swap debit and credit.");
    if (l.debit && l.credit) throw new PostingError("A line is either debit or credit.");
  }
  const dr = lines.reduce((a, l) => a + l.debit, 0);
  const cr = lines.reduce((a, l) => a + l.credit, 0);
  if (dr !== cr) throw new PostingError(`Entry doesn't balance: debit ${dr} ≠ credit ${cr}.`);

  const codes = [...new Set(lines.map((l) => l.account))];
  const found = await tx.ledgerAccount.findMany({
    where: { administrationId: input.administrationId, code: { in: codes }, active: true },
    select: { code: true },
  });
  const missing = codes.filter((c) => !found.some((f) => f.code === c));
  if (missing.length) throw new PostingError(`Unknown ledger account(s): ${missing.join(", ")}`);

  const number = await nextNumber(tx, input.administrationId, "journal");
  return tx.journalEntry.create({
    data: {
      administrationId: input.administrationId,
      number,
      date: input.date,
      title: input.title,
      source: input.source,
      sourceId: input.sourceId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      createdById: input.createdById ?? null,
      lines: {
        create: lines.map((l) => ({
          administrationId: input.administrationId,
          accountCode: l.account,
          debitCents: l.debit,
          creditCents: l.credit,
          vatCode: l.vatCode ?? null,
          vatBaseCents: l.vatBase ?? null,
          relationId: l.relationId ?? null,
          description: l.description ?? null,
        })),
      },
    },
    include: { lines: true },
  });
}

/** Post the mirror image of an entry (corrections never edit history). */
export async function reverse(tx: Tx, entryId: string, date: Date, createdById?: string | null) {
  const e = await tx.journalEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: true } });
  return post(tx, {
    administrationId: e.administrationId,
    date,
    title: `Reversal of #${e.number} · ${e.title}`,
    source: e.source,
    sourceId: e.sourceId,
    reversalOfId: e.id,
    createdById,
    lines: e.lines.map((l) => ({
      account: l.accountCode,
      debit: l.creditCents,
      credit: l.debitCents,
      vatCode: l.vatCode,
      vatBase: l.vatBaseCents ? -l.vatBaseCents : null,
      relationId: l.relationId,
      description: l.description,
    })),
  });
}

/** Balance per account (debit − credit) up to and including `to`, optionally from `from`. */
export async function balances(tx: Tx, administrationId: string, opts: { from?: Date; to?: Date } = {}) {
  const rows = await tx.journalLine.groupBy({
    by: ["accountCode"],
    where: {
      administrationId,
      entry: { date: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } },
    },
    _sum: { debitCents: true, creditCents: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.accountCode, (r._sum.debitCents ?? 0) - (r._sum.creditCents ?? 0));
  return map;
}
