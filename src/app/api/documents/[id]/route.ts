import { getAppContext, tenant } from "@/lib/app-context";
import { canView } from "@/lib/permissions";
import { readBlob } from "@/lib/documents/storage";

export const dynamic = "force-dynamic";

/**
 * Serve an uploaded document to signed-in users of its administration. Read
 * through tenant() so row-level security applies. Served inline but sandboxed
 * (no scripts, no same-origin) so a crafted file can't act as the app.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAppContext();
  if (!ctx) return new Response("Not signed in", { status: 401 });
  if (!canView(ctx.role, "purchases") && !canView(ctx.role, "customs")) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const doc = await tenant(ctx, (tx) => tx.document.findFirst({ where: { id, administrationId: ctx.administration.id } }));
  if (!doc) return new Response("Not found", { status: 404 });
  const bytes = await readBlob(doc);
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = doc.filename.replace(/["\\\r\n]/g, "_");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Cache-Control": "private, max-age=300",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}
