import { NextResponse } from "next/server";
import { z } from "zod";
import * as flow from "@/lib/auth/staff-flow";
import { assertSameOrigin, HttpError } from "@/lib/request";
import { getStaffSession, revokeCurrentStaffSession } from "@/lib/auth/session";
import { adminIpAllowed } from "@/lib/admin/staff";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const handlers: Record<string, (body: unknown) => Promise<unknown>> = {
  async login(body) {
    const { email, password } = z.object({ email: z.string().max(320), password: z.string().max(500) }).parse(body);
    if (!email.trim() || !password) return { ok: false, error: "missing" };
    return flow.staffPasswordStep(email, password);
  },
  async passkey(body) {
    const b = z.object({ response: z.any() }).parse(body);
    return flow.staffPasskeyStep(b.response);
  },
  async "passkey-login-options"() {
    const options = await flow.staffPasskeyLoginOptions();
    return options ? { ok: true, options } : { ok: false, error: "throttled" };
  },
  async "passkey-login"(body) {
    const b = z.object({ response: z.any() }).parse(body);
    return flow.staffPasskeyLoginVerify(b.response);
  },
  async "setup-options"(body) {
    const b = z.object({ token: z.string().max(200), password: z.string().max(500) }).parse(body);
    return flow.staffSetupOptions(b.token, b.password);
  },
  async setup(body) {
    const b = z.object({ response: z.any() }).parse(body);
    return flow.staffSetupVerify(b.response);
  },
  async logout() {
    const s = await getStaffSession();
    if (s) await audit({ actor: { type: "STAFF", id: s.staff.id, label: s.staff.name }, action: "staff.sign_out", summary: "Signed out of the admin console" });
    await revokeCurrentStaffSession();
    return { ok: true };
  },
};

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const handler = handlers[action];
  if (!handler) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  try {
    await assertSameOrigin();
    const ip = await adminIpAllowed();
    if (!ip.allowed) return NextResponse.json({ ok: false, error: "ip" }, { status: 403 });
    const body = req.headers.get("content-type")?.includes("application/json") ? await req.json().catch(() => ({})) : {};
    const result = await handler(body);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    if (e instanceof z.ZodError) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    console.error(`[admin-auth/${action}]`, e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }
}
