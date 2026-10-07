import "server-only";
import type { Prisma } from "@prisma/client";

export type AuditFilters = { client?: string; actor?: string; q?: string; from?: string; to?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalise untrusted query params into filters. */
export function parseAuditFilters(sp: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 120) || undefined;
  };
  const actor = one("actor");
  return {
    client: one("client"),
    actor: actor && ["USER", "STAFF", "SYSTEM"].includes(actor) ? actor : undefined,
    q: one("q"),
    from: DATE.test(one("from") ?? "") ? one("from") : undefined,
    to: DATE.test(one("to") ?? "") ? one("to") : undefined,
  };
}

export function auditWhere(f: AuditFilters): Prisma.AuditEventWhereInput {
  const and: Prisma.AuditEventWhereInput[] = [];
  if (f.client === "none") and.push({ clientId: null });
  else if (f.client) and.push({ clientId: f.client });
  if (f.actor) and.push({ actorType: f.actor as "USER" | "STAFF" | "SYSTEM" });
  if (f.q) and.push({ OR: [{ action: { contains: f.q, mode: "insensitive" } }, { summary: { contains: f.q, mode: "insensitive" } }, { actorLabel: { contains: f.q, mode: "insensitive" } }] });
  if (f.from) and.push({ at: { gte: new Date(`${f.from}T00:00:00Z`) } });
  if (f.to) and.push({ at: { lt: new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86400_000) } });
  return and.length ? { AND: and } : {};
}

export function auditQueryString(f: AuditFilters, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
