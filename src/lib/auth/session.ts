import "server-only";
import { cache } from "react";
import type { Session, StaffUser, User } from "@prisma/client";
import { prisma } from "../db";
import { randomToken, sha256 } from "../crypto";
import { FIXED } from "../policies";
import { requestMeta } from "../request";
import { COOKIE, deleteCookie, getCookie, setCookie } from "./cookies";

const TOUCH_INTERVAL_MS = 60_000;

export async function createUserSession(user: Pick<User, "id" | "lastAdministrationId">, authMethod: string, idleMinutes: number) {
  const token = randomToken();
  const meta = await requestMeta();
  const session = await prisma.session.create({
    data: {
      kind: "USER",
      tokenHash: sha256(token),
      userId: user.id,
      administrationId: user.lastAdministrationId,
      authMethod,
      ip: meta.ip,
      userAgent: meta.userAgent,
      idleTimeoutMin: idleMinutes,
      expiresAt: new Date(Date.now() + FIXED.sessionAbsoluteHours * 3600_000),
    },
  });
  await setCookie(COOKIE.session, token, FIXED.sessionAbsoluteHours * 3600);
  return session;
}

export async function createStaffSession(staff: Pick<StaffUser, "id">, authMethod: string) {
  const token = randomToken();
  const meta = await requestMeta();
  const session = await prisma.session.create({
    data: {
      kind: "STAFF",
      tokenHash: sha256(token),
      staffId: staff.id,
      authMethod,
      ip: meta.ip,
      userAgent: meta.userAgent,
      idleTimeoutMin: FIXED.sessionIdleMinutes,
      expiresAt: new Date(Date.now() + FIXED.sessionAbsoluteHours * 3600_000),
    },
  });
  await setCookie(COOKIE.staff, token, FIXED.sessionAbsoluteHours * 3600);
  return session;
}

function alive(s: Session): boolean {
  const now = Date.now();
  if (s.revokedAt) return false;
  if (s.expiresAt.getTime() <= now) return false;
  if (s.lastSeenAt.getTime() + s.idleTimeoutMin * 60_000 <= now) return false;
  return true;
}

async function touch(s: Session) {
  if (Date.now() - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
  }
}

/** The signed-in client user for this request, or null. Cached per request. */
export const getUserSession = cache(async (): Promise<{ session: Session; user: User } | null> => {
  const token = await getCookie(COOKIE.session);
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.kind !== "USER" || !session.user || !alive(session)) return null;
  const { user } = session;
  if (user.status !== "ACTIVE") return null;
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return null;
  await touch(session);
  return { session, user };
});

/** The signed-in platform staff member for this request, or null. Cached per request. */
export const getStaffSession = cache(async (): Promise<{ session: Session; staff: StaffUser } | null> => {
  const token = await getCookie(COOKIE.staff);
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { staff: true } });
  if (!session || session.kind !== "STAFF" || !session.staff || !alive(session)) return null;
  if (session.supportSessionId) return null; // a support-view session never grants console access
  if (session.staff.status !== "ACTIVE") return null;
  if (session.staff.lockedUntil && session.staff.lockedUntil.getTime() > Date.now()) return null;
  await touch(session);
  return { session, staff: session.staff };
});

export async function revokeCurrentUserSession() {
  const token = await getCookie(COOKIE.session);
  if (token) await prisma.session.updateMany({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } });
  await deleteCookie(COOKIE.session);
}

export async function revokeCurrentStaffSession() {
  const token = await getCookie(COOKIE.staff);
  if (token) await prisma.session.updateMany({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } });
  await deleteCookie(COOKIE.staff);
}

export async function revokeAllUserSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllStaffSessions(staffId: string) {
  await prisma.session.updateMany({ where: { staffId, revokedAt: null }, data: { revokedAt: new Date() } });
}
