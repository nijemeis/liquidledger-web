"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, randomDigits, sha256 } from "@/lib/crypto";
import { issueRecoveryCodes, passwordProblemKey } from "@/lib/auth/flow";
import { revokeAllUserSessions } from "@/lib/auth/session";
import { newTotpSecret, sealSecret, totpEnrollment, verifyTotp } from "@/lib/auth/totp";
import { rateLimit } from "@/lib/auth/ratelimit";
import { maskPhone, sendSms, smsAvailable } from "@/lib/sms";
import { confirmPassword, meAction, MeError, openPending, sealPending, securityChange, type Me } from "../me";

const PATH = "/settings/security";
const pw = z.string().max(500);

/** At least one strong second factor (authenticator app or passkey) must remain. */
async function strongFactors(userId: string) {
  const [u, passkeys] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpSecretEnc: true, totpEnabledAt: true } }),
    prisma.passkey.count({ where: { userId } }),
  ]);
  return { totp: Boolean(u.totpSecretEnc && u.totpEnabledAt), passkeys };
}

function pwMessage(me: Me, key: string) {
  return me.t(`auth.${key}`);
}

// ── Password ────────────────────────────────────────────────────────────────

export async function changePassword(input: { current: string; next: string; repeat: string }) {
  return meAction(async (me) => {
    const p = z.object({ current: pw, next: pw, repeat: pw }).parse(input);
    await confirmPassword(me, p.current);
    if (p.next !== p.repeat) throw new MeError(me.t("auth.passwordsDiffer"));
    if (p.next === p.current) throw new MeError(me.t("settings.security.samePassword"));
    const problem = passwordProblemKey(p.next, me.user.email);
    if (problem) throw new MeError(pwMessage(me, problem));
    await prisma.user.update({ where: { id: me.user.id }, data: { passwordHash: await hashPassword(p.next), passwordChangedAt: new Date() } });
    const others = await prisma.session.count({ where: { userId: me.user.id, revokedAt: null, id: { not: me.session.id } } });
    await revokeAllUserSessions(me.user.id, me.session.id);
    await securityChange(me, "auth.password_changed", `Changed password · ${others} other session(s) signed out`, "Your password was changed. All your other sessions were signed out.");
    return { message: me.t("settings.security.passwordChanged", { n: others }) };
  }, PATH);
}

// ── Authenticator app ──────────────────────────────────────────────────────

export async function totpStart(input: { password: string }) {
  return meAction(async (me) => {
    await confirmPassword(me, pw.parse(input.password));
    const secret = newTotpSecret();
    const e = await totpEnrollment(me.user.email, secret);
    return { qr: e.qr, secret: e.secret, pending: sealPending("totp", me.user.id, { s: secret }) };
  }, PATH);
}

export async function totpConfirm(input: { pending: string; code: string }) {
  return meAction(async (me) => {
    const p = z.object({ pending: z.string().max(2000), code: z.string().max(12) }).parse(input);
    const pending = openPending("totp", me.user.id, p.pending);
    if (!pending?.s) throw new MeError(me.t("settings.err.expired"));
    if (!(await rateLimit(`totp-setup:${me.user.id}`, 10, 15 * 60))) throw new MeError(me.t("settings.err.throttled"));
    const step = verifyTotp(pending.s, p.code);
    if (step === null) throw new MeError(me.t("auth.otpErr"));
    const replaced = Boolean(me.user.totpSecretEnc && me.user.totpEnabledAt);
    await prisma.user.update({ where: { id: me.user.id }, data: { totpSecretEnc: sealSecret(pending.s), totpEnabledAt: new Date(), totpLastStep: step } });
    await securityChange(
      me,
      "auth.2fa_totp",
      replaced ? "Replaced the authenticator app" : "Set up an authenticator app",
      replaced ? "The authenticator app on your account was replaced. Codes from the old app no longer work." : "An authenticator app was added to your account.",
    );
    return { message: me.t(replaced ? "settings.security.totpReplaced" : "settings.security.totpAdded") };
  }, PATH);
}

export async function totpRemove(input: { password: string }) {
  return meAction(async (me) => {
    await confirmPassword(me, pw.parse(input.password));
    const f = await strongFactors(me.user.id);
    if (!f.totp) throw new MeError(me.t("settings.err.generic"));
    if (f.passkeys === 0) throw new MeError(me.t("settings.security.lastFactor"));
    await prisma.user.update({ where: { id: me.user.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null } });
    await securityChange(me, "auth.2fa_totp_removed", "Removed the authenticator app", "The authenticator app was removed from your account. You now verify with a passkey.");
    return { message: me.t("settings.security.totpRemoved") };
  }, PATH);
}

// ── Passkeys (registration runs through /api/me/passkeys) ──────────────────

export async function renamePasskey(input: { id: string; name: string }) {
  return meAction(async (me) => {
    const p = z.object({ id: z.string().max(64), name: z.string().trim().min(1).max(60) }).safeParse(input);
    if (!p.success) throw new MeError(me.t("settings.security.passkeyNameRequired"));
    const r = await prisma.passkey.updateMany({ where: { id: p.data.id, userId: me.user.id }, data: { name: p.data.name } });
    if (r.count !== 1) throw new MeError(me.t("settings.err.notFound"));
    await securityChange(me, "auth.passkey_renamed", `Renamed a passkey to "${p.data.name}"`, `A passkey on your account was renamed to "${p.data.name}".`);
    return { message: me.t("settings.security.passkeyRenamed") };
  }, PATH);
}

