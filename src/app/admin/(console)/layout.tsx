import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getI18n } from "@/i18n/server";
import { requireStaff, type StaffCap } from "@/lib/admin/staff";
import { initialsOf } from "@/lib/admin/format";
import type { IconName } from "@/components/icon";
import { AdminShell, type AdminNavItem } from "./shell";

export const dynamic = "force-dynamic";

async function dbPing(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const { t } = await getI18n();
  const now = new Date();
  const [healthy, troubledClients, lockedUsers, passkeys] = await Promise.all([
    dbPing(),
    prisma.client.count({ where: { status: { in: ["PAST_DUE", "SUSPENDED"] } } }),
    prisma.user.count({ where: { OR: [{ status: "LOCKED" }, { lockedUntil: { gt: now } }] } }),
    prisma.passkey.count({ where: { staffId: ctx.staff.id } }),
  ]);

  const nav: [string, string, IconName, StaffCap | null, number][] = [
    ["overview", "/admin", "SquaresFour", null, 0],
    ["clients", "/admin/clients", "Buildings", "clients.read", troubledClients],
    ["users", "/admin/users", "Users", "users.read", lockedUsers],
    ["roles", "/admin/roles", "Key", null, 0],
    ["billing", "/admin/billing", "CreditCard", "billing.read", 0],
    ["audit", "/admin/audit", "ListMagnifyingGlass", "audit.read", 0],
    ["security", "/admin/security", "ShieldCheck", "policies.write", 0],
    ["rates", "/admin/rates", "Percent", "rates.write", 0],
  ];
  const items: AdminNavItem[] = nav
    .filter(([, , , cap]) => !cap || ctx.can(cap))
    .map(([key, href, icon, , badge]) => ({ key, href, icon, badge, label: t(`admin.nav.${key}`) }));

  return (
    <AdminShell
      nav={items}
      staff={{
        name: ctx.staff.name,
        initials: initialsOf(ctx.staff.name),
        meta: `${t(`admin.staffRole.${ctx.staff.role}`)} · ${passkeys ? t("admin.shell.twoFaPasskey") : t("admin.mfa.none")}`,
      }}
      healthy={healthy}
      appUrl={env.appUrl}
    >
      {children}
    </AdminShell>
  );
}
