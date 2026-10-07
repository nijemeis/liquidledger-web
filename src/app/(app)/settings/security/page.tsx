import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireApp } from "@/lib/app-context";
import { prisma } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { COOKIE, getCookie } from "@/lib/auth/cookies";
import { sha256 } from "@/lib/crypto";
import { maskPhone, smsAvailable } from "@/lib/sms";
import { describeDevice } from "../me";
import { SecurityClient } from "./security-client";

export const metadata: Metadata = { title: "Security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const ctx = await requireApp();
  if (!ctx.user) redirect("/settings/administration");
  const { fmt } = await getI18n(ctx.locale);
  const userId = ctx.user.id;
  const now = new Date();
  const [user, passkeys, codesLeft, sessions, devices, currentToken, deviceToken] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.passkey.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.recoveryCode.count({ where: { userId, usedAt: null } }),
    prisma.session.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: now } }, orderBy: { lastSeenAt: "desc" } }),
    prisma.userDevice.findMany({ where: { userId, trustedUntil: { gt: now } }, orderBy: { lastSeenAt: "desc" } }),
    getCookie(COOKIE.session),
    getCookie(COOKIE.device),
  ]);
  const currentHash = currentToken ? sha256(currentToken) : null;
  const deviceHash = deviceToken ? sha256(deviceToken) : null;
  const live = sessions.filter((s) => s.lastSeenAt.getTime() + s.idleTimeoutMin * 60_000 > now.getTime());

  return (
    <SecurityClient
      passwordChanged={user.passwordChangedAt ? fmt.dateMed(user.passwordChangedAt) : null}
      totp={user.totpSecretEnc && user.totpEnabledAt ? fmt.dateMed(user.totpEnabledAt) : null}
      sms={user.smsEnabled && user.phone ? maskPhone(user.phone) : null}
      smsAvailable={smsAvailable()}
      passkeys={passkeys.map((p) => ({ id: p.id, name: p.name, created: fmt.dateMed(p.createdAt), lastUsed: p.lastUsedAt ? fmt.dateTime(p.lastUsedAt) : null, synced: p.backedUp }))}
      codesLeft={codesLeft}
      sessions={live.map((s) => {
        const d = describeDevice(s.userAgent);
        return { id: s.id, device: d.label, mobile: d.mobile, ip: s.ip ?? "—", lastSeen: fmt.dateTime(s.lastSeenAt), started: fmt.dateTime(s.createdAt), method: s.authMethod, current: s.tokenHash === currentHash };
      })}
      devices={devices.map((d) => {
        const dd = describeDevice(d.userAgent);
        return { id: d.id, device: dd.label, mobile: dd.mobile, ip: d.ip ?? "—", lastSeen: fmt.dateTime(d.lastSeenAt), until: fmt.dateMed(d.trustedUntil!), current: d.tokenHash === deviceHash };
      })}
    />
  );
}
