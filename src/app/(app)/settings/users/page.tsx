import type { Metadata } from "next";
import { canEditIn, requireApp } from "@/lib/app-context";
import { prisma } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { PLANS } from "@/lib/domain/setup";
import { ROLES } from "@/lib/permissions";
import { initials } from "@/lib/format";
import { UsersClient, type MemberRow } from "./users-client";

export const metadata: Metadata = { title: "Users & roles" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const ctx = await requireApp("users");
  const { t, fmt } = await getI18n(ctx.locale);
  // Memberships and users are platform tables (not tenant-scoped); always filter on this administration.
  const [members, clientUsers, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { administrationId: ctx.administration.id },
      include: { user: { include: { _count: { select: { passkeys: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.membership.findMany({ where: { administration: { clientId: ctx.administration.clientId, deletedAt: null } }, select: { userId: true }, distinct: ["userId"] }),
    prisma.emailToken.findMany({ where: { purpose: "INVITE", usedAt: null, user: { memberships: { some: { administrationId: ctx.administration.id } } } }, select: { userId: true, expiresAt: true } }),
  ]);
  const inviteExp = new Map(invites.map((i) => [i.userId, i.expiresAt]));
  const rows: MemberRow[] = members.map((m) => {
    const u = m.user;
    const methods = [u.totpSecretEnc && u.totpEnabledAt ? t("settings.users.mfaApp") : null, u._count.passkeys ? t("settings.users.mfaPasskey", { n: u._count.passkeys }) : null, u.smsEnabled && u.phone ? t("settings.users.mfaSms") : null].filter(Boolean) as string[];
    const exp = inviteExp.get(u.id);
    return {
      id: m.id,
      userId: u.id,
      name: u.name,
      email: u.email,
      initials: initials(u.name || u.email),
      role: m.role,
      mfa: methods.join(" · "),
      lastSignIn: u.lastSignInAt ? fmt.dateTime(u.lastSignInAt) : null,
      status: u.status,
      inviteNote: u.status === "INVITED" ? (exp && exp > new Date() ? t("settings.users.inviteExpires", { date: fmt.dateTime(exp) }) : t("settings.users.inviteExpired")) : null,
      isYou: u.id === ctx.userId,
    };
  });
  const plan = ctx.administration.client.plan;
  const limit = PLANS[plan].users;
  return (
    <UsersClient
      rows={rows}
      canEdit={canEditIn(ctx, "users")}
      isOwner={ctx.role === "OWNER"}
      roles={ROLES.map((r) => ({ key: r, label: t(`settings.role.${r}`), desc: t(`settings.roleDesc.${r}`) }))}
      planLabel={t(`settings.plan.${plan}`)}
      used={clientUsers.length}
      limit={limit}
      company={ctx.administration.legalName}
    />
  );
}
