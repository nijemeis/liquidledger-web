import "server-only";
import { headers } from "next/headers";
import { env } from "./env";

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const raw = h.get(env.trustedIpHeader) ?? h.get("x-real-ip");
  const ip = raw ? raw.split(",")[0]!.trim() : null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 400) ?? null };
}

/**
 * Reject cross-site POSTs to route handlers. Server Actions already verify the
 * Origin header; JSON route handlers call this explicitly.
 */
export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!origin || !host) throw new HttpError(403, "Missing origin");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Bad origin");
  }
  if (originHost !== host) throw new HttpError(403, "Cross-site request blocked");
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}
