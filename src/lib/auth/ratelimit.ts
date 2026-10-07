import "server-only";
import { prisma } from "../db";

/**
 * Fixed-window counter stored in Postgres so it works across all app
 * instances. Returns false once `limit` hits within `windowSeconds`.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowSeconds * 1000);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (key, count, window_start) VALUES (${key}, 1, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < ${windowStart} THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < ${windowStart} THEN ${now} ELSE rate_limits.window_start END
    RETURNING count`;
  return (rows[0]?.count ?? 0) <= limit;
}
