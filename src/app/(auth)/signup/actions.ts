"use server";
import { z } from "zod";
import { startTrial } from "@/lib/auth/flow";
import { getLocale } from "@/i18n/server";
import { COUNTRIES } from "@/lib/domain/setup";

const schema = z.object({
  company: z.string().trim().min(1).max(160),
  country: z.string().refine((c) => c in COUNTRIES),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(320).email(),
});

export async function signupAction(input: { company: string; country: string; name: string; email: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = schema.safeParse(input);
  if (!p.success) {
    const emailBad = p.error.issues.some((i) => i.path[0] === "email") && input.email.trim();
    return { ok: false, error: emailBad ? "emailInvalid" : "fieldsMissing" };
  }
  const locale = await getLocale();
  return startTrial({ ...p.data, locale });
}
