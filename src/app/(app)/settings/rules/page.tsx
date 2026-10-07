import type { Metadata } from "next";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { CATEGORIES, CATEGORY_BY_KEY, categoryLabel } from "@/lib/domain/categories";
import { RulesClient, type RuleRow } from "./rules-client";

export const metadata: Metadata = { title: "Booking rules" };
export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const ctx = await requireApp("purchases");
  const { t, fmt, locale } = await getI18n(ctx.locale);
  const A = ctx.administration.id;
  const { rules, accounts } = await tenant(ctx, async (tx) => ({
    rules: await tx.bookingRule.findMany({ where: { administrationId: A }, orderBy: [{ timesUsed: "desc" }, { createdAt: "desc" }] }),
    accounts: await tx.ledgerAccount.findMany({ where: { administrationId: A, active: true, type: { in: ["COST", "ASSET", "LIABILITY", "REVENUE", "EQUITY"] } }, orderBy: { code: "asc" }, select: { code: true, nameNl: true, nameEn: true, type: true } }),
  }));
  const accName = (code: string | null) => {
    const a = code ? accounts.find((x) => x.code === code) : null;
    return a ? (ctx.administration.ledgerLanguage === "nl" ? a.nameNl : a.nameEn) : null;
  };
  const rows: RuleRow[] = rules.map((r) => {
    const cat = r.categoryKey ? CATEGORY_BY_KEY[r.categoryKey] : undefined;
    const code = r.accountCode ?? cat?.account ?? null;
    return {
      id: r.id,
      matchType: r.matchType as RuleRow["matchType"],
      pattern: r.pattern,
      categoryKey: r.categoryKey,
      category: cat ? categoryLabel(cat, locale) : null,
      icon: cat?.icon ?? "Books",
      accountCode: r.accountCode,
      account: code ? `${code} ${accName(code) ?? ""}`.trim() : "—",
      vatRateBp: r.vatRateBp,
      vat: r.vatRateBp === null ? t("settings.rules.vatDefault") : fmt.pct(r.vatRateBp),
      timesUsed: r.timesUsed,
      created: fmt.dateMed(r.createdAt),
    };
  });
  return (
    <RulesClient
      rows={rows}
      canEdit={canEditIn(ctx, "purchases")}
      categories={CATEGORIES.filter((c) => !c.importOnly).map((c) => ({ key: c.key, label: categoryLabel(c, locale), account: c.account }))}
      accounts={accounts.filter((a) => a.type === "COST" || a.type === "ASSET").map((a) => ({ code: a.code, name: ctx.administration.ledgerLanguage === "nl" ? a.nameNl : a.nameEn }))}
    />
  );
}
