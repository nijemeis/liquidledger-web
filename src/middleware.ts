import { NextResponse, type NextRequest } from "next/server";

// Host routing for the platform admin console (Edge runtime: no DB, no Node APIs).
// With ADMIN_HOST set (e.g. admin.liquidledger.net):
//   · on the admin host only /admin*, /api/admin-auth*, /_next* and static files
//     are served; "/" redirects to /admin; anything else is a 404.
//   · on every other host /admin* and /api/admin-auth* are a 404.
// Without ADMIN_HOST (development) everything is served from one host.

const stripPort = (h: string) => h.trim().toLowerCase().replace(/:\d+$/, "");
const under = (p: string, base: string) => p === base || p.startsWith(base + "/");

export function middleware(req: NextRequest) {
  const adminHost = process.env.ADMIN_HOST ? stripPort(process.env.ADMIN_HOST) : "";
  if (!adminHost) return NextResponse.next();

  const host = stripPort((req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0]!);
  const p = req.nextUrl.pathname;
  const adminPath = under(p, "/admin") || under(p, "/api/admin-auth");

  if (host === adminHost) {
    if (p === "/") return NextResponse.redirect(new URL("/admin", req.url));
    if (adminPath || under(p, "/_next") || (/\.[a-z0-9]+$/i.test(p) && !under(p, "/api"))) return NextResponse.next();
    return new NextResponse("Not found", { status: 404 });
  }
  if (adminPath) return new NextResponse("Not found", { status: 404 });
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
