import { NextResponse } from "next/server";
import { z } from "zod";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "@/lib/db";
import { getUserSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/ratelimit";
import { verifyPassword } from "@/lib/crypto";
import { passkeyName, registrationOptions, verifyRegistration } from "@/lib/auth/webauthn";
import { assertSameOrigin, HttpError, requestMeta } from "@/lib/request";
import { getI18n } from "@/i18n/server";
import { isLocale } from "@/i18n/config";
import { openPending, sealPending, securityChange } from "@/app/(app)/settings/me";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("step", [
  z.object({ step: z.literal("options"), password: z.string().max(500) }),
  z.object({ step: z.literal("verify"), pending: z.string().max(4000), response: z.any(), name: z.string().trim().max(60).optional() }),
]);

/** Add a passkey from Settings → Security: options (password re-check) → verify. */
export async function POST(req: Request) {
  try {
    await assertSameOrigin();
    const s = await getUserSession();
    if (!s) return NextResponse.json({ ok: false, error: "Your session has ended. Sign in again." }, { status: 401 });
    const { t } = await getI18n(isLocale(s.user.locale) ? s.user.locale : undefined);
    const b = body.parse(await req.json().catch(() => ({})));

    if (b.step === "options") {
      if (!(await rateLimit(`reauth:${s.user.id}`, 10, 15 * 60))) return NextResponse.json({ ok: false, error: t("settings.err.throttled") });
      if (!(await verifyPassword(s.user.passwordHash, b.password))) return NextResponse.json({ ok: false, error: t("settings.err.wrongPassword") });
      const existing = await prisma.passkey.findMany({ where: { userId: s.user.id } });
      const options = await registrationOptions({ userId: s.user.id, email: s.user.email, name: s.user.name, existing });
      return NextResponse.json({ ok: true, options, pending: sealPending("passkey", s.user.id, { c: options.challenge }, 5) }, { headers: { "Cache-Control": "no-store" } });
    }

    const pending = openPending("passkey", s.user.id, b.pending);
    if (!pending?.c) return NextResponse.json({ ok: false, error: t("settings.err.expired") });
    const reg = await verifyRegistration(b.response as RegistrationResponseJSON, pending.c).catch(() => null);
    if (!reg) return NextResponse.json({ ok: false, error: t("settings.security.passkeyFailed") });
    const { userAgent } = await requestMeta();
    const name = b.name || passkeyName(userAgent);
    await prisma.passkey.create({ data: { ...reg, userId: s.user.id, name } });
    await securityChange(s, "auth.passkey_added", `Added passkey "${name}"`, `A new passkey ("${name}") was added to your account. It can be used to sign in.`);
    return NextResponse.json({ ok: true, message: t("settings.security.passkeyAdded", { name }) });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    if (e instanceof z.ZodError) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    if (e instanceof Error && e.message.includes("Unique constraint")) return NextResponse.json({ ok: false, error: "That passkey is already registered." });
    console.error("[me/passkeys]", e);
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
