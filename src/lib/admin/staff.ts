import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Session, StaffRole, StaffUser } from "@prisma/client";
import { getStaffSession } from "../auth/session";
import { getPolicies, ipAllowed } from "../policies";
import { requestMeta } from "../request";
import { audit, type AuditInput } from "../audit";
import type { Tx } from "../db";
import { getI18n } from "@/i18n/server";
import type { TFunction } from "@/i18n/t";
import type { Formatters } from "../format";

// ─────────────────────────────────────────────────────────────────────────────
// Platform staff: what each staff role may do in the admin console.
//   SUPER_ADMIN  everything
//   SUPPORT      read clients & users, open support sessions, reset 2FA,
//                unlock users, resend invites, sign users out
//   FINANCE      plans & billing (incl. change plan, suspend), read clients
// ─────────────────────────────────────────────────────────────────────────────

export const STAFF_CAPS = {
  "clients.read": ["SUPER_ADMIN", "SUPPORT", "FINANCE"],
  "clients.write": ["SUPER_ADMIN"], // create, edit, modules, invite users
  "clients.billing": ["SUPER_ADMIN", "FINANCE"], // change plan, suspend / reactivate
  "users.read": ["SUPER_ADMIN", "SUPPORT"],
  "users.support": ["SUPER_ADMIN", "SUPPORT"], // resend invite, unlock, reset 2FA, sign out everywhere
  "users.write": ["SUPER_ADMIN"], // change role, disable / enable
  "support.open": ["SUPER_ADMIN", "SUPPORT"],
  "billing.read": ["SUPER_ADMIN", "FINANCE"],
  "billing.write": ["SUPER_ADMIN", "FINANCE"],
  "audit.read": ["SUPER_ADMIN", "SUPPORT"],
  "policies.write": ["SUPER_ADMIN"],
  "rates.write": ["SUPER_ADMIN"],
  "staff.manage": ["SUPER_ADMIN"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type StaffCap = keyof typeof STAFF_CAPS;

export function staffCan(role: StaffRole, cap: StaffCap): boolean {
  return (STAFF_CAPS[cap] as readonly StaffRole[]).includes(role);
}

/** All capabilities of a role, for hiding UI on the client. */
export function capsOf(role: StaffRole): Record<StaffCap, boolean> {
  return Object.fromEntries(Object.keys(STAFF_CAPS).map((c) => [c, staffCan(role, c as StaffCap)])) as Record<StaffCap, boolean>;
}

export interface StaffContext {
  staff: StaffUser;
  session: Session;
  ip: string | null;
  can: (cap: StaffCap) => boolean;
  actor: { type: "STAFF"; id: string; label: string };
  t: TFunction;
  fmt: Formatters;
}

/** Is the current request's IP allowed into the admin console? */
export const adminIpAllowed = cache(async (): Promise<{ allowed: boolean; ip: string | null }> => {
  const [policies, { ip }] = await Promise.all([getPolicies(), requestMeta()]);
  if (!policies.ipAllow) return { allowed: true, ip };
  return { allowed: ipAllowed(ip, policies.ipAllowList), ip };
});

export const getStaffContext = cache(async (): Promise<StaffContext | null> => {
  const ip = await adminIpAllowed();
  if (!ip.allowed) return null;
  const s = await getStaffSession();
  if (!s) return null;
  const { t, fmt } = await getI18n();
  return {
    t,
    fmt,
    staff: s.staff,
    session: s.session,
    ip: ip.ip,
    can: (cap) => staffCan(s.staff.role, cap),
    actor: { type: "STAFF", id: s.staff.id, label: s.staff.name },
  };
});

/**
 * For admin pages: a signed-in staff member (else the login page), optionally
 * with one of the given roles / a capability (else back to the overview).
 */
export async function requireStaff(need?: StaffRole[] | StaffCap): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/admin/login");
  if (need) {
    const ok = Array.isArray(need) ? need.includes(ctx.staff.role) : ctx.can(need);
    if (!ok) redirect("/admin?denied=1");
  }
  return ctx;
}

/** Plain-language failure from inside a staff action. */
export class AdminError extends Error {}

export type StaffActionResult<T = object> = ({ ok: true; message?: string } & T) | { ok: false; error: string };

/**
 * Wrapper for every admin Server Action: checks the staff session, the IP
 * allow-list and the role, turns AdminError into a message, revalidates.
 */
export async function staffAction<T extends object>(
  need: StaffRole[] | StaffCap,
  fn: (ctx: StaffContext) => Promise<T & { message?: string }>,
): Promise<StaffActionResult<T>> {
  const { t } = await getI18n();
  const ip = await adminIpAllowed();
  if (!ip.allowed) return { ok: false, error: t("admin.err.ip") };
  const ctx = await getStaffContext();
  if (!ctx) return { ok: false, error: t("admin.err.session") };
  const ok = Array.isArray(need) ? need.includes(ctx.staff.role) : ctx.can(need);
  if (!ok) return { ok: false, error: t("admin.err.role") };
  try {
    const res = await fn(ctx);
    revalidatePath("/admin", "layout");
    return { ok: true, ...res };
  } catch (e) {
    if (e instanceof AdminError) return { ok: false, error: e.message };
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) return { ok: false, error: t("admin.err.exists") };
    if (e instanceof Error && e.name === "ZodError") return { ok: false, error: t("admin.err.input") };
    console.error("[admin action]", e);
    return { ok: false, error: t("common.error") };
  }
}

/** Audit as the signed-in staff member. */
export async function auditStaff(ctx: StaffContext, input: Omit<AuditInput, "actor">, tx?: Tx) {
  await audit({ ...input, actor: ctx.actor }, tx);
}
