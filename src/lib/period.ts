// Period filter shared by the list screens (?period=…).
//   year      this financial year (default)
//   lastyear  previous financial year
//   30d / 90d last 30 / 90 days up to today
//   m2026-09  one calendar month
//   all       no date filter
// Pure: used on the server for queries and in the client picker.

export type PeriodKind = "year" | "lastyear" | "30d" | "90d" | "month" | "all";

export interface Period {
  key: string;
  kind: PeriodKind;
  from: Date | null; // inclusive, UTC midnight
  to: Date | null; // inclusive, UTC midnight
  year?: number; // financial year label for year / lastyear
  month?: Date; // first day, for month
}

export const DEFAULT_PERIOD = "year";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

export function todayUtc(now = new Date()) {
  return utc(now.getFullYear(), now.getMonth(), now.getDate());
}

/** First day of the financial year containing `d` (fiscalYearStart = 1…12). */
function fyStart(d: Date, fiscalYearStart: number) {
  const m0 = fiscalYearStart - 1;
  const y = d.getUTCMonth() >= m0 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return utc(y, m0, 1);
}

export function resolvePeriod(key: string | undefined | null, fiscalYearStart = 1, now = new Date()): Period {
  const today = todayUtc(now);
  const k = key || DEFAULT_PERIOD;
  const start = fyStart(today, fiscalYearStart);
  if (k === "all") return { key: k, kind: "all", from: null, to: null };
  if (k === "30d" || k === "90d") {
    const days = k === "30d" ? 30 : 90;
    return { key: k, kind: k, from: new Date(today.getTime() - (days - 1) * 86400_000), to: today };
  }
  if (k === "lastyear") {
    const from = utc(start.getUTCFullYear() - 1, start.getUTCMonth(), 1);
    return { key: k, kind: "lastyear", from, to: new Date(start.getTime() - 86400_000), year: from.getUTCFullYear() };
  }
  const m = k.match(/^m(\d{4})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    if (mo >= 0 && mo < 12) return { key: k, kind: "month", from: utc(y, mo, 1), to: utc(y, mo + 1, 0), month: utc(y, mo, 1) };
  }
  // "year" and anything unrecognised.
  return { key: DEFAULT_PERIOD, kind: "year", from: start, to: utc(start.getUTCFullYear() + 1, start.getUTCMonth(), 0), year: start.getUTCFullYear() };
}

/** Prisma date filter for a period, e.g. `{ issueDate: dateWhere(p) }`. */
export function dateWhere(p: Period): { gte?: Date; lte?: Date } | undefined {
  if (!p.from && !p.to) return undefined;
  // Upper bound is end of day so DateTime columns (not only @db.Date) are included.
  return { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: new Date(p.to.getTime() + 86400_000 - 1) } : {}) };
}

export function inPeriod(p: Period, d: Date): boolean {
  if (p.from && d < p.from) return false;
  if (p.to && d.getTime() > p.to.getTime() + 86400_000 - 1) return false;
  return true;
}

/** Keys offered in the picker: quick ranges, then months of this and last financial year (newest first). */
export function periodChoices(fiscalYearStart = 1, now = new Date()): { quick: string[]; months: { year: number; keys: string[] }[]; older: string[] } {
  const today = todayUtc(now);
  const start = fyStart(today, fiscalYearStart);
  const prevStart = utc(start.getUTCFullYear() - 1, start.getUTCMonth(), 1);
  const groups: { year: number; keys: string[] }[] = [];
  for (let d = utc(today.getUTCFullYear(), today.getUTCMonth(), 1); d >= prevStart; d = utc(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)) {
    const fy = fyStart(d, fiscalYearStart).getUTCFullYear();
    let g = groups.find((x) => x.year === fy);
    if (!g) groups.push((g = { year: fy, keys: [] }));
    g.keys.push(`m${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return { quick: ["year", "30d", "90d"], months: groups, older: ["lastyear", "all"] };
}
