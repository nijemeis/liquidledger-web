import "server-only";
// Helpers for personal ("me") settings: profile and security. These act on the
// signed-in user, not on tenant data, so they don't go through appAction().
import { revalidatePath } from "next/cache";
import type { Session, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/ratelimit";
import { decrypt, encrypt, verifyPassword } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { sendMail } from "@/lib/email";
import { env } from "@/lib/env";
import { requestMeta } from "@/lib/request";
import { getI18n } from "@/i18n/server";
import { isLocale } from "@/i18n/config";
import type { TFunction } from "@/i18n/t";

export type MeResult<T = object> = ({ ok: true; message?: string } & T) | { ok: false; error: string };
export type Me = { user: User; session: Session; t: TFunction };

export class MeError extends Error {}

/** Run a personal-settings action for the signed-in user (never for support views). */
export async function meAction<T extends object>(fn: (me: Me) => Promise<T & { message?: string }>, revalidate = "/settings"): Promise<MeResult<T>> {
  const s = await getUserSession();
  const { t } = await getI18n(s && isLocale(s.user.locale) ? s.user.locale : undefined);
  if (!s) return { ok: false, error: t("settings.err.session") };
  try {
    const res = await fn({ user: s.user, session: s.session, t });
    revalidatePath(revalidate, "layout");
    return { ok: true, ...res };
  } catch (e) {
    if (e instanceof MeError) return { ok: false, error: e.message };
    console.error("[settings]", e);
    return { ok: false, error: t("settings.err.generic") };
  }
}

/** Re-authentication for sensitive changes; throttled per user. */
export async function confirmPassword(me: Me, password: string) {
  if (!(await rateLimit(`reauth:${me.user.id}`, 10, 15 * 60))) throw new MeError(me.t("settings.err.throttled"));
  if (!(await verifyPassword(me.user.passwordHash, password))) throw new MeError(me.t("settings.err.wrongPassword"));
}

/** Stateless, tamper-proof pending state (TOTP secret, WebAuthn challenge, SMS code) bound to one user. */
export function sealPending(kind: string, userId: string, payload: Record<string, string>, minutes = 10): string {
  return encrypt(JSON.stringify({ k: kind, u: userId, e: Date.now() + minutes * 60_000, p: payload }));
}

export function openPending(kind: string, userId: string, blob: string): Record<string, string> | null {
  try {
    const v = JSON.parse(decrypt(blob)) as { k: string; u: string; e: number; p: Record<string, string> };
    if (v.k !== kind || v.u !== userId || v.e < Date.now()) return null;
    return v.p;
  } catch {
    return null;
  }
}

/** Audit + "Security change on your account" email. */
export async function securityChange(me: Pick<Me, "user" | "session">, action: string, summary: string, mailLine: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId: me.user.id, administrationId: me.session.administrationId ?? undefined },
    include: { administration: true },
  });
  await audit({
    actor: { type: "USER", id: me.user.id, label: me.user.name },
    action,
    summary,
    clientId: membership?.administration.clientId,
    administrationId: me.session.administrationId,
    targetType: "user",
    targetId: me.user.id,
  });
  const { ip, userAgent } = await requestMeta();
  await sendMail({
    to: me.user.email,
    subject: "Security change on your account",
    text:
      `Hi ${me.user.name},\n\n${mailLine}\n\n` +
      `Time: ${new Date().toUTCString()}\nIP address: ${ip ?? "unknown"}\nDevice: ${userAgent ?? "unknown"}\n\n` +
      `If this was you, there's nothing to do.\nIf it wasn't, reset your password now (${env.appUrl}/forgot) and contact support@liquidledger.net.\n\n— Liquid Ledger`,
  });
}

/** "Chrome on Mac" from a user agent. */
export function describeDevice(ua: string | null | undefined): { label: string; mobile: boolean } {
  const s = ua ?? "";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : null;
  const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Mac OS X/.test(s) ? "Mac" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : null;
  const label = browser && os ? `${browser} · ${os}` : browser ?? os ?? (s ? s.slice(0, 40) : "Unknown device");
  return { label, mobile: /iPhone|Android|Mobile/.test(s) };
}
