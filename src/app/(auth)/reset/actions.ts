"use server";
import { z } from "zod";
import { resetPasswordWithToken } from "@/lib/auth/flow";

export async function resetAction(input: { token: string; password: string; repeat: string }) {
  const p = z.object({ token: z.string().min(10).max(200), password: z.string().max(500), repeat: z.string().max(500) }).safeParse(input);
  if (!p.success) return { ok: false as const, error: "expired" };
  return resetPasswordWithToken(p.data.token, p.data.password, p.data.repeat);
}
