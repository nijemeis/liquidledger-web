"use server";
import { z } from "zod";
import { requestPasswordReset } from "@/lib/auth/flow";

export async function forgotAction(input: { email: string }): Promise<{ ok: true } | { ok: false; error: "throttled" | "emailInvalid" }> {
  const p = z.object({ email: z.string().trim().max(320).email() }).safeParse(input);
  if (!p.success) return { ok: false, error: "emailInvalid" };
  return requestPasswordReset(p.data.email);
}
