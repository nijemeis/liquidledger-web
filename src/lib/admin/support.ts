import "server-only";
import { prisma } from "../db";
import { randomToken, sha256 } from "../crypto";
import { env } from "../env";
import { FIXED } from "../policies";
import { requestMeta } from "../request";
import { audit } from "../audit";
import { sendMail } from "../email";
import { AdminError, type StaffContext } from "./staff";
import { getMessages } from "@/i18n/messages";
import { createT } from "@/i18n/t";
import { isLocale } from "@/i18n/config";

// Support access: a time-boxed, reasoned, audited read-only view of a client's
// app. The admin console opens a SupportSession; a one-time handoff token
// (2 min) carries the staff member to the app host, where /support/enter turns
// it into a Session (kind STAFF, with supportSessionId) behind COOKIE.support.

const HANDOFF_MINUTES = 2;

export async function activeSupportSession(clientId: string, staffId?: string) {
  return prisma.supportSession.findFirst({
    where: { clientId, endedAt: null, expiresAt: { gt: new Date() }, ...(staffId ? { staffId } : {}) },
    include: { staff: true },
    orderBy: { startedAt: "desc" },
  });
}

export async function openSupportSession(ctx: StaffContext, clientId: string, reasonRaw: string) {
  const reason = reasonRaw.trim().replace(/\s+/g, " ").slice(0, 300);
  if (reason.length < 3) throw new AdminError(ctx.t("admin.err.reason"));
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new AdminError(ctx.t("admin.err.noClient"));
  // One open session per staff member per client: close an earlier one first.
  await endSupportSessions({ clientId, staffId: ctx.staff.id }, null);
  const session = await prisma.supportSession.create({
    data: { staffId: ctx.staff.id, clientId, reason, expiresAt: new Date(Date.now() + FIXED.supportSessionMinutes * 60_000) },
  });
  await audit({
    actor: ctx.actor,
    action: "support.open",
    summary: `Opened support access · ${reason} · ${FIXED.supportSessionMinutes} min`,
    clientId,
    targetType: "support_session",
    targetId: session.id,
  });
  // Tell the client's owners.
  const owners = await prisma.user.findMany({
    where: { status: { in: ["ACTIVE", "LOCKED"] }, memberships: { some: { role: "OWNER", administration: { clientId } } } },
    select: { email: true, name: true, locale: true },
  });
  for (const o of owners) {
    const t = createT(getMessages(isLocale(o.locale) ? o.locale : "en"));
    await sendMail({
      to: o.email,
      subject: t("admin.email.supportSubject"),
      text: t("admin.email.supportBody", { name: o.name, staff: ctx.staff.name, client: client.name, minutes: FIXED.supportSessionMinutes, reason }),
    });
  }
  return { session, notified: owners.length };
}

/** End support sessions (and revoke the app sessions created from them). */
export async function endSupportSessions(where: { id?: string; clientId?: string; staffId?: string }, ctx: StaffContext | null) {
  const open = await prisma.supportSession.findMany({ where: { ...where, endedAt: null } });
  if (!open.length) return 0;
  const ids = open.map((s) => s.id);
  const now = new Date();
  await prisma.supportSession.updateMany({ where: { id: { in: ids } }, data: { endedAt: now } });
  await prisma.session.updateMany({ where: { supportSessionId: { in: ids }, revokedAt: null }, data: { revokedAt: now } });
  if (ctx) {
    for (const s of open.filter((s) => s.expiresAt > now)) {
      await audit({ actor: ctx.actor, action: "support.end", summary: `Ended support access · ${s.reason}`, clientId: s.clientId, targetType: "support_session", targetId: s.id });
    }
  }
  return open.length;
}

/** Admin side: end one support session. */
export async function endSupportSession(ctx: StaffContext, supportSessionId: string) {
  const s = await prisma.supportSession.findUnique({ where: { id: supportSessionId } });
  if (!s) throw new AdminError(ctx.t("admin.err.noSupport"));
  if (s.staffId !== ctx.staff.id && ctx.staff.role !== "SUPER_ADMIN") throw new AdminError(ctx.t("admin.err.notYourSupport"));
  return endSupportSessions({ id: s.id }, ctx);
}

