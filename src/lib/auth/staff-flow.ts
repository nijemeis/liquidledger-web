import "server-only";
import type { AuthChallenge, StaffUser } from "@prisma/client";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "../db";
import { hashPassword, randomToken, sha256, verifyPassword } from "../crypto";
import { env } from "../env";
import { FIXED } from "../policies";
import { requestMeta } from "../request";
import { audit } from "../audit";
import { sendMail } from "../email";
import { COOKIE, deleteCookie, getCookie, setCookie } from "./cookies";
import { rateLimit } from "./ratelimit";
import { createStaffSession, revokeAllStaffSessions } from "./session";
import { authenticationOptions, passkeyName, registrationOptions, verifyAuthentication, verifyRegistration } from "./webauthn";
import { passwordProblem } from "./flow";

// Platform staff sign-in. Mirrors flow.ts, with one difference: the second
// factor is always a passkey (policy "staffPasskey" is locked on). A staff
// member without a passkey cannot sign in and needs a new set-up link.

export type StaffLoginResult =
  | { ok: true; next: "done"; redirect: string }
  | { ok: true; next: "passkey"; options: Awaited<ReturnType<typeof authenticationOptions>> }
  | { ok: false; error: "invalid" | "locked" | "throttled" | "expired" | "no_passkey" | "passkey" | "token" | "password"; minutes?: number; message?: string };

const CHALLENGE_MINUTES = 5;
const actorOf = (s: Pick<StaffUser, "id" | "name">) => ({ type: "STAFF" as const, id: s.id, label: s.name });

// ── Challenges ───────────────────────────────────────────────────────────────

async function startChallenge(stage: string, data: { staffId?: string; webauthn: string; json?: object }) {
  const token = randomToken();
  await prisma.authChallenge.create({
    data: {
      kind: "STAFF",
      tokenHash: sha256(token),
      staffId: data.staffId ?? null,
      stage,
      webauthn: data.webauthn,
      data: data.json ?? undefined,
      expiresAt: new Date(Date.now() + CHALLENGE_MINUTES * 60_000),
    },
  });
  await setCookie(COOKIE.staffChallenge, token, CHALLENGE_MINUTES * 60);
}

async function currentChallenge(stage: string): Promise<AuthChallenge | null> {
  const token = await getCookie(COOKIE.staffChallenge);
  if (!token) return null;
  const ch = await prisma.authChallenge.findUnique({ where: { tokenHash: sha256(token) } });
  if (!ch || ch.kind !== "STAFF" || ch.stage !== stage || !ch.webauthn || ch.expiresAt.getTime() < Date.now()) return null;
  return ch;
}

async function endChallenge(id?: string) {
  if (id) await prisma.authChallenge.deleteMany({ where: { id } });
  await deleteCookie(COOKIE.staffChallenge);
}

// ── Lockout ──────────────────────────────────────────────────────────────────

function lockedMinutes(s: Pick<StaffUser, "lockedUntil">): number | null {
  if (s.lockedUntil && s.lockedUntil.getTime() > Date.now()) return Math.ceil((s.lockedUntil.getTime() - Date.now()) / 60_000);
  return null;
}

async function recordFailure(staff: StaffUser, kind: "password" | "passkey"): Promise<boolean> {
  const attempts = staff.failedAttempts + 1;
  if (attempts >= FIXED.lockoutAttempts) {
    await prisma.staffUser.update({
      where: { id: staff.id },
      data: { failedAttempts: 0, lockedUntil: new Date(Date.now() + FIXED.lockoutMinutes * 60_000) },
    });
    await revokeAllStaffSessions(staff.id);
    await audit({ actor: actorOf(staff), action: "staff.locked", summary: `Staff account locked · ${FIXED.lockoutAttempts} failed ${kind} attempts`, targetType: "staff", targetId: staff.id });
    await sendMail({
      to: staff.email,
      subject: "Your Liquid Ledger admin account was locked",
      text:
        `Hi ${staff.name},\n\nWe locked your platform admin account for ${FIXED.lockoutMinutes} minutes after ${FIXED.lockoutAttempts} failed ${kind} attempts.\n\n` +
        `If this wasn't you, tell a super admin straight away.\n\n— Liquid Ledger`,
    });
    return true;
  }
  await prisma.staffUser.update({ where: { id: staff.id }, data: { failedAttempts: attempts } });
  await audit({ actor: actorOf(staff), action: "staff.sign_in_failed", summary: `Failed admin sign-in · wrong ${kind}`, targetType: "staff", targetId: staff.id });
  return false;
}

