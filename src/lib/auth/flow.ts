import "server-only";
import type { AuthChallenge, User } from "@prisma/client";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "../db";
import { normaliseRecoveryCode, randomDigits, randomToken, recoveryCode, sha256, verifyPassword } from "../crypto";
import { env } from "../env";
import { FIXED, getPolicies } from "../policies";
import { requestMeta } from "../request";
import { audit } from "../audit";
import { sendMail } from "../email";
import { maskPhone, sendSms, smsAvailable } from "../sms";
import { COOKIE, deleteCookie, getCookie, setCookie } from "./cookies";
import { rateLimit } from "./ratelimit";
import { createUserSession } from "./session";
import { newTotpSecret, openSecret, sealSecret, totpEnrollment, verifyTotp } from "./totp";
import {
  authenticationOptions,
  passkeyName,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "./webauthn";

// ─────────────────────────────────────────────────────────────────────────────
// Result types shared with the sign-in UI
// ─────────────────────────────────────────────────────────────────────────────

export type MfaMethods = { totp: boolean; passkey: boolean; sms: string | null; recovery: boolean };

export type LoginResult =
  | { ok: true; next: "done"; redirect: string; name: string; company: string | null; trusted?: boolean }
  | { ok: true; next: "mfa"; methods: MfaMethods }
  | { ok: true; next: "enroll" }
  | { ok: false; error: "invalid" | "locked" | "throttled" | "expired" | "code" | "unavailable"; minutes?: number };

const CHALLENGE_MINUTES = 10;

const label = (u: Pick<User, "name" | "email">) => u.name || u.email;

// ─────────────────────────────────────────────────────────────────────────────
// Challenge (half-finished sign-in) handling
// ─────────────────────────────────────────────────────────────────────────────

async function startChallenge(userId: string, stage: string): Promise<AuthChallenge> {
  const token = randomToken();
  const ch = await prisma.authChallenge.create({
    data: {
      kind: "USER",
      tokenHash: sha256(token),
      userId,
      stage,
      expiresAt: new Date(Date.now() + CHALLENGE_MINUTES * 60_000),
    },
  });
  await setCookie(COOKIE.challenge, token, CHALLENGE_MINUTES * 60);
  return ch;
}

export async function currentChallenge(stages: string[]): Promise<(AuthChallenge & { user: User }) | null> {
  const token = await getCookie(COOKIE.challenge);
  if (!token) return null;
  const ch = await prisma.authChallenge.findUnique({ where: { tokenHash: sha256(token) } });
  if (!ch || ch.kind !== "USER" || !ch.userId || ch.expiresAt.getTime() < Date.now() || !stages.includes(ch.stage)) return null;
  const user = await prisma.user.findUnique({ where: { id: ch.userId } });
  if (!user || user.status === "DISABLED") return null;
  return { ...ch, user };
}

async function endChallenge(id?: string) {
  if (id) await prisma.authChallenge.deleteMany({ where: { id } });
  await deleteCookie(COOKIE.challenge);
}

function isLocked(u: Pick<User, "status" | "lockedUntil">): { locked: boolean; minutes?: number } {
  if (u.status === "LOCKED" && !u.lockedUntil) return { locked: true };
  if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) {
    return { locked: true, minutes: Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60_000) };
  }
  return { locked: false };
}

/** Count a failed password or second-factor attempt; lock after 5. */
async function recordFailure(user: User, kind: "password" | "2FA") {
  const attempts = user.failedAttempts + 1;
  if (attempts >= FIXED.lockoutAttempts) {
    const until = new Date(Date.now() + FIXED.lockoutMinutes * 60_000);
    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, status: "LOCKED", lockedUntil: until, lockReason: `${FIXED.lockoutAttempts} failed ${kind} attempts` },
    });
    const membership = await prisma.membership.findFirst({ where: { userId: user.id }, include: { administration: true } });
    await audit({
      actor: { type: "USER", id: user.id, label: label(user) },
      action: "auth.locked",
      summary: `Account locked · ${FIXED.lockoutAttempts} failed ${kind} attempts`,
      clientId: membership?.administration.clientId,
    });
    await sendMail({
      to: user.email,
      subject: "Your Liquid Ledger account was locked",
      text:
        `Hi ${user.name},\n\nWe locked your Liquid Ledger account for ${FIXED.lockoutMinutes} minutes after ` +
        `${FIXED.lockoutAttempts} failed ${kind} attempts.\n\nIf this was you, wait ${FIXED.lockoutMinutes} minutes and try again. ` +
        `If it wasn't, reset your password: ${env.appUrl}/forgot\n\n— Liquid Ledger`,
    });
    return true;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: attempts } });
  return false;
}

