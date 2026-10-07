"use server";
import { z } from "zod";
import { acceptInvite } from "@/lib/auth/flow";

export async function acceptInviteAction(input: { token: string; name: string; password: string; repeat: string }) {
  const p = z
    .object({ token: z.string().min(10).max(200), name: z.string().max(200), password: z.string().max(500), repeat: z.string().max(500) })
    .safeParse(input);
  if (!p.success) return { ok: false as const, error: "expired" };
  return acceptInvite(p.data.token, p.data.name, p.data.password, p.data.repeat);
}
