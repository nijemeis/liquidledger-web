import "server-only";
import type { Client, Plan, Prisma, Role, User } from "@prisma/client";
import { prisma, withSystem } from "../db";
import { COUNTRIES, PLANS } from "../domain/setup";
import type { MfaKind } from "./format";
import type { StaffContext } from "./staff";

/** Monthly recurring revenue of one client, in cents (active and past-due clients pay). */
export function mrrOf(c: Pick<Client, "status" | "plan">): number {
  return c.status === "ACTIVE" || c.status === "PAST_DUE" ? (PLANS[c.plan].price ?? 0) : 0;
}

export function planPrice(plan: Plan): number | null {
  return PLANS[plan].price;
}

export function mfaKindOf(u: Pick<User, "totpEnabledAt" | "totpSecretEnc" | "smsEnabled"> & { _count?: { passkeys: number }; passkeys?: unknown[] }): MfaKind {
  const passkeys = u._count?.passkeys ?? u.passkeys?.length ?? 0;
  if (passkeys > 0) return "passkey";
  if (u.totpEnabledAt && u.totpSecretEnc) return "app";
  if (u.smsEnabled) return "sms";
  return "none";
}

/** Users with no second factor at all (Prisma filter). */
export const NO_2FA: Prisma.UserWhereInput = {
  status: { not: "DISABLED" },
  totpEnabledAt: null,
  smsEnabled: false,
  passkeys: { none: {} },
};

export const LOCKED: (now: Date) => Prisma.UserWhereInput = (now) => ({ OR: [{ status: "LOCKED" }, { lockedUntil: { gt: now } }] });

/** Distinct users per client (through memberships of its administrations). */
export async function userCountsByClient(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ client_id: string; n: bigint }[]>`
    SELECT a.client_id, COUNT(DISTINCT m.user_id) AS n
    FROM memberships m JOIN administrations a ON a.id = m.administration_id
    WHERE a.deleted_at IS NULL
    GROUP BY a.client_id`;
  return new Map(rows.map((r) => [r.client_id, Number(r.n)]));
}

/** Bytes of stored documents per administration id (cross-tenant read). */
export async function storageBytes(administrationIds: string[]): Promise<number> {
  if (!administrationIds.length) return 0;
  return withSystem(async (tx) => {
    const r = await tx.document.aggregate({ where: { administrationId: { in: administrationIds } }, _sum: { size: true } });
    return r._sum.size ?? 0;
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export const countryOf = (cc: string) => COUNTRIES[cc] ?? { flag: "🏳️", name: cc, authority: "", vatReturn: "", chart: "", vatExample: "", language: "en" };

/** Client user row with its memberships, as shown on the Users screen. */
export type UserRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  locked: boolean;
  lockReason: string | null;
  mfa: MfaKind;
  lastSignInAt: string | null;
  memberships: { clientId: string; clientName: string; administrationId: string; role: Role }[];
};

export function toUserRow(
  u: User & { _count: { passkeys: number }; memberships: { role: Role; administrationId: string; administration: { clientId: string; client: { name: string } } }[] },
  now = new Date(),
): UserRow {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    status: u.status === "ACTIVE" && u.lockedUntil && u.lockedUntil > now ? "LOCKED" : u.status,
    locked: u.status === "LOCKED" || Boolean(u.lockedUntil && u.lockedUntil > now),
    lockReason: u.lockReason,
    mfa: mfaKindOf(u),
    lastSignInAt: u.lastSignInAt?.toISOString() ?? null,
    memberships: u.memberships.map((m) => ({ clientId: m.administration.clientId, clientName: m.administration.client.name, administrationId: m.administrationId, role: m.role })),
  };
}

export const USER_ROW_INCLUDE = {
  _count: { select: { passkeys: true } },
  memberships: { include: { administration: { select: { clientId: true, client: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.UserInclude;

/** Global search over clients, client users and staff (respecting the staff role). */
export async function searchPlatform(ctx: StaffContext, qRaw: string, take = 6) {
  const q = qRaw.trim().slice(0, 100);
  if (q.length < 2) return { clients: [], users: [], staff: [] };
  const compact = q.replace(/[\s.]/g, "");
  const ci = { contains: q, mode: "insensitive" as const };
  const [clients, users, staff] = await Promise.all([
    prisma.client.findMany({
      where: { OR: [{ name: ci }, { vatNumber: { contains: compact, mode: "insensitive" } }, { administrations: { some: { OR: [{ legalName: ci }, { vatNumber: { contains: compact, mode: "insensitive" } }] } } }] },
      take,
      orderBy: { name: "asc" },
    }),
    ctx.can("users.read")
      ? prisma.user.findMany({ where: { OR: [{ name: ci }, { email: ci }] }, take, orderBy: { name: "asc" }, include: { memberships: { take: 1, include: { administration: { select: { client: { select: { name: true } } } } } } } })
      : Promise.resolve([]),
    ctx.can("users.read") ? prisma.staffUser.findMany({ where: { OR: [{ name: ci }, { email: ci }] }, take, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  return {
    clients: clients.map((c) => ({ id: c.id, name: c.name, vat: c.vatNumber, flag: countryOf(c.country).flag, status: c.status, plan: c.plan })),
    users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, status: u.status, client: u.memberships[0]?.administration.client.name ?? null })),
    staff: staff.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role })),
  };
}
