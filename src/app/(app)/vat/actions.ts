"use server";
import { z } from "zod";
import { appAction, auditApp } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { PostingError } from "@/lib/domain/ledger";
import { markFiled, parsePeriod, vatReturn } from "@/lib/domain/returns";
import { makeFormatters } from "@/lib/format";

const FileInput = z.object({ period: z.string().regex(/^\d{4}-(Q[1-4]|\d{2})$/), reference: z.string().trim().min(3).max(80) });

/** Record the VAT return as submitted in the Belastingdienst portal (we don't submit via Digipoort yet). */
export async function fileVat(input: { period: string; reference: string }) {
  return appAction("fileVat", async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const parsed = FileInput.safeParse(input);
    if (!parsed.success) throw new PostingError(t("vat.err.reference"));
    const p = parsePeriod(parsed.data.period);
    if (!p) throw new PostingError(t("vat.err.period"));
    const monthly = ctx.administration.vatPeriod === "MONTHLY";
    if (monthly === p.key.includes("Q")) throw new PostingError(t("vat.err.periodKind", { kind: monthly ? (ctx.locale === "nl" ? "maand" : "month") : ctx.locale === "nl" ? "kwartaal" : "quarter" }));
    const now = new Date();
    if (p.end.getTime() >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) throw new PostingError(t("vat.err.notEnded"));
    const A = ctx.administration.id;
    const ret = await vatReturn(tx, A, p);
    const before = ret.filed?.status === "FILED" ? ret.filed.filedRef : null;
    const boxes = Object.fromEntries(ret.rows.map((r) => [r.box, { base: r.baseCents, vat: r.vatCents }]));
    const rec = await markFiled(tx, {
      administrationId: A,
      type: "VAT",
      period: p,
      boxes: { ...boxes, icp: ret.icp.map((r) => ({ name: r.name, vatNumber: r.vatNumber, amountCents: r.amountCents })) },
      totalCents: ret.payableCents,
      reference: parsed.data.reference,
      userId: ctx.userId ?? "",
    });
    const en = makeFormatters("en");
    await auditApp(
      ctx,
      "vat.file",
      before
        ? `VAT return ${p.key}: filing reference changed from ${before} to ${parsed.data.reference}`
        : `VAT return ${p.key} recorded as submitted · ${ret.payableCents >= 0 ? "to pay" : "to reclaim"} ${en.money(Math.abs(ret.payableCents))} · ref ${parsed.data.reference}`,
      { targetType: "tax_return", targetId: rec.id, before: before ? { filedRef: before } : undefined, after: { period: p.key, payableCents: ret.payableCents, filedRef: parsed.data.reference } },
      tx,
    );
    const label = p.key.replace(/^(\d{4})-Q(\d)$/, ctx.locale === "nl" ? "K$2 $1" : "Q$2 $1");
    return {
      message: before
        ? t("vat.toast.refChanged", { ref: parsed.data.reference })
        : t(ret.payableCents >= 0 ? "vat.toast.filedPay" : "vat.toast.filedReclaim", {
            period: p.key.includes("Q") ? label : fmt.monthLong(p.start),
            amount: fmt.money(Math.abs(ret.payableCents)),
            date: fmt.dateMed(ret.due),
            ref: parsed.data.reference,
          }),
    };
  });
}
