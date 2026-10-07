import { parsePeriod, previousPeriod, vatReturn } from "@/lib/domain/returns";
import { getI18n } from "@/i18n/server";
import { csvResponse, withExport, type Cell } from "../csv";

export const dynamic = "force-dynamic";

/** VAT return (boxes + ICP listing) for one period as CSV. */
export async function GET(req: Request) {
  return withExport("fileVat", async (ctx, tx, f) => {
    const { t, locale } = await getI18n(ctx.locale);
    const lang = locale === "nl" ? "nl" : "en";
    const now = new Date();
    const monthly = ctx.administration.vatPeriod === "MONTHLY";
    const asked = parsePeriod(new URL(req.url).searchParams.get("period"));
    const p = asked ?? previousPeriod(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), monthly);
    const ret = await vatReturn(tx, ctx.administration.id, p);
    const rows: Cell[][] = [
      [t("vat.csv.administration"), ctx.administration.legalName],
      [t("vat.csv.vatNumber"), ctx.administration.vatNumber ?? ""],
      [t("vat.csv.period"), p.key, f.date(p.start), f.date(p.end)],
      [t("vat.csv.due"), f.date(ret.due)],
      [t("vat.csv.filedRef"), ret.filed?.filedRef ?? ""],
      [],
      [t("vat.box"), t("vat.description"), t("vat.turnover"), t("vat.csv.turnoverRounded"), t("vat.vat")],
      ...ret.rows.map((r) => [
        r.box,
        r.label[lang],
        f.money(r.baseCents),
        r.baseCents === null ? "" : Math.floor(r.baseCents / 100),
        f.money(r.vatCents === null ? null : r.kind === "input" ? -r.vatCents : r.vatCents),
      ]),
      [],
      [t("vat.icpTitle")],
      [t("vat.csv.customer"), t("vat.csv.vatNumber"), t("vat.csv.vies"), t("common.amount")],
      ...ret.icp.map((c) => [c.name, c.vatNumber, c.viesValid === true ? "OK" : c.viesValid === false ? "INVALID" : "", f.money(c.amountCents)]),
    ];
    return csvResponse(`vat-${p.key}.csv`, rows, f.sep);
  });
}
