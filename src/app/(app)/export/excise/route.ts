import { exciseReturn, monthOf, parsePeriod } from "@/lib/domain/returns";
import { getI18n } from "@/i18n/server";
import { csvResponse, withExport, type Cell } from "../csv";

export const dynamic = "force-dynamic";

/** Excise return for one month as CSV (the figures to enter in the Customs portal). */
export async function GET(req: Request) {
  return withExport("fileExcise", async (ctx, tx, f) => {
    const { t } = await getI18n(ctx.locale);
    const now = new Date();
    const asked = parsePeriod(new URL(req.url).searchParams.get("period"));
    const p = asked && !asked.key.includes("Q") ? asked : monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    const ret = await exciseReturn(tx, ctx.administration.id, p);
    const rows: Cell[][] = [
      [t("excise.csv.administration"), ctx.administration.legalName],
      [t("excise.fig.licence"), ret.licence ?? ""],
      [t("excise.csv.period"), f.date(p.start), f.date(p.end)],
      [t("excise.csv.due"), f.date(ret.due)],
      [t("excise.csv.filedRef"), ret.filed?.filedRef ?? ""],
      [],
      [t("excise.csv.sku"), t("excise.col.product"), t("excise.col.category"), t("excise.col.bottles"), t("excise.col.hl"), t("excise.csv.alcoholHl"), t("excise.csv.basis"), t("excise.csv.rate"), t("excise.col.excise")],
      ...ret.rows.map((r) => [r.sku, r.name, r.category, r.units, f.num(r.hl, 4), f.num(r.alcoholHl, 4), r.basisKind ?? "", f.money(r.rateCents), f.money(r.exciseCents)]),
      [t("common.total"), "", "", ret.releasedUnits, "", "", "", "", f.money(ret.totalCents)],
      [],
      [t("excise.suspended"), ret.shippedSuspendedUnits],
    ];
    return csvResponse(`excise-${p.key}.csv`, rows, f.sep);
  });
}
