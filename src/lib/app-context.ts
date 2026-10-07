import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Administration, Client, Role as DbRole, StaffUser, SupportSession, User } from "@prisma/client";
import { prisma, withTenant, type Tx } from "./db";
import { getUserSession } from "./auth/session";
import { COOKIE, getCookie } from "./auth/cookies";
import { sha256 } from "./crypto";
import { canEdit, canView, type Permission, type Role } from "./permissions";
import { isLocale, type Locale } from "@/i18n/config";
import { PostingError } from "./domain/ledger";
import { audit, type Actor } from "./audit";

export interface AppContext {
  kind: "user" | "support";
  user: User | null;
  staff: StaffUser | null;
  actor: Actor;
  userId: string | null; // for createdById columns
  displayName: string;
  administration: Administration & { client: Client };
  role: Role;
  memberships: { administrationId: string; legalName: string; role: DbRole }[];
  locale: Locale;
  /** Can't change anything: support view, suspended client. */
  readOnly: boolean;
  readOnlyReason: "support" | "suspended" | null;
  supportSession: (SupportSession & { staff: StaffUser }) | null; // active support access on this client
}

async function supportContext(): Promise<AppContext | null> {
  const token = await getCookie(COOKIE.support);
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { staff: true } });
  if (!s || s.kind !== "STAFF" || !s.supportSessionId || !s.administrationId || !s.staff || s.revokedAt || s.expiresAt < new Date()) return null;
  const support = await prisma.supportSession.findUnique({ where: { id: s.supportSessionId }, include: { staff: true } });
  if (!support || support.endedAt || support.expiresAt < new Date()) return null;
  const administration = await prisma.administration.findUnique({ where: { id: s.administrationId }, include: { client: true } });
  if (!administration || administration.clientId !== support.clientId) return null;
  return {
    kind: "support",
    user: null,
    staff: s.staff,
    actor: { type: "STAFF", id: s.staff.id, label: s.staff.name },
    userId: null,
    displayName: s.staff.name,
    administration,
    role: "READ_ONLY",
    memberships: [{ administrationId: administration.id, legalName: administration.legalName, role: "READ_ONLY" }],
    locale: "en",
    readOnly: true,
    readOnlyReason: "support",
    supportSession: support,
  };
}

/** Resolve who is using the app and in which administration. Cached per request. */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const s = await getUserSession();
  if (!s) return supportContext();
  const { user, session } = s;
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, administration: { deletedAt: null } },
    include: { administration: { include: { client: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!memberships.length) return null;
  const current = memberships.find((m) => m.administrationId === session.administrationId) ?? memberships[0]!;
  const client = current.administration.client;
  const support = await prisma.supportSession.findFirst({
    where: { clientId: client.id, endedAt: null, expiresAt: { gt: new Date() } },
    include: { staff: true },
    orderBy: { startedAt: "desc" },
  });
  const suspended = client.status === "SUSPENDED";
  return {
    kind: "user",
    user,
    staff: null,
    actor: { type: "USER", id: user.id, label: user.name },
    userId: user.id,
    displayName: user.name,
    administration: current.administration,
    role: current.role as Role,
    memberships: memberships.map((m) => ({ administrationId: m.administrationId, legalName: m.administration.legalName, role: m.role })),
    locale: isLocale(user.locale) ? user.locale : "en",
    readOnly: suspended,
    readOnlyReason: suspended ? "suspended" : null,
    supportSession: support,
  };
});

/** For pages: signed in with an administration, else redirect. Optionally require view access. */
export async function requireApp(perm?: Permission): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) {
    const s = await getUserSession();
    redirect(s ? "/no-access" : "/login");
  }
  if (perm && !canView(ctx.role, perm)) redirect("/dashboard?denied=1");
  return ctx;
}

export function canEditIn(ctx: AppContext, perm: Permission) {
  return !ctx.readOnly && canEdit(ctx.role, perm);
}

/** Run read queries for the current administration under row-level security. */
export function tenant<T>(ctx: AppContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(ctx.administration.id, fn);
}

export type ActionResult<T = object> = ({ ok: true; message?: string } & T) | { ok: false; error: string };

/**
 * Wrapper for every mutating Server Action: checks the session and the role's
 * permission, blocks read-only contexts, runs inside the tenant transaction,
 * turns domain errors into a plain-language message and revalidates.
 */
export async function appAction<T extends object>(
  perm: Permission | null,
  fn: (ctx: AppContext, tx: Tx) => Promise<ActionResult<T> | T & { message?: string }>,
  opts: { revalidate?: string | string[] } = {},
): Promise<ActionResult<T>> {
  const ctx = await getAppContext();
  if (!ctx) return { ok: false, error: "Your session has ended. Sign in again." };
  if (ctx.readOnly) {
    return { ok: false, error: ctx.readOnlyReason === "support" ? "Support view is read-only." : "This account is suspended — changes are disabled." };
  }
  if (perm && !canEdit(ctx.role, perm)) return { ok: false, error: "Your role doesn't allow this change." };
  try {
    const res = await withTenant(ctx.administration.id, (tx) => fn(ctx, tx));
    const paths = opts.revalidate ? (Array.isArray(opts.revalidate) ? opts.revalidate : [opts.revalidate]) : ["/", "layout"];
    if (paths[1] === "layout") revalidatePath(paths[0]!, "layout");
    else for (const p of paths) revalidatePath(p);
    if ("ok" in res && res.ok === false) return res as ActionResult<T>;
    return { ok: true, ...(res as T) } as ActionResult<T>;
  } catch (e) {
    if (e instanceof PostingError) return { ok: false, error: e.message };
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("period is closed")) return { ok: false, error: "That date falls in a closed period. Use a later date or reopen the period." };
    if (msg.includes("Unique constraint")) return { ok: false, error: "That already exists." };
    console.error("[action]", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function auditApp(ctx: AppContext, action: string, summary: string, extra: Partial<Parameters<typeof audit>[0]> = {}, tx?: Tx) {
  await audit(
    { actor: ctx.actor, action, summary, clientId: ctx.administration.clientId, administrationId: ctx.administration.id, ...extra },
    tx,
  );
}
