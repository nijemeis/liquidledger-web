import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStaffContext } from "@/lib/admin/staff";
import { auditWhere, parseAuditFilters } from "@/lib/admin/audit-query";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const MAX_ROWS = 50_000;

/** CSV cell: quoted, and neutralised against spreadsheet formula injection. */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const ctx = await getStaffContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  if (!ctx.can("audit.read")) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = parseAuditFilters(sp);
  const where = auditWhere(f);
  const [events, clients] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: { at: "desc" }, take: MAX_ROWS }),
    prisma.client.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const header = ["time_utc", "actor_type", "actor", "action", "summary", "client", "administration_id", "target_type", "target_id", "ip", "user_agent"];
  const lines = [header.map(cell).join(",")];
  for (const e of events) {
    lines.push(
      [e.at.toISOString(), e.actorType, e.actorLabel, e.action, e.summary, e.clientId ? names.get(e.clientId) ?? e.clientId : "", e.administrationId, e.targetType, e.targetId, e.ip, e.userAgent]
        .map(cell)
        .join(","),
    );
  }
  await audit({ actor: ctx.actor, action: "audit.export", summary: `Exported ${events.length} audit events as CSV` });
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="liquid-ledger-audit-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
