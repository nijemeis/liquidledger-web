import { NextResponse } from "next/server";
import { consumeSupportHandoff } from "@/lib/admin/support";
import { COOKIE, setCookie } from "@/lib/auth/cookies";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

// Support handoff: turns a one-time token from the admin console into a
// read-only support session on the client app (see src/lib/admin/support.ts).
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const result = await consumeSupportHandoff(token);
  const base = env.appUrl;
  if (!result) {
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><title>Support link expired</title><body style="font-family:system-ui,sans-serif;padding:48px;color:#14171f"><h1 style="font-size:22px">This support link has expired or was already used</h1><p style="color:#5b6474">Support links work once and for 2 minutes. Go back to the admin console and click “Open client app” again.</p></body>`,
      { status: 410, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
    );
  }
  const seconds = Math.max(60, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000));
  await setCookie(COOKIE.support, result.token, seconds);
  const res = NextResponse.redirect(new URL("/dashboard", base), 303);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
