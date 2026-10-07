import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { requireStaff } from "@/lib/admin/staff";
import { LOCKED, NO_2FA, toUserRow, USER_ROW_INCLUDE } from "@/lib/admin/data";
import { TabLinks } from "@/components/ui";
import { UsersHeader, UsersTable, StaffTable } from "./users-table";

const TABS = ["all", "invited", "locked", "no2fa", "staff"] as const;
type Tab = (typeof TABS)[number];

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const ctx = await requireStaff("users.read");
  const sp = await searchParams;
  const { t } = await getI18n();
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "all";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const now = new Date();

  const filters: Record<Exclude<Tab, "staff">, Prisma.UserWhereInput> = {
    all: {},
    invited: { status: "INVITED" },
    locked: LOCKED(now),
    no2fa: NO_2FA,
  };
  const search: Prisma.UserWhereInput = q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {};

  const [counts, staffCount] = await Promise.all([
    Promise.all((["all", "invited", "locked", "no2fa"] as const).map((k) => prisma.user.count({ where: filters[k] }))),
    prisma.staffUser.count(),
  ]);

  const tabHref = (k: string) => `/admin/users${k === "all" ? "" : `?tab=${k}`}`;
  const tabs = (
    <TabLinks
      active={tab}
      tabs={TABS.map((k, i) => ({ key: k, label: t(`admin.users.tab.${k}`), count: k === "staff" ? staffCount : counts[i]!, href: tabHref(k) }))}
    />
  );

  let body: React.ReactNode;
  if (tab === "staff") {
    const staff = await prisma.staffUser.findMany({ include: { _count: { select: { passkeys: true } } }, orderBy: [{ createdAt: "asc" }, { email: "asc" }] });
    body = (
      <StaffTable
        canManage={ctx.can("staff.manage")}
        meId={ctx.staff.id}
        rows={staff.map((s) => ({
          id: s.id,
          name: s.name,
          email: s.email,
          role: s.role,
          passkey: s._count.passkeys > 0,
          status: s.lockedUntil && s.lockedUntil > now ? "LOCKED" : s.status,
          lastSignInAt: s.lastSignInAt?.toISOString() ?? null,
        }))}
      />
    );
  } else {
    const users = await prisma.user.findMany({ where: { AND: [filters[tab], search] }, include: USER_ROW_INCLUDE, orderBy: [{ createdAt: "asc" }], take: 300 });
    body = <UsersTable rows={users.map((u) => toUserRow(u, now))} caps={{ support: ctx.can("users.support"), write: ctx.can("users.write") }} />;
  }

  const clients = ctx.can("clients.write") ? await prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];

  return (
    <>
      <UsersHeader clients={clients} canInvite={ctx.can("clients.write")} canAddStaff={tab === "staff" && ctx.can("staff.manage")} q={q} tab={tab} />
      <div className="card card-clip">
        {tabs}
        {body}
      </div>
    </>
  );
}
