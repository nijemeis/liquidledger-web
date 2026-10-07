import { NextResponse } from "next/server";
import { z } from "zod";
import * as flow from "@/lib/auth/flow";
import { assertSameOrigin, HttpError } from "@/lib/request";
import { revokeCurrentUserSession, getUserSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const code = z.object({ code: z.string().max(64), trust: z.boolean().optional().default(false) });

const handlers: Record<string, (body: unknown) => Promise<unknown>> = {
  async login(body) {
    const { email, password } = z.object({ email: z.string().max(320), password: z.string().max(500) }).parse(body);
    if (!email.trim() || !password) return { ok: false, error: "missing" };
    return flow.passwordStep(email, password);
  },
  async totp(body) {
    const b = code.parse(body);
    return flow.verifyTotpStep(b.code, b.trust);
  },
  async recovery(body) {
    const b = code.parse(body);
    return flow.verifyRecoveryStep(b.code, b.trust);
  },
  async "sms-send"() {
    return flow.sendSmsStep();
  },
  async sms(body) {
    const b = code.parse(body);
    return flow.verifySmsStep(b.code, b.trust);
  },
  async "mfa-passkey-options"() {
    const options = await flow.passkeyMfaOptions();
    return options ? { ok: true, options } : { ok: false, error: "expired" };
  },
  async "mfa-passkey"(body) {
    const b = z.object({ response: z.any(), trust: z.boolean().optional().default(false) }).parse(body);
    return flow.passkeyMfaVerify(b.response, b.trust);
  },
  async "passkey-options"() {
    const options = await flow.passkeyLoginOptions();
    return options ? { ok: true, options } : { ok: false, error: "throttled" };
  },
  async passkey(body) {
    const b = z.object({ response: z.any() }).parse(body);
    return flow.passkeyLoginVerify(b.response);
  },
  async "enroll-totp-start"() {
    const r = await flow.enrollTotpStart();
    return r ? { ok: true, ...r } : { ok: false, error: "expired" };
  },
  async "enroll-totp"(body) {
    const b = z.object({ code: z.string().max(12) }).parse(body);
    return flow.enrollTotpConfirm(b.code);
  },
  async "enroll-passkey-options"() {
    const options = await flow.enrollPasskeyOptions();
    return options ? { ok: true, options } : { ok: false, error: "expired" };
  },
  async "enroll-passkey"(body) {
    const b = z.object({ response: z.any() }).parse(body);
    return flow.enrollPasskeyVerify(b.response);
  },
  async logout() {
    const s = await getUserSession();
    if (s) {
      await audit({ actor: { type: "USER", id: s.user.id, label: s.user.name }, action: "auth.sign_out", summary: "Signed out", administrationId: s.session.administrationId });
    }
    await revokeCurrentUserSession();
    return { ok: true };
  },
};

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const handler = handlers[action];
  if (!handler) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  try {
    await assertSameOrigin();
    const body = req.headers.get("content-type")?.includes("application/json") ? await req.json().catch(() => ({})) : {};
    const result = await handler(body);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    if (e instanceof z.ZodError) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    console.error(`[auth/${action}]`, e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }
}