async function throttled(scope: string, email?: string): Promise<boolean> {
  const { ip } = await requestMeta();
  if (!(await rateLimit(`staff:${scope}:ip:${ip ?? "unknown"}`, 20, 15 * 60))) return true;
  if (email && !(await rateLimit(`staff:${scope}:email:${email}`, 10, 15 * 60))) return true;
  return false;
}

// ── Step 1: email + password → passkey ──────────────────────────────────────

export async function staffPasswordStep(emailRaw: string, password: string): Promise<StaffLoginResult> {
  const email = emailRaw.trim().toLowerCase();
  if (await throttled("login", email)) return { ok: false, error: "throttled" };
  const staff = await prisma.staffUser.findUnique({ where: { email }, include: { passkeys: true } });
  const valid = await verifyPassword(staff?.passwordHash, password);
  if (!staff || staff.status === "DISABLED" || staff.status === "INVITED") {
    await audit({ actor: { type: "SYSTEM", label: "System" }, action: "staff.sign_in_failed", summary: `Failed admin sign-in · unknown or inactive account (${email.slice(0, 80)})` });
    return { ok: false, error: "invalid" };
  }
  const locked = lockedMinutes(staff);
  if (locked) return { ok: false, error: "locked", minutes: locked };
  if (!valid) {
    const nowLocked = await recordFailure(staff, "password");
    return nowLocked ? { ok: false, error: "locked", minutes: FIXED.lockoutMinutes } : { ok: false, error: "invalid" };
  }
  if (!staff.passkeys.length) {
    await audit({ actor: actorOf(staff), action: "staff.sign_in_failed", summary: "Admin sign-in refused · no passkey set up", targetType: "staff", targetId: staff.id });
    return { ok: false, error: "no_passkey" };
  }
  const options = await authenticationOptions(staff.passkeys);
  await startChallenge("staff_passkey", { staffId: staff.id, webauthn: options.challenge });
  return { ok: true, next: "passkey", options };
}

export async function staffPasskeyStep(response: AuthenticationResponseJSON): Promise<StaffLoginResult> {
  const ch = await currentChallenge("staff_passkey");
  if (!ch || !ch.staffId) return { ok: false, error: "expired" };
  const staff = await prisma.staffUser.findUnique({ where: { id: ch.staffId } });
  if (!staff || staff.status !== "ACTIVE") {
    await endChallenge(ch.id);
    return { ok: false, error: "invalid" };
  }
  const locked = lockedMinutes(staff);
  if (locked) {
    await endChallenge(ch.id);
    return { ok: false, error: "locked", minutes: locked };
  }
  const key = await prisma.passkey.findUnique({ where: { credentialId: String(response?.id ?? "") } });
  const result = key && key.staffId === staff.id ? await verifyAuthentication(response, ch.webauthn!, key).catch(() => null) : null;
  if (!key || !result) {
    await endChallenge(ch.id);
    const nowLocked = await recordFailure(staff, "passkey");
    return nowLocked ? { ok: false, error: "locked", minutes: FIXED.lockoutMinutes } : { ok: false, error: "passkey" };
  }
  await prisma.passkey.update({ where: { id: key.id }, data: { counter: result.newCounter, lastUsedAt: new Date() } });
  await endChallenge(ch.id);
  return completeStaffSignIn(staff, "password · passkey");
}

// ── Passwordless: "Sign in with a passkey" (discoverable credential) ────────

export async function staffPasskeyLoginOptions() {
  if (await throttled("passkey")) return null;
  const options = await authenticationOptions();
  await startChallenge("staff_passkey_login", { webauthn: options.challenge });
  return options;
}

export async function staffPasskeyLoginVerify(response: AuthenticationResponseJSON): Promise<StaffLoginResult> {
  const ch = await currentChallenge("staff_passkey_login");
  if (!ch) return { ok: false, error: "expired" };
  await endChallenge(ch.id);
  const key = await prisma.passkey.findUnique({ where: { credentialId: String(response?.id ?? "") }, include: { staff: true } });
  if (!key?.staff) return { ok: false, error: "passkey" };
  const staff = key.staff;
  if (staff.status !== "ACTIVE") return { ok: false, error: "invalid" };
  const locked = lockedMinutes(staff);
  if (locked) return { ok: false, error: "locked", minutes: locked };
  const result = await verifyAuthentication(response, ch.webauthn!, key).catch(() => null);
  if (!result) {
    const nowLocked = await recordFailure(staff, "passkey");
    return nowLocked ? { ok: false, error: "locked", minutes: FIXED.lockoutMinutes } : { ok: false, error: "passkey" };
  }
  await prisma.passkey.update({ where: { id: key.id }, data: { counter: result.newCounter, lastUsedAt: new Date() } });
  return completeStaffSignIn(staff, "passkey");
}