async function methodsFor(user: User): Promise<MfaMethods> {
  const [passkeys, codes] = await Promise.all([
    prisma.passkey.count({ where: { userId: user.id } }),
    prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } }),
  ]);
  return {
    totp: Boolean(user.totpSecretEnc && user.totpEnabledAt),
    passkey: passkeys > 0,
    sms: user.smsEnabled && user.phone && smsAvailable() ? maskPhone(user.phone) : null,
    recovery: codes > 0,
  };
}

function hasSecondFactor(m: MfaMethods) {
  return m.totp || m.passkey || Boolean(m.sms);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — email + password
// ─────────────────────────────────────────────────────────────────────────────

export async function passwordStep(emailRaw: string, password: string): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const { ip } = await requestMeta();
  if (!(await rateLimit(`login:ip:${ip ?? "unknown"}`, 30, 15 * 60)) || !(await rateLimit(`login:email:${email}`, 10, 15 * 60))) {
    return { ok: false, error: "throttled" };
  }
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await verifyPassword(user?.passwordHash, password);
  if (!user || user.status === "DISABLED" || user.status === "INVITED") return { ok: false, error: "invalid" };

  const lock = isLocked(user);
  if (lock.locked) return { ok: false, error: "locked", minutes: lock.minutes };
  if (user.status === "LOCKED") {
    // Timed lock has expired.
    await prisma.user.update({ where: { id: user.id }, data: { status: "ACTIVE", lockedUntil: null, lockReason: null } });
    user.status = "ACTIVE";
  }

  if (!valid) {
    const locked = await recordFailure(user, "password");
    return locked ? { ok: false, error: "locked", minutes: FIXED.lockoutMinutes } : { ok: false, error: "invalid" };
  }

  const methods = await methodsFor(user);
  if (!hasSecondFactor(methods)) {
    await startChallenge(user.id, "enroll");
    return { ok: true, next: "enroll" };
  }

  // Trusted device: password still required, second factor skipped.
  const policies = await getPolicies();
  if (policies.trust30) {
    const deviceToken = await getCookie(COOKIE.device);
    if (deviceToken) {
      const device = await prisma.userDevice.findUnique({ where: { tokenHash: sha256(deviceToken) } });
      if (device && device.userId === user.id && device.trustedUntil && device.trustedUntil.getTime() > Date.now()) {
        return completeSignIn(user, "password · trusted device", { trust: false });
      }
    }
  }

  await startChallenge(user.id, "mfa");
  return { ok: true, next: "mfa", methods };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — second factor
// ─────────────────────────────────────────────────────────────────────────────

async function failSecondFactor(ch: AuthChallenge & { user: User }): Promise<LoginResult> {
  await prisma.authChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
  const locked = await recordFailure(ch.user, "2FA");
  if (locked) {
    await endChallenge(ch.id);
    return { ok: false, error: "locked", minutes: FIXED.lockoutMinutes };
  }
  return { ok: false, error: "code" };
}

export async function verifyTotpStep(code: string, trust: boolean): Promise<LoginResult> {
  const ch = await currentChallenge(["mfa"]);
  if (!ch) return { ok: false, error: "expired" };
  if (isLocked(ch.user).locked) return { ok: false, error: "locked" };
  const u = ch.user;
  if (!u.totpSecretEnc) return failSecondFactor(ch);
  const step = verifyTotp(openSecret(u.totpSecretEnc), code, u.totpLastStep);
  if (step === null) return failSecondFactor(ch);
  await prisma.user.update({ where: { id: u.id }, data: { totpLastStep: step } });
  await endChallenge(ch.id);
  return completeSignIn(u, "password · authenticator app", { trust });
}

export async function verifyRecoveryStep(code: string, trust: boolean): Promise<LoginResult> {
  const ch = await currentChallenge(["mfa"]);
  if (!ch) return { ok: false, error: "expired" };
  if (isLocked(ch.user).locked) return { ok: false, error: "locked" };
  const hash = sha256(normaliseRecoveryCode(code));
  const used = await prisma.recoveryCode.updateMany({
    where: { userId: ch.user.id, codeHash: hash, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (used.count !== 1) return failSecondFactor(ch);
  await endChallenge(ch.id);
  const left = await prisma.recoveryCode.count({ where: { userId: ch.user.id, usedAt: null } });
  await sendMail({
    to: ch.user.email,
    subject: "A recovery code was used to sign in",
    text: `Hi ${ch.user.name},\n\nSomeone signed in to Liquid Ledger with one of your recovery codes. You have ${left} left.\nIf this wasn't you, reset your password now: ${env.appUrl}/forgot\n\n— Liquid Ledger`,
  });
  return completeSignIn(ch.user, "password · recovery code", { trust });
}

export async function sendSmsStep(): Promise<{ ok: boolean; phone?: string; error?: string }> {
  const ch = await currentChallenge(["mfa"]);
  if (!ch) return { ok: false, error: "expired" };
  const u = ch.user;
  if (!u.smsEnabled || !u.phone || !smsAvailable()) return { ok: false, error: "unavailable" };
  if (ch.smsSentAt && Date.now() - ch.smsSentAt.getTime() < 30_000) return { ok: true, phone: maskPhone(u.phone) };
  if (!(await rateLimit(`sms:${u.id}`, 5, 60 * 60))) return { ok: false, error: "throttled" };
  const code = randomDigits(6);
  await prisma.authChallenge.update({ where: { id: ch.id }, data: { smsCodeHash: sha256(code), smsSentAt: new Date() } });
  await sendSms(u.phone, `${code} is your Liquid Ledger verification code. It expires in 10 minutes. Never share it.`);
  return { ok: true, phone: maskPhone(u.phone) };
}

export async function verifySmsStep(code: string, trust: boolean): Promise<LoginResult> {
  const ch = await currentChallenge(["mfa"]);
  if (!ch) return { ok: false, error: "expired" };
  if (isLocked(ch.user).locked) return { ok: false, error: "locked" };
  const fresh = ch.smsSentAt && Date.now() - ch.smsSentAt.getTime() < 10 * 60_000;
  if (!ch.smsCodeHash || !fresh || sha256(code.replace(/\D/g, "")) !== ch.smsCodeHash) return failSecondFactor(ch);
  await endChallenge(ch.id);
  return completeSignIn(ch.user, "password · SMS", { trust });
}

/** Passkey as the second factor (after the password). */
export async function passkeyMfaOptions() {
  const ch = await currentChallenge(["mfa"]);
  if (!ch) return null;
  const keys = await prisma.passkey.findMany({ where: { userId: ch.user.id } });
  if (!keys.length) return null;
  const options = await authenticationOptions(keys);
  await prisma.authChallenge.update({ where: { id: ch.id }, data: { webauthn: options.challenge } });
  return options;
}

export async function passkeyMfaVerify(response: AuthenticationResponseJSON, trust: boolean): Promise<LoginResult> {
  const ch = await currentChallenge(["mfa"]);
  if (!ch || !ch.webauthn) return { ok: false, error: "expired" };
  const key = await prisma.passkey.findUnique({ where: { credentialId: response.id } });
  if (!key || key.userId !== ch.user.id) return failSecondFactor(ch);
  const result = await verifyAuthentication(response, ch.webauthn, key).catch(() => null);
  if (!result) return failSecondFactor(ch);
  await prisma.passkey.update({ where: { id: key.id }, data: { counter: result.newCounter, lastUsedAt: new Date() } });
  await endChallenge(ch.id);
  return completeSignIn(ch.user, "password · passkey", { trust });
}

// ─────────────────────────────────────────────────────────────────────────────
// Passwordless — "Sign in with a passkey" (user verification = two factors)
// ─────────────────────────────────────────────────────────────────────────────

export async function passkeyLoginOptions() {
  const { ip } = await requestMeta();
  if (!(await rateLimit(`passkey:ip:${ip ?? "unknown"}`, 30, 15 * 60))) return null;
  const options = await authenticationOptions();
  const token = randomToken();
  await prisma.authChallenge.create({
    data: {
      kind: "USER",
      tokenHash: sha256(token),
      stage: "passkey",
      webauthn: options.challenge,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  await setCookie(COOKIE.challenge, token, 5 * 60);
  return options;
}

export async function passkeyLoginVerify(response: AuthenticationResponseJSON): Promise<LoginResult> {
  const token = await getCookie(COOKIE.challenge);
  if (!token) return { ok: false, error: "expired" };
  const ch = await prisma.authChallenge.findUnique({ where: { tokenHash: sha256(token) } });
  if (!ch || ch.stage !== "passkey" || !ch.webauthn || ch.expiresAt.getTime() < Date.now()) return { ok: false, error: "expired" };
  await endChallenge(ch.id);
  const key = await prisma.passkey.findUnique({ where: { credentialId: response.id }, include: { user: true } });
  if (!key?.user) return { ok: false, error: "invalid" };
  const user = key.user;
  if (user.status === "DISABLED" || user.status === "INVITED") return { ok: false, error: "invalid" };
  const lock = isLocked(user);
  if (lock.locked) return { ok: false, error: "locked", minutes: lock.minutes };
  const result = await verifyAuthentication(response, ch.webauthn, key).catch(() => null);
  if (!result) {
    await recordFailure(user, "2FA");
    return { ok: false, error: "invalid" };
  }
  await prisma.passkey.update({ where: { id: key.id }, data: { counter: result.newCounter, lastUsedAt: new Date() } });
  if (user.status === "LOCKED") await prisma.user.update({ where: { id: user.id }, data: { status: "ACTIVE", lockedUntil: null } });
  return completeSignIn(user, "passkey", { trust: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrolment (first sign-in, invite acceptance, or after a 2FA reset)
// ─────────────────────────────────────────────────────────────────────────────

export async function startEnrollmentFor(userId: string) {
  await startChallenge(userId, "enroll");
}

export async function enrollTotpStart() {
  const ch = await currentChallenge(["enroll"]);
  if (!ch) return null;
  const secret = newTotpSecret();
  await prisma.authChallenge.update({ where: { id: ch.id }, data: { data: { totp: sealSecret(secret) } } });
  return totpEnrollment(ch.user.email, secret);
}

async function issueRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: 10 }, recoveryCode);
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: sha256(normaliseRecoveryCode(c)) })) }),
  ]);
  return codes;
}

