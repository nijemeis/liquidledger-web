"use server";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AdminError, auditStaff, staffAction, type StaffContext } from "@/lib/admin/staff";
import { roleLabelEn, sendInviteMail } from "@/lib/admin/users";
import { revokeAllStaffSessions, revokeAllUserSessions } from "@/lib/auth/session";
import { createStaffSetupLink, STAFF_SETUP_HOURS } from "@/lib/auth/staff-flow";
import { sendMail } from "@/lib/email";
import { getMessages } from "@/i18n/messages";
import { createT } from "@/i18n/t";
import { isLocale } from "@/i18n/config";

const ROLE = z.enum(["OWNER", "ADMIN", "BOOKKEEPER", "WAREHOUSE", "ACCOUNTANT", "READ_ONLY"]);

async function loadUser(ctx: StaffContext, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    include: { memberships: { include: { administration: { include: { client: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!user) throw new AdminError(ctx.t("admin.err.noUser"));
  const first = user.memberships[0]?.administration;
  return { user, clientId: first?.clientId ?? null, clientName: first?.client.name ?? "Liquid Ledger", administrationId: first?.id ?? null };
}

export async function resendInvite(userId: string) {
  return staffAction("users.support", async (ctx) => {
    const { user, clientId, clientName } = await loadUser(ctx, userId);
    if (user.status !== "INVITED") throw new AdminError(ctx.t("admin.err.notInvited", { name: user.name }));
    const role = user.memberships[0]?.role ?? "READ_ONLY";
    await sendInviteMail(user, clientName, role, ctx.staff.name);
    await auditStaff(ctx, { action: "user.invite_resend", summary: `Sent the invite again to ${user.email}`, clientId, targetType: "user", targetId: user.id });
    return { message: ctx.t("admin.users.resent", { email: user.email }) };
  });
}

export async function unlockUser(userId: string) {
  return staffAction("users.support", async (ctx) => {
    const { user, clientId } = await loadUser(ctx, userId);
    await prisma.user.update({ where: { id: user.id }, data: { status: user.status === "LOCKED" ? "ACTIVE" : user.status, lockedUntil: null, failedAttempts: 0, lockReason: null } });
    // Forget trusted devices so the next sign-in asks for 2FA again.
    await prisma.userDevice.updateMany({ where: { userId: user.id }, data: { trustedUntil: null } });
    await auditStaff(ctx, { action: "user.unlock", summary: `Unlocked ${user.name}${user.lockReason ? ` · was: ${user.lockReason}` : ""}`, clientId, targetType: "user", targetId: user.id });
    return { message: ctx.t("admin.users.unlocked", { name: user.name }) };
  });
}

export async function resetTwoFactor(userId: string) {
  return staffAction("users.support", async (ctx) => {
    const { user, clientId } = await loadUser(ctx, userId);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, smsEnabled: false } }),
      prisma.passkey.deleteMany({ where: { userId: user.id } }),
      prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
      prisma.userDevice.updateMany({ where: { userId: user.id }, data: { trustedUntil: null } }),
    ]);
    await revokeAllUserSessions(user.id);
    const ut = createT(getMessages(isLocale(user.locale) ? user.locale : "en"));
    await sendMail({ to: user.email, subject: ut("admin.email.resetSubject"), text: ut("admin.email.resetBody", { name: user.name }) });
    await auditStaff(ctx, { action: "user.2fa_reset", summary: `Reset 2FA for ${user.name} · passkeys, authenticator, recovery codes and sessions removed`, clientId, targetType: "user", targetId: user.id });
    return { message: ctx.t("admin.users.reset", { name: user.name }) };
  });
}

export async function signOutEverywhere(userId: string) {
  return staffAction("users.support", async (ctx) => {
    const { user, clientId } = await loadUser(ctx, userId);
    await revokeAllUserSessions(user.id);
    await auditStaff(ctx, { action: "user.sign_out_all", summary: `Signed ${user.name} out of all sessions`, clientId, targetType: "user", targetId: user.id });
    return { message: ctx.t("admin.users.signedOut", { name: user.name }) };
  });
}

export async function setUserDisabled(userId: string, disabled: boolean) {
  return staffAction("users.write", async (ctx) => {
    const { user, clientId } = await loadUser(ctx, userId);
    const status = disabled ? "DISABLED" : user.passwordHash ? "ACTIVE" : "INVITED";
    await prisma.user.update({ where: { id: user.id }, data: { status, lockedUntil: null, failedAttempts: 0 } });
    if (disabled) await revokeAllUserSessions(user.id);
    await auditStaff(ctx, {
      action: disabled ? "user.disable" : "user.enable",
      summary: `${disabled ? "Disabled" : "Enabled"} ${user.name}`,
      clientId,
      targetType: "user",
      targetId: user.id,
      before: { status: user.status },
      after: { status },
    });
    return { message: ctx.t(disabled ? "admin.users.disabled" : "admin.users.enabled", { name: user.name }) };
  });
}

