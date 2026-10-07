"use server";
import { z } from "zod";
import { appAction, auditApp } from "@/lib/app-context";
import { PostingError } from "@/lib/domain/ledger";
import { CATEGORY_BY_KEY } from "@/lib/domain/categories";
import { getI18n } from "@/i18n/server";

const schema = z.object({
  id: z.string().max(64),
  matchType: z.enum(["supplier", "iban", "description"]),
  pattern: z.string().trim().min(1).max(120),
  categoryKey: z.string().max(40).nullable(),
  accountCode: z.string().trim().max(10).nullable(),
  vatRateBp: z.number().int().min(0).max(10000).nullable(),
});

export async function updateRule(input: z.input<typeof schema>) {
  return appAction("purchases", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const p = schema.safeParse(input);
    if (!p.success) throw new PostingError(t("settings.rules.invalid"));
    const d = p.data;
    const rule = await tx.bookingRule.findFirst({ where: { id: d.id, administrationId: ctx.administration.id } });
    if (!rule) throw new PostingError(t("settings.err.notFound"));
    if (d.categoryKey && !CATEGORY_BY_KEY[d.categoryKey]) throw new PostingError(t("settings.rules.invalid"));
    const accountCode = d.accountCode || (d.categoryKey ? CATEGORY_BY_KEY[d.categoryKey]!.account : null);
    if (!accountCode && !d.categoryKey) throw new PostingError(t("settings.rules.needTarget"));
    if (accountCode) {
      const acc = await tx.ledgerAccount.findFirst({ where: { administrationId: ctx.administration.id, code: accountCode, active: true } });
      if (!acc) throw new PostingError(t("settings.rules.unknownAccount", { code: accountCode }));
    }
    const data = { matchType: d.matchType, pattern: d.pattern, categoryKey: d.categoryKey, accountCode, vatRateBp: d.vatRateBp };
    await tx.bookingRule.update({ where: { id: rule.id }, data });
    await auditApp(
      ctx,
      "rule.update",
      `Changed booking rule "${rule.pattern}"${rule.pattern !== d.pattern ? ` → "${d.pattern}"` : ""} · ${accountCode ?? d.categoryKey}`,
      { targetType: "booking_rule", targetId: rule.id, before: { matchType: rule.matchType, pattern: rule.pattern, categoryKey: rule.categoryKey, accountCode: rule.accountCode, vatRateBp: rule.vatRateBp }, after: data },
      tx,
    );
    return { message: t("settings.rules.saved", { pattern: d.pattern }) };
  }, { revalidate: "/settings/rules" });
}

export async function deleteRule(input: { id: string }) {
  return appAction("purchases", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const id = z.string().max(64).parse(input.id);
    const rule = await tx.bookingRule.findFirst({ where: { id, administrationId: ctx.administration.id } });
    if (!rule) throw new PostingError(t("settings.err.notFound"));
    // Receipts keep their booking; only the link to the rule goes.
    await tx.receipt.updateMany({ where: { administrationId: ctx.administration.id, ruleId: rule.id }, data: { ruleId: null } });
    await tx.bookingRule.delete({ where: { id: rule.id } });
    await auditApp(ctx, "rule.delete", `Deleted booking rule "${rule.pattern}" (used ${rule.timesUsed}×)`, { targetType: "booking_rule", targetId: rule.id, before: { matchType: rule.matchType, pattern: rule.pattern, categoryKey: rule.categoryKey, accountCode: rule.accountCode } }, tx);
    return { message: t("settings.rules.deleted", { pattern: rule.pattern }) };
  }, { revalidate: "/settings/rules" });
}
