"use server";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { appAction, auditApp, type AppContext } from "@/lib/app-context";
import type { Tx } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { sendMail } from "@/lib/email";
import { env } from "@/lib/env";
import { PLANS } from "@/lib/domain/setup";
import { PostingError } from "@/lib/domain/ledger";
import { getI18n } from "@/i18n/server";
import { ROLES } from "@/lib/permissions";

const roleSchema = z.enum(ROLES as [Role, ...Role[]]);
const ROLE_EN: Record<Role, string> = { OWNER: "Owner", ADMIN: "Admin", BOOKKEEPER: "Bookkeeper", WAREHOUSE: "Warehouse", ACCOUNTANT: "Accountant", READ_ONLY: "Read-only" };

async function tr(ctx: AppContext) {
  return (await getI18n(ctx.locale)).t;
}

/** Invite token created inside the same transaction as the user it belongs to. */
async function inviteToken(tx: Tx, userId: string, data: object) {
  const token = randomToken();
  await tx.emailToken.updateMany({ where: { userId, purpose: "INVITE", usedAt: null }, data: { usedAt: new Date() } });
  await tx.emailToken.create({ data: { userId, purpose: "INVITE", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 72 * 3600_000), data } });
  return token;
}

async function sendInvite(ctx: AppContext, to: { email: string; name: string }, role: Role, token: string) {
  await sendMail({
    to: to.email,
    subject: `${ctx.displayName} invited you to ${ctx.administration.legalName} on Liquid Ledger`,
    text:
      `Hi ${to.name},\n\n${ctx.displayName} invited you to the books of ${ctx.administration.legalName} on Liquid Ledger as ${ROLE_EN[role]}.\n\n` +
      `Accept the invite, choose a password and set up two-factor authentication (the link works for 72 hours):\n${env.appUrl}/invite?token=${token}\n\n— Liquid Ledger`,
  });
}

/** Distinct users across all live administrations of this client. */
async function clientUserIds(tx: Tx, clientId: string) {
  const rows = await tx.membership.findMany({ where: { administration: { clientId, deletedAt: null } }, select: { userId: true }, distinct: ["userId"] });
  return new Set(rows.map((r) => r.userId));
}

async function memberOfThis(tx: Tx, ctx: AppContext, membershipId: string) {
  const m = await tx.membership.findFirst({ where: { id: membershipId, administrationId: ctx.administration.id }, include: { user: true } });
  if (!m) throw new PostingError((await tr(ctx))("settings.err.notFound"));
  return m;
}

async function ownerCount(tx: Tx, ctx: AppContext) {
  return tx.membership.count({ where: { administrationId: ctx.administration.id, role: "OWNER" } });
}

function nameFromEmail(email: string) {
  return email
    .split("@")[0]!
    .replace(/[._-]+/g, " ")
    .replace(/\d+/g, "")
    .trim()
    .replace(/\b\p{L}/gu, (m) => m.toUpperCase()) || email;
}

export async function inviteUser(input: { email: string; role: string }) {
  return appAction("users", async (ctx, tx) => {
    const t = await tr(ctx);
    const p = z.object({ email: z.string().trim().toLowerCase().max(320).email(), role: roleSchema }).safeParse(input);
    if (!p.success) throw new PostingError(t("auth.emailInvalid"));
    const { email, role } = p.data;
    if (role === "OWNER" && ctx.role !== "OWNER") throw new PostingError(t("settings.users.onlyOwnerGrants"));
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) {
      const m = await tx.membership.findUnique({ where: { userId_administrationId: { userId: existing.id, administrationId: ctx.administration.id } } });
      if (m) throw new PostingError(t("settings.users.alreadyMember", { email }));
      if (existing.status === "DISABLED") throw new PostingError(t("settings.users.disabled"));
    }
    const limit = PLANS[ctx.administration.client.plan].users;
    const ids = await clientUserIds(tx, ctx.administration.clientId);
    if (limit !== null && !(existing && ids.has(existing.id)) && ids.size >= limit) throw new PostingError(t("settings.users.limitReached", { n: limit }));

    const user = existing ?? (await tx.user.create({ data: { email, name: nameFromEmail(email), status: "INVITED", locale: ctx.locale } }));
    await tx.membership.create({ data: { userId: user.id, administrationId: ctx.administration.id, role } });
    if (user.status === "INVITED") {
      const token = await inviteToken(tx, user.id, { inviter: ctx.displayName, administrationId: ctx.administration.id, role });
      await sendInvite(ctx, user, role, token);
    } else {
      await sendMail({
        to: user.email,
        subject: `You now have access to ${ctx.administration.legalName} on Liquid Ledger`,
        text: `Hi ${user.name},\n\n${ctx.displayName} gave you access to ${ctx.administration.legalName} as ${ROLE_EN[role]}. Sign in and switch administration from the sidebar:\n${env.appUrl}/login\n\n— Liquid Ledger`,
      });
    }
    await auditApp(ctx, "user.invite", `Invited ${email} as ${ROLE_EN[role]}`, { targetType: "user", targetId: user.id, after: { email, role } }, tx);
    return { message: user.status === "INVITED" ? t("settings.users.invited", { email, role: t(`settings.role.${role}`) }) : t("settings.users.added", { email, role: t(`settings.role.${role}`) }) };
  }, { revalidate: "/settings/users" });
}

