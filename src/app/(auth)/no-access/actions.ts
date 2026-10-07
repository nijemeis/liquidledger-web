"use server";
import { audit } from "@/lib/audit";
import { getUserSession, revokeCurrentUserSession } from "@/lib/auth/session";

export async function noAccessSignOut() {
  const s = await getUserSession();
  if (s) await audit({ actor: { type: "USER", id: s.user.id, label: s.user.name }, action: "auth.sign_out", summary: "Signed out" });
  await revokeCurrentUserSession();
}