/** App side: the staff member clicked "End support session" in the client app. */
export async function endSupportSessionFromApp(supportSessionId: string, staffId: string) {
  const s = await prisma.supportSession.findUnique({ where: { id: supportSessionId }, include: { staff: true } });
  if (!s || s.staffId !== staffId || s.endedAt) return;
  const now = new Date();
  await prisma.supportSession.update({ where: { id: s.id }, data: { endedAt: now } });
  await prisma.session.updateMany({ where: { supportSessionId: s.id, revokedAt: null }, data: { revokedAt: now } });
  await audit({ actor: { type: "STAFF", id: s.staff.id, label: s.staff.name }, action: "support.end", summary: `Ended support access · ${s.reason}`, clientId: s.clientId, targetType: "support_session", targetId: s.id });
}

/** One-time link that carries the staff member into the client app. */
export async function createSupportHandoff(ctx: StaffContext, supportSessionId: string): Promise<string> {
  const s = await prisma.supportSession.findUnique({ where: { id: supportSessionId } });
  if (!s || s.staffId !== ctx.staff.id) throw new AdminError(ctx.t("admin.err.openSupportFirst"));
  if (s.endedAt || s.expiresAt <= new Date()) throw new AdminError(ctx.t("admin.err.supportEnded"));
  const token = randomToken();
  await prisma.authChallenge.create({
    data: {
      kind: "STAFF",
      tokenHash: sha256(token),
      staffId: ctx.staff.id,
      stage: "support_handoff",
      data: { supportSessionId: s.id },
      expiresAt: new Date(Date.now() + HANDOFF_MINUTES * 60_000),
    },
  });
  return `${env.appUrl}/support/enter?token=${encodeURIComponent(token)}`;
}

/**
 * App side: consume a handoff token. Returns the new session token and its
 * expiry, or null when the token is unknown, used or expired.
 */
export async function consumeSupportHandoff(token: string): Promise<{ token: string; expiresAt: Date } | null> {
  if (!token || token.length > 200) return null;
  const ch = await prisma.authChallenge.findUnique({ where: { tokenHash: sha256(token) } });
  if (!ch || ch.kind !== "STAFF" || ch.stage !== "support_handoff" || !ch.staffId) return null;
  // Single use: whoever deletes the row wins.
  const del = await prisma.authChallenge.deleteMany({ where: { id: ch.id } });
  if (del.count !== 1 || ch.expiresAt.getTime() < Date.now()) return null;
  const supportSessionId = (ch.data as { supportSessionId?: string } | null)?.supportSessionId;
  if (!supportSessionId) return null;
  const support = await prisma.supportSession.findUnique({ where: { id: supportSessionId }, include: { staff: true } });
  if (!support || support.staffId !== ch.staffId || support.endedAt || support.expiresAt <= new Date()) return null;
  if (support.staff.status !== "ACTIVE") return null;
  const administration = await prisma.administration.findFirst({ where: { clientId: support.clientId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  if (!administration) return null;
  const meta = await requestMeta();
  const sessionToken = randomToken();
  await prisma.session.create({
    data: {
      kind: "STAFF",
      tokenHash: sha256(sessionToken),
      staffId: support.staffId,
      supportSessionId: support.id,
      administrationId: administration.id,
      authMethod: "support handoff",
      ip: meta.ip,
      userAgent: meta.userAgent,
      idleTimeoutMin: FIXED.sessionIdleMinutes,
      expiresAt: support.expiresAt,
    },
  });
  await audit({
    actor: { type: "STAFF", id: support.staff.id, label: support.staff.name },
    action: "support.enter",
    summary: `Opened the client app read-only · ${support.reason}`,
    clientId: support.clientId,
    administrationId: administration.id,
    targetType: "support_session",
    targetId: support.id,
  });
  return { token: sessionToken, expiresAt: support.expiresAt };
}