export async function enrollTotpConfirm(code: string): Promise<{ ok: true; codes: string[]; redirect: string } | { ok: false; error: string }> {
  const ch = await currentChallenge(["enroll"]);
  const sealed = (ch?.data as { totp?: string } | null)?.totp;
  if (!ch || !sealed) return { ok: false, error: "expired" };
  const secret = openSecret(sealed);
  const step = verifyTotp(secret, code);
  if (step === null) {
    await prisma.authChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
    if (ch.attempts + 1 >= 10) await endChallenge(ch.id);
    return { ok: false, error: "code" };
  }
  await prisma.user.update({
    where: { id: ch.user.id },
    data: { totpSecretEnc: sealSecret(secret), totpEnabledAt: new Date(), totpLastStep: step, status: "ACTIVE" },
  });
  const codes = await issueRecoveryCodes(ch.user.id);
  await audit({ actor: { type: "USER", id: ch.user.id, label: label(ch.user) }, action: "auth.2fa_enrolled", summary: "Set up two-factor authentication · authenticator app" });
  await endChallenge(ch.id);
  const done = await completeSignIn(ch.user, "password · authenticator app (new)", { trust: false });
  return { ok: true, codes, redirect: done.ok && done.next === "done" ? done.redirect : "/dashboard" };
}

