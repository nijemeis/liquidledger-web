"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getUserSession, revokeCurrentUserSession } from "@/lib/auth/session";
import { COOKIE, deleteCookie, getCookie } from "@/lib/auth/cookies";
import { sha256 } from "@/lib/crypto";
import { isLocale } from "@/i18n/config";
import { audit } from "@/lib/audit";
import { endSupportSessionFromApp } from "@/lib/admin/support";

export async function switchAdministration(administrationId: string) {
  const s = await getUserSession();
  if (!s) return { ok: false };
  const m = await prisma.membership.findUnique({ where: { userId_administrationId: { userId: s.user.id, administrationId } } });
  if (!m) return { ok: false };
  await prisma.session.update({ where: { id: s.session.id }, data: { administrationId } });
  await prisma.user.update({ where: { id: s.user.id }, data: { lastAdministrationId: administrationId } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setUserLocale(locale: string) {
  if (!isLocale(locale)) return;
  const s = await getUserSession();
  if (s) await prisma.user.update({ where: { id: s.user.id }, data: { locale } });
  revalidatePath("/", "layout");
}

export async function signOut() {
  const s = await getUserSession();
  if (s) await audit({ actor: { type: "USER", id: s.user.id, label: s.user.name }, action: "auth.sign_out", summary: "Signed out", administrationId: s.session.administrationId });
  await revokeCurrentUserSession();
}

/** Leave the read-only support view of a client app. */
export async function endSupportView() {
  const token = await getCookie(COOKIE.support);
  if (token) {
    const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
    await prisma.session.updateMany({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } });
    // Ending the view also ends the time-boxed support session (and its audit trail).
    if (s?.kind === "STAFF" && s.staffId && s.supportSessionId) await endSupportSessionFromApp(s.supportSessionId, s.staffId);
  }
  await deleteCookie(COOKIE.support);
}
