import { accountName } from "@/lib/domain/chart";
import { fiscalYearOf } from "@/lib/domain/reports";
import { getI18n } from "@/i18n/server";
import { csvResponse, parseDay, withExport, type Cell } from "../csv";

export const dynamic = "force-dynamic";

/** Accountant export: every journal line in a date range, with account names, VAT code and relation. */
export async function GET(req: Request) {
  return withExport("reports", async (ctx, tx, f) => {
    const { t } = await getI18n(ctx.locale);
    const A = ctx.administration.id;
    const sp = new URL(req.url).searchParams;
    const fy = fiscalYearOf(new Date(), ctx.administration.fiscalYearStart);
    const from = parseDay(sp.get("from")) ?? fy.start;
    const to = parseDay(sp.get("to")) ?? fy.end;
    const lang = ctx.administration.ledgerLanguage;
    const [entries, accounts] = await Promise.all([
      tx.journalEntry.findMany({ where: { administrationId: A, date: { gte: from, lte: to } }, orderBy: [{ date: "asc" }, { number: "asc" }], include: { lines: true } }),
      tx.ledgerAccount.findMany({ where: { administrationId: A } }),
    ]);
    const relIds = [...new Set(entries.flatMap((e) => e.lines.map((l) => l.relationId)).filter((x): x is string => !!x))];
    const rels = relIds.length ? await tx.relation.findMany({ where: { administrationId: A, id: { in: relIds } }, select: { id: true, name: true, vatNumber: true } }) : [];
    const acc = new Map(accounts.map((a) => [a.code, a]));
    const rel = new Map(rels.map((r) => [r.id, r]));
    const rows: Cell[][] = [
      [t("reports.csv.date"), t("reports.csv.entry"), t("reports.csv.source"), t("reports.csv.title"), t("reports.csv.account"), t("reports.csv.accountName"), t("reports.csv.debit"), t("reports.csv.credit"), t("reports.csv.vatCode"), t("reports.csv.vatBase"), t("reports.csv.relation"), t("reports.csv.relationVat"), t("reports.csv.description")],
    ];
    for (const e of entries)
      for (const l of e.lines) {
        const a = acc.get(l.accountCode);
        const r = l.relationId ? rel.get(l.relationId) : undefined;
        rows.push([f.date(e.date), e.number, e.source, e.title, l.accountCode, a ? accountName(a, lang) : "", f.money(l.debitCents), f.money(l.creditCents), l.vatCode ?? "", l.vatBaseCents === null ? "" : f.money(l.vatBaseCents), r?.name ?? "", r?.vatNumber ?? "", l.description ?? ""]);
      }
    return csvResponse(`journal-${f.date(from)}-${f.date(to)}.csv`, rows, f.sep);
  });
}