export async function changeRole(userId: string, administrationId: string, role: Role) {
  return staffAction("users.write", async (ctx) => {
    const r = ROLE.safeParse(role);
    if (!r.success) throw new AdminError(ctx.t("admin.err.input"));
    const { user } = await loadUser(ctx, userId);
    const m = user.memberships.find((x) => x.administrationId === administrationId);
    if (!m) throw new AdminError(ctx.t("admin.err.noMembership"));
    if (m.role === r.data) return { message: ctx.t("admin.users.roleSame") };
    if (m.role === "OWNER") {
      const owners = await prisma.membership.count({ where: { administrationId, role: "OWNER", user: { status: { not: "DISABLED" } } } });
      if (owners <= 1) throw new AdminError(ctx.t("admin.err.lastOwner"));
    }
    await prisma.membership.update({ where: { id: m.id }, data: { role: r.data } });
    await auditStaff(ctx, {
      action: "user.role",
      summary: `Changed ${user.name}'s role ${roleLabelEn(m.role)} → ${roleLabelEn(r.data)}`,
      clientId: m.administration.clientId,
      administrationId,
      targetType: "user",
      targetId: user.id,
      before: { role: m.role },
      after: { role: r.data },
    });
    return { message: ctx.t("admin.users.roleChanged", { name: user.name, role: ctx.t(`admin.role.${r.data}`), client: m.administration.client.name }) };
  });
}

// ── Platform staff ──────────────────────────────────────────────────────────

export async function sendStaffSetupLink(staffId: string) {
  return staffAction("staff.manage", async (ctx) => {
    const staff = await prisma.staffUser.findUnique({ where: { id: String(staffId) } });
    if (!staff) throw new AdminError(ctx.t("admin.err.noUser"));
    const link = await createStaffSetupLink(staff.id);
    await sendMail({
      to: staff.email,
      subject: ctx.t("admin.email.staffSubject"),
      text: ctx.t("admin.email.staffBody", { name: staff.name, by: ctx.staff.name, link, hours: STAFF_SETUP_HOURS }),
    });
    await auditStaff(ctx, { action: "staff.setup_link", summary: `Sent a set-up link to ${staff.email}`, targetType: "staff", targetId: staff.id });
    return { message: ctx.t("admin.staff.linkSent", { email: staff.email }), link };
  });
}

const staffSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(320), role: z.enum(["SUPER_ADMIN", "SUPPORT", "FINANCE"]) });

export async function addStaff(input: z.input<typeof staffSchema>) {
  return staffAction("staff.manage", async (ctx) => {
    const v = staffSchema.safeParse(input);
    if (!v.success) throw new AdminError(ctx.t("admin.err.input"));
    if (await prisma.staffUser.findUnique({ where: { email: v.data.email } })) throw new AdminError(ctx.t("admin.err.exists"));
    const staff = await prisma.staffUser.create({ data: { ...v.data, status: "INVITED" } });
    await auditStaff(ctx, { action: "staff.create", summary: `Added staff member ${staff.email} as ${v.data.role.replace("_", " ").toLowerCase()}`, targetType: "staff", targetId: staff.id });
    const res = await sendStaffSetupLink(staff.id);
    if (!res.ok) throw new AdminError(res.error);
    return { message: ctx.t("admin.staff.added", { email: staff.email }), link: (res as { link?: string }).link };
  });
}

export async function setStaffDisabled(staffId: string, disabled: boolean) {
  return staffAction("staff.manage", async (ctx) => {
    if (staffId === ctx.staff.id) throw new AdminError(ctx.t("admin.err.self"));
    const staff = await prisma.staffUser.findUnique({ where: { id: String(staffId) }, include: { _count: { select: { passkeys: true } } } });
    if (!staff) throw new AdminError(ctx.t("admin.err.noUser"));
    const status = disabled ? "DISABLED" : staff._count.passkeys && staff.passwordHash ? "ACTIVE" : "INVITED";
    await prisma.staffUser.update({ where: { id: staff.id }, data: { status, lockedUntil: null, failedAttempts: 0 } });
    if (disabled) await revokeAllStaffSessions(staff.id);
    await auditStaff(ctx, { action: disabled ? "staff.disable" : "staff.enable", summary: `${disabled ? "Disabled" : "Enabled"} staff member ${staff.email}`, targetType: "staff", targetId: staff.id });
    return { message: ctx.t(disabled ? "admin.users.disabled" : "admin.users.enabled", { name: staff.name }) };
  });
}
