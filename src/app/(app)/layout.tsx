import { cookies } from "next/headers";
import { requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { getMessages } from "@/i18n/messages";
import { I18nProvider } from "@/i18n/client";
import { ToastProvider } from "@/components/client";
import { canView, SCREEN_PERMISSION } from "@/lib/permissions";
import { initials } from "@/lib/format";
import { env } from "@/lib/env";
import { Shell, type NavGroup } from "./shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireApp();
  const { locale, t, fmt } = await getI18n(ctx.locale);
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const counts = await tenant(ctx, async (tx) => {
    const A = ctx.administration.id;
    const [bank, overdue, purchases, receipts] = await Promise.all([
      tx.bankTransaction.count({ where: { administrationId: A, status: "UNRECONCILED" } }),
      tx.salesInvoice.count({ where: { administrationId: A, status: "OPEN", dueDate: { lt: todayUtc } } }),
      tx.purchaseInvoice.count({ where: { administrationId: A, status: "TO_APPROVE" } }),
      tx.receipt.count({ where: { administrationId: A, status: { not: "BOOKED" } } }),
    ]);
    return { bank, sales: overdue, purchases, costs: receipts };
  });

  const can = (screen: string) => {
    const p = SCREEN_PERMISSION[screen];
    return p === null || p === undefined || canView(ctx.role, p);
  };
  const groups: NavGroup[] = [
    { label: null, items: [{ key: "dashboard", icon: "SquaresFour" }] },
    { label: t("common.group.daily"), items: [{ key: "bank", icon: "Bank" }, { key: "sales", icon: "FileText" }, { key: "purchases", icon: "Receipt" }, { key: "costs", icon: "Wallet" }, { key: "relations", icon: "AddressBook" }] },
    { label: t("common.group.trade"), items: [{ key: "products", icon: "Wine" }, { key: "stock", icon: "Package" }, { key: "excise", icon: "SealCheck" }, { key: "shipments", icon: "Boat" }] },
    { label: t("common.group.accounting"), items: [{ key: "vat", icon: "Percent" }, { key: "ledger", icon: "Books" }, { key: "reports", icon: "ChartLineUp" }] },
  ]
    .map((g) => ({
      label: g.label,
      items: g.items
        .filter((i) => can(i.key))
        .map((i) => ({ ...i, label: t(`common.nav.${i.key}`), href: `/${i.key}`, badge: (counts as Record<string, number>)[i.key] || 0 })),
    }))
    .filter((g) => g.items.length) as NavGroup[];

  const sidebarPref = (await cookies()).get("ll_sidebar")?.value;
  const fyStart = ctx.administration.fiscalYearStart;
  const fyYear = today.getMonth() + 1 >= fyStart ? today.getFullYear() : today.getFullYear() - 1;
  const support = ctx.supportSession;

  return (
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <ToastProvider>
        <Shell
          groups={groups}
          company={ctx.administration.legalName}
          fy={t("common.fy", { year: fyYear })}
          memberships={ctx.memberships}
          currentAdministrationId={ctx.administration.id}
          user={{ name: ctx.displayName, initials: initials(ctx.displayName), email: ctx.user?.email ?? ctx.staff?.email ?? "" }}
          locale={locale}
          initialSidebar={sidebarPref === "closed" ? "closed" : sidebarPref === "open" ? "open" : null}
          readOnly={ctx.readOnly}
          isSupportView={ctx.kind === "support"}
          adminUrl={env.adminUrl}
          banner={
            ctx.kind === "support" && support
              ? { tone: "brand", text: t("common.supportViewing", { client: ctx.administration.client.name, time: fmt.time(support.expiresAt) }), action: "endSupport" }
              : support
                ? { tone: "brand", text: t("common.supportBanner", { name: support.staff.name, time: fmt.time(support.expiresAt), reason: support.reason }) }
                : ctx.readOnlyReason === "suspended"
                  ? { tone: "warn", text: t("common.suspendedBanner") }
                  : ctx.administration.client.status === "TRIAL" && ctx.administration.client.trialEndsAt
                    ? { tone: "info", text: t("common.trialBanner", { days: Math.max(0, Math.ceil((ctx.administration.client.trialEndsAt.getTime() - Date.now()) / 86400_000)) }) }
                    : null
          }
        >
          {children}
        </Shell>
      </ToastProvider>
    </I18nProvider>
  );
}
