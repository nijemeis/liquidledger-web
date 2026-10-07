import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { requestMeta } from "./request";

export type Actor =
  | { type: "USER"; id: string; label: string }
  | { type: "STAFF"; id: string; label: string }
  | { type: "SYSTEM"; label?: string };

export interface AuditInput {
  actor: Actor;
  action: string;
  summary: string;
  clientId?: string | null;
  administrationId?: string | null;
  targetType?: string;
  targetId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/**
 * Append an audit event. Pass `tx` to make it part of the same transaction as
 * the change it records (the event then only exists if the change committed).
 */
export async function audit(input: AuditInput, tx?: Tx): Promise<void> {
  let meta: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null };
  try {
    meta = await requestMeta();
  } catch {
    // Outside a request (scripts, jobs).
  }
  const db = tx ?? prisma;
  await db.auditEvent.create({
    data: {
      actorType: input.actor.type,
      actorId: input.actor.type === "SYSTEM" ? null : input.actor.id,
      actorLabel: input.actor.label ?? "System",
      action: input.action,
      summary: input.summary,
      clientId: input.clientId ?? null,
      administrationId: input.administrationId ?? null,
      targetType: input.targetType,
      targetId: input.targetId,
      before: input.before,
      after: input.after,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });
}