export async function enrollPasskeyOptions() {
  const ch = await currentChallenge(["enroll"]);
  if (!ch) return null;
  const existing = await prisma.passkey.findMany({ where: { userId: ch.user.id } });
  const options = await registrationOptions({ userId: ch.user.id, email: ch.user.email, name: ch.user.name, existing });
  await prisma.authChallenge.update({ where: { id: ch.id }, data: { webauthn: options.challenge } });
  return options;
}

export async function enrollPasskeyVerify(response: RegistrationResponseJSON): Promise<{ ok: true; codes: string[]; redirect: string } | { ok: false; error: string }> {
  const ch = await currentChallenge(["enroll"]);
  if (!ch || !ch.webauthn) return { ok: false, error: "expired" };
  const reg = await verifyRegistration(response, ch.webauthn).catch(() => null);
  if (!reg) return { ok: false, error: "code" };
  const { userAgent } = await requestMeta();
  await prisma.passkey.create({ data: { ...reg, userId: ch.user.id, name: passkeyName(userAgent) } });
  await prisma.user.update({ where: { id: ch.user.id }, data: { status: "ACTIVE" } });
  const codes = await issueRecoveryCodes(ch.user.id);
  await audit({ actor: { type: "USER", id: ch.user.id, label: label(ch.user) }, action: "auth.2fa_enrolled", summary: "Set up two-factor authentication · passkey" });
  await endChallenge(ch.id);
  const done = await completeSignIn(ch.user, "passkey (new)", { trust: false });
  return { ok: true, codes, redirect: done.ok && done.next === "done" ? done.redirect : "/dashboard" };
}

export { issueRecoveryCodes };