async function completeStaffSignIn(staff: StaffUser, method: string): Promise<StaffLoginResult> {
  await prisma.staffUser.update({ where: { id: staff.id }, data: { failedAttempts: 0, lockedUntil: null, lastSignInAt: new Date() } });
  await createStaffSession(staff, method);
  await audit({ actor: actorOf(staff), action: "staff.sign_in", summary: `Signed in to the admin console · ${method}`, targetType: "staff", targetId: staff.id });
  return { ok: true, next: "done", redirect: "/admin" };
}

// ── Set-up link: password + passkey ─────────────────────────────────────────

export const STAFF_SETUP_HOURS = 72;

/** Issue a one-time set-up link (invalidates earlier unused links). */
export async function createStaffSetupLink(staffId: string): Promise<string> {
  const token = randomToken();
  await prisma.emailToken.updateMany({ where: { staffId, purpose: "STAFF_SETUP", usedAt: null }, data: { usedAt: new Date() } });
  await prisma.emailToken.create({
    data: { staffId, purpose: "STAFF_SETUP", tokenHash: sha256(token), expiresAt: new Date(Date.now() + STAFF_SETUP_HOURS * 3600_000) },
  });
  return `${env.adminUrl}/setup?token=${token}`;
}

export type SetupTokenState = { ok: true; staff: Pick<StaffUser, "id" | "name" | "email" | "role"> } | { ok: false; reason: "invalid" | "used" | "expired" };

export async function findStaffSetupToken(token: string): Promise<SetupTokenState & { tokenId?: string }> {
  if (!token || token.length > 200) return { ok: false, reason: "invalid" };
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.purpose !== "STAFF_SETUP" || !row.staffId) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  const staff = await prisma.staffUser.findUnique({ where: { id: row.staffId }, select: { id: true, name: true, email: true, role: true, status: true } });
  if (!staff || staff.status === "DISABLED") return { ok: false, reason: "invalid" };
  return { ok: true, staff, tokenId: row.id };
}

/** Check the token and new password, then hand out passkey registration options. */
export async function staffSetupOptions(token: string, password: string) {
  if (await throttled("setup")) return { ok: false as const, error: "throttled" as const };
  const t = await findStaffSetupToken(token);
  if (!t.ok) return { ok: false as const, error: "token" as const, reason: t.reason };
  const problem = passwordProblem(password, t.staff.email);
  if (problem) return { ok: false as const, error: "password" as const, message: problem };
  const options = await registrationOptions({ userId: t.staff.id, email: t.staff.email, name: t.staff.name, existing: [] });
  const passwordHash = await hashPassword(password);
  await startChallenge("staff_enroll", { staffId: t.staff.id, webauthn: options.challenge, json: { tokenId: t.tokenId, passwordHash } });
  return { ok: true as const, options };
}

/** Finish set-up: store the passkey and password, burn the link, sign in. */
export async function staffSetupVerify(response: RegistrationResponseJSON): Promise<StaffLoginResult> {
  const ch = await currentChallenge("staff_enroll");
  const data = ch?.data as { tokenId?: string; passwordHash?: string } | null;
  if (!ch || !ch.staffId || !data?.tokenId || !data.passwordHash) return { ok: false, error: "expired" };
  const reg = await verifyRegistration(response, ch.webauthn!).catch(() => null);
  if (!reg) return { ok: false, error: "passkey" };
  const { userAgent } = await requestMeta();
  const staffId = ch.staffId;
  const ok = await prisma.$transaction(async (tx) => {
    // Burn the link atomically; a second tab racing us loses.
    const burned = await tx.emailToken.updateMany({ where: { id: data.tokenId, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (burned.count !== 1) return false;
    // A set-up link replaces whatever passkeys existed (lost device).
    await tx.passkey.deleteMany({ where: { staffId } });
    await tx.passkey.create({ data: { ...reg, staffId, name: passkeyName(userAgent) } });
    await tx.staffUser.update({ where: { id: staffId }, data: { passwordHash: data.passwordHash, status: "ACTIVE", failedAttempts: 0, lockedUntil: null } });
    return true;
  });
  await endChallenge(ch.id);
  if (!ok) return { ok: false, error: "token" };
  await revokeAllStaffSessions(staffId);
  const staff = await prisma.staffUser.findUniqueOrThrow({ where: { id: staffId } });
  await audit({ actor: actorOf(staff), action: "staff.setup", summary: "Set a password and registered a passkey for the admin console", targetType: "staff", targetId: staff.id });
  return completeStaffSignIn(staff, "passkey (new)");
}
