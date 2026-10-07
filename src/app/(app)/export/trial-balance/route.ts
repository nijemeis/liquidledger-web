import { accountName } from "@/lib/domain/chart";
import { fiscalYearOf, trialBalance } from "@/lib/domain/reports";
import { getI18n } from "@/i18n/server";
import { csvResponse, parseDay, withExport, type Cell } from "../csv";

export const dynamic = "force-dynamic";

/**
 * Trial balance: opening balance (everything before `from`), debit and credit
 * movements in the range, and the closing balance per account.
 */
export async function GET(req: Request) {
  return withExport("reports", async (ctx, tx, f) => {
    const { t } = await getI18n(ctx.locale);
    const A = ctx.administration.id;
    const sp = new URL(req.url).searchParams;
    const fy = fiscalYearOf(new Date(), ctx.administration.fiscalYearStart);
    const from = parseDay(sp.get("from")) ?? fy.start;
    const to = parseDay(sp.get("to")) ?? fy.end;
    const lang = ctx.administration.ledgerLanguage;
    const [moves, opening] = await Promise.all([trialBalance(tx, A, { from, to }), trialBalance(tx, A, { to: new Date(from.getTime() - 86400_000) })]);
    const codes = [...new Set([...moves.map((m) => m.code), ...opening.map((o) => o.code)])].sort();
    const rows: Cell[][] = [[t("reports.csv.account"), t("reports.csv.accountName"), t("reports.csv.type"), t("reports.csv.opening"), t("reports.csv.debit"), t("reports.csv.credit"), t("reports.csv.closing")]];
    let sd = 0;
    let sc = 0;
    let so = 0;
    for (const code of codes) {
      const m = moves.find((x) => x.code === code);
      const o = opening.find((x) => x.code === code);
      const a = (m ?? o)!;
      const ob = o?.balanceCents ?? 0;
      sd += m?.debitCents ?? 0;
      sc += m?.creditCents ?? 0;
      so += ob;
      rows.push([code, accountName(a, lang), a.type, f.money(ob), f.money(m?.debitCents ?? 0), f.money(m?.creditCents ?? 0), f.money(ob + (m?.balanceCents ?? 0))]);
    }
    rows.push([t("common.total"), "", "", f.money(so), f.money(sd), f.money(sc), f.money(so + sd - sc)]);
    return csvResponse(`trial-balance-${f.date(from)}-${f.date(to)}.csv`, rows, f.sep);
  });
}