export async function removePasskey(input: { id: string; password: string }) {
  return meAction(async (me) => {
    const p = z.object({ id: z.string().max(64), password: pw }).parse(input);
    await confirmPassword(me, p.password);
    const key = await prisma.passkey.findFirst({ where: { id: p.id, userId: me.user.id } });
    if (!key) throw new MeError(me.t("settings.err.notFound"));
    const f = await strongFactors(me.user.id);
    if (!f.totp && f.passkeys <= 1) throw new MeError(me.t("settings.security.lastFactor"));
    await prisma.passkey.delete({ where: { id: key.id } });
    await securityChange(me, "auth.passkey_removed", `Removed passkey "${key.name}"`, `The passkey "${key.name}" was removed from your account.`);
    return { message: me.t("settings.security.passkeyRemoved", { name: key.name }) };
  }, PATH);
}

// ── SMS (fallback only) ─────────────────────────────────────────────────────

export async function smsStart(input: { phone: string; password: string }) {
  return meAction(async (me) => {
    const p = z.object({ phone: z.string().max(40), password: pw }).parse(input);
    const phone = p.phone.replace(/[\s().-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new MeError(me.t("settings.security.phoneInvalid"));
    await confirmPassword(me, p.password);
    if (!smsAvailable()) throw new MeError(me.t("auth.smsUnavailable"));
    if (!(await rateLimit(`sms-setup:${me.user.id}`, 5, 60 * 60))) throw new MeError(me.t("settings.err.throttled"));
    const code = randomDigits(6);
    await sendSms(phone, `${code} is your Liquid Ledger code to confirm this phone number. Never share it.`);
    return { pending: sealPending("sms", me.user.id, { phone, h: sha256(code) }), masked: maskPhone(phone) };
  }, PATH);
}

export async function smsConfirm(input: { pending: string; code: string }) {
  return meAction(async (me) => {
    const p = z.object({ pending: z.string().max(2000), code: z.string().max(12) }).parse(input);
    const pending = openPending("sms", me.user.id, p.pending);
    if (!pending?.phone || !pending.h) throw new MeError(me.t("settings.err.expired"));
    if (!(await rateLimit(`sms-confirm:${me.user.id}`, 10, 15 * 60))) throw new MeError(me.t("settings.err.throttled"));
    if (sha256(p.code.replace(/\D/g, "")) !== pending.h) throw new MeError(me.t("auth.otpErr"));
    await prisma.user.update({ where: { id: me.user.id }, data: { phone: pending.phone, smsEnabled: true } });
    await securityChange(me, "auth.2fa_sms", `Added text-message fallback ${maskPhone(pending.phone)}`, `Text-message codes to ${maskPhone(pending.phone)} were added as a fallback way to sign in.`);
    return { message: me.t("settings.security.smsAdded", { phone: maskPhone(pending.phone) }) };
  }, PATH);
}

export async function smsRemove() {
  return meAction(async (me) => {
    await prisma.user.update({ where: { id: me.user.id }, data: { smsEnabled: false, phone: null } });
    await securityChange(me, "auth.2fa_sms_removed", "Removed text-message fallback", "Text-message codes were removed from your account.");
    return { message: me.t("settings.security.smsRemoved") };
  }, PATH);
}

// ── Recovery codes ──────────────────────────────────────────────────────────

export async function regenerateCodes(input: { password: string }) {
  return meAction(async (me) => {
    await confirmPassword(me, pw.parse(input.password));
    const codes = await issueRecoveryCodes(me.user.id);
    await securityChange(me, "auth.recovery_regenerated", "Generated new recovery codes", "New recovery codes were generated for your account. The old codes no longer work.");
    return { codes, message: me.t("settings.security.codesNew") };
  }, PATH);
}

// ── Sessions & trusted devices ──────────────────────────────────────────────

export async function revokeSession(input: { id: string }) {
  return meAction(async (me) => {
    const id = z.string().max(64).parse(input.id);
    if (id === me.session.id) throw new MeError(me.t("settings.security.cantRevokeCurrent"));
    const r = await prisma.session.updateMany({ where: { id, userId: me.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count !== 1) throw new MeError(me.t("settings.err.notFound"));
    await securityChange(me, "auth.session_revoked", "Signed out a session", "One of your sessions was signed out from the security settings.");
    return { message: me.t("settings.security.sessionRevoked") };
  }, PATH);
}

export async function revokeOtherSessions() {
  return meAction(async (me) => {
    const n = await prisma.session.count({ where: { userId: me.user.id, revokedAt: null, id: { not: me.session.id } } });
    await revokeAllUserSessions(me.user.id, me.session.id);
    await securityChange(me, "auth.sessions_revoked", `Signed out ${n} other session(s)`, "All your other sessions were signed out.");
    return { message: me.t("settings.security.othersRevoked", { n }) };
  }, PATH);
}

export async function untrustDevice(input: { id: string | "all" }) {
  return meAction(async (me) => {
    const id = z.string().max(64).parse(input.id);
    const r = await prisma.userDevice.updateMany({ where: { userId: me.user.id, trustedUntil: { not: null }, ...(id === "all" ? {} : { id }) }, data: { trustedUntil: null } });
    if (!r.count) throw new MeError(me.t("settings.err.notFound"));
    await securityChange(me, "auth.device_untrusted", `Stopped trusting ${r.count} device(s)`, "A trusted device on your account will need a verification code again at the next sign-in.");
    return { message: me.t("settings.security.deviceUntrusted", { n: r.count }) };
  }, PATH);
}