export async function changeRole(input: { membershipId: string; role: string }) {
  return appAction("users", async (ctx, tx) => {
    const t = await tr(ctx);
    const p = z.object({ membershipId: z.string().max(64), role: roleSchema }).parse(input);
    const m = await memberOfThis(tx, ctx, p.membershipId);
    if (m.role === p.role) return { message: t("settings.users.roleUnchanged") };
    if ((p.role === "OWNER" || m.role === "OWNER") && ctx.role !== "OWNER") throw new PostingError(t("settings.users.onlyOwnerGrants"));
    if (m.role === "OWNER" && (await ownerCount(tx, ctx)) <= 1) throw new PostingError(t("settings.users.lastOwner"));
    await tx.membership.update({ where: { id: m.id }, data: { role: p.role } });
    await auditApp(ctx, "user.role_change", `Changed ${m.user.email} from ${ROLE_EN[m.role]} to ${ROLE_EN[p.role]}`, { targetType: "user", targetId: m.userId, before: { role: m.role }, after: { role: p.role } }, tx);
    return { message: t("settings.users.roleChanged", { name: m.user.name, role: t(`settings.role.${p.role}`) }) };
  }, { revalidate: "/settings/users" });
}

export async function removeMember(input: { membershipId: string }) {
  return appAction("users", async (ctx, tx) => {
    const t = await tr(ctx);
    const m = await memberOfThis(tx, ctx, z.string().max(64).parse(input.membershipId));
    if (m.userId === ctx.userId) throw new PostingError(t("settings.users.notYourself"));
    if (m.role === "OWNER" && ctx.role !== "OWNER") throw new PostingError(t("settings.users.onlyOwnerGrants"));
    if (m.role === "OWNER" && (await ownerCount(tx, ctx)) <= 1) throw new PostingError(t("settings.users.lastOwner"));
    await tx.membership.delete({ where: { id: m.id } });
    // Sessions opened in this administration end now.
    await tx.session.updateMany({ where: { userId: m.userId, administrationId: ctx.administration.id, revokedAt: null }, data: { revokedAt: new Date() } });
    const left = await tx.membership.count({ where: { userId: m.userId } });
    if (!left) await tx.emailToken.updateMany({ where: { userId: m.userId, purpose: "INVITE", usedAt: null }, data: { usedAt: new Date() } });
    await auditApp(ctx, "user.remove", `Removed ${m.user.email} (${ROLE_EN[m.role]})`, { targetType: "user", targetId: m.userId, before: { role: m.role } }, tx);
    return { message: t("settings.users.removed", { name: m.user.name }) };
  }, { revalidate: "/settings/users" });
}

export async function resendInvite(input: { membershipId: string }) {
  return appAction("users", async (ctx, tx) => {
    const t = await tr(ctx);
    const m = await memberOfThis(tx, ctx, z.string().max(64).parse(input.membershipId));
    if (m.user.status !== "INVITED") throw new PostingError(t("settings.users.notInvited"));
    const token = await inviteToken(tx, m.userId, { inviter: ctx.displayName, administrationId: ctx.administration.id, role: m.role });
    await sendInvite(ctx, m.user, m.role, token);
    await auditApp(ctx, "user.invite_resent", `Sent the invite to ${m.user.email} again`, { targetType: "user", targetId: m.userId }, tx);
    return { message: t("settings.users.resent", { email: m.user.email }) };
  }, { revalidate: "/settings/users" });
}
