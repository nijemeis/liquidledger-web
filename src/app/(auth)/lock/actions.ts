"use server";
import { z } from "zod";
import { lockAccountWithToken } from "@/lib/auth/flow";

export async function lockAction(input: { token: string }) {
  const p = z.object({ token: z.string().min(10).max(200) }).safeParse(input);
  if (!p.success) return { ok: false };
  return lockAccountWithToken(p.data.token);
}