// ─────────────────────────────────────────────────────────────────────────────
// Finish: create the session, remember the device, notify on new devices
// ─────────────────────────────────────────────────────────────────────────────

async function completeSignIn(user: User, method: string, opts: { trust: boolean }): Promise<LoginResult> {
  const policies = await getPolicies();
  const { ip, userAgent } = await requestMeta();

  // Pick the administration to open.
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, administration: { deletedAt: null } },
    include: { administration: { include: { client: true } } },
    orderBy: { createdAt: "asc" },
  });
  const current = memberships.find((m) => m.administrationId === user.lastAdministrationId) ?? memberships[0] ?? null;
  const idle = Math.min(FIXED.sessionIdleMinutes, current?.administration.client.sessionTimeoutMinutes ?? FIXED.sessionIdleMinutes);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedAttempts: 0,
      lastSignInAt: new Date(),
      status: "ACTIVE",
      lockedUntil: null,
      lockReason: null,
      lastAdministrationId: current?.administrationId ?? null,
    },
  });
  await createUserSession({ id: user.id, lastAdministrationId: current?.administrationId ?? null }, method, idle);

  // Device cookie: trust + new-device detection.
  const existingToken = await getCookie(COOKIE.device);
  let device = existingToken ? await prisma.userDevice.findUnique({ where: { tokenHash: sha256(existingToken) } }) : null;
  if (device && device.userId !== user.id) device = null;
  const trustedUntil = opts.trust && policies.trust30 ? new Date(Date.now() + FIXED.trustDays * 86400_000) : undefined;
  if (device) {
    await prisma.userDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date(), ip, userAgent, ...(trustedUntil ? { trustedUntil } : {}) },
    });
  } else {
    const knownDevices = await prisma.userDevice.count({ where: { userId: user.id } });
    const token = randomToken();
    await prisma.userDevice.create({ data: { userId: user.id, tokenHash: sha256(token), ip, userAgent, trustedUntil } });
    await setCookie(COOKIE.device, token, 400 * 86400);
    if (knownDevices > 0 && policies.newDevice) await notifyNewDevice(user, ip, userAgent);
  }

  await audit({
    actor: { type: "USER", id: user.id, label: label(user) },
    action: "auth.sign_in",
    summary: `Signed in · ${method}${trustedUntil ? " · trusted this device" : ""}`,
    clientId: current?.administration.clientId,
    administrationId: current?.administrationId,
  });
  if (current) await prisma.client.update({ where: { id: current.administration.clientId }, data: { lastActiveAt: new Date() } });

  return {
    ok: true,
    next: "done",
    redirect: memberships.length ? "/dashboard" : "/no-access",
    name: user.name.split(" ")[0] ?? user.name,
    company: current?.administration.legalName ?? null,
    trusted: Boolean(trustedUntil),
  };
}

async function notifyNewDevice(user: User, ip: string | null, userAgent: string | null) {
  const token = randomToken();
  await prisma.emailToken.create({
    data: { userId: user.id, purpose: "LOCK_ACCOUNT", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86400_000) },
  });
  await sendMail({
    to: user.email,
    subject: "New sign-in to Liquid Ledger",
    text:
      `Hi ${user.name},\n\nYour Liquid Ledger account was just signed in to from a new device.\n\n` +
      `Device: ${userAgent ?? "unknown"}\nIP address: ${ip ?? "unknown"}\nTime: ${new Date().toUTCString()}\n\n` +
      `If this was you, there's nothing to do.\nIf it wasn't, lock your account now: ${env.appUrl}/lock?token=${token}\n\n— Liquid Ledger`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Password reset & invite acceptance helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function createEmailToken(userId: string, purpose: "INVITE" | "RESET_PASSWORD", hours: number) {
  const token = randomToken();
  await prisma.emailToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.emailToken.create({
    data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3600_000) },
  });
  return token;
}

export async function findEmailToken(token: string, purpose: "INVITE" | "RESET_PASSWORD" | "LOCK_ACCOUNT") {
  if (!token) return null;
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt.getTime() < Date.now() || !row.user) return null;
  return row;
}

export function passwordProblem(password: string, email: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "That password is too long.";
  if (password.toLowerCase().includes(email.split("@")[0]!.toLowerCase())) return "Don't use your email address in your password.";
  if (/^(.)\1+$/.test(password)) return "That password is too easy to guess.";
  const common = ["password", "wachtwoord", "123456789012", "qwertyuiopas", "liquidledger"];
  if (common.some((c) => password.toLowerCase().includes(c))) return "That password is too easy to guess.";
  return null;
}
