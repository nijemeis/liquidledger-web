import { getAppContext, tenant } from "@/lib/app-context";
import { canView } from "@/lib/permissions";
import { fiscalYearOf } from "@/lib/domain/reports";
import { loadXafData, renderXaf } from "@/lib/xaf/export";
import pkg from "../../../../../package.json";

export const dynamic = "force-dynamic";

/** XAF 3.2 auditfile of one fiscal year (?year=2025 → the fiscal year starting in 2025). */
export async function GET(req: Request) {
  const ctx = await getAppContext();
  if (!ctx) return new Response("Not signed in", { status: 401 });
  if (!canView(ctx.role, "reports")) return new Response("Not allowed", { status: 403 });
  const a = ctx.administration;
  const year = Number(new URL(req.url).searchParams.get("year"));
  const ref = Number.isInteger(year) && year >= 1990 && year <= 2200 ? new Date(Date.UTC(year, a.fiscalYearStart - 1, 1)) : new Date();
  const fy = fiscalYearOf(ref, a.fiscalYearStart);
  const xml = await tenant(ctx, async (tx) => renderXaf(await loadXafData(tx, a, fy.start, fy.end, { name: "Liquid Ledger", version: pkg.version })));
  const slug = a.legalName.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "auditfile";
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}_${fy.start.toISOString().slice(0, 10)}_${fy.end.toISOString().slice(0, 10)}.xaf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
