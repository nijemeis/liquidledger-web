import { profitAndLoss } from "@/lib/domain/reports";
import { monthOf, parsePeriod } from "@/lib/domain/returns";
import { getI18n } from "@/i18n/server";
import { csvResponse, withExport, type Cell } from "../csv";

export const dynamic = "force-dynamic";

/** Profit & loss for a month vs the month before, plus year to date. */
export async function GET(req: Request) {
  return withExport("reports", async (ctx, tx, f) => {
    const { t, locale } = await getI18n(ctx.locale);
    const lang = locale === "nl" ? "nl" : "en";
    const now = new Date();
    const asked = parsePeriod(new URL(req.url).searchParams.get("month"));
    const m = asked && !asked.key.includes("Q") ? asked : monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    const pl = await profitAndLoss(tx, ctx.administration.id, m.start, ctx.administration.fiscalYearStart);
    const prev = monthOf(pl.prevMonth);
    const rows: Cell[][] = [
      [ctx.administration.legalName, t("reports.pl")],
      ["", m.key, prev.key, t("reports.ytd")],
      ...pl.lines.map((l) => [l.label[lang], f.money(l.cur), f.money(l.prev), f.money(l.ytd)]),
    ];
    return csvResponse(`profit-and-loss-${m.key}.csv`, rows, f.sep);
  });
}
