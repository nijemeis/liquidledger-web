import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";

// One client per process. In dev, Next's hot reload would otherwise create a
// new pool on every change.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/**
 * Run `fn` inside a transaction scoped to one administration. Postgres
 * row-level security only shows rows of that administration, so even a query
 * that forgets its `administrationId` filter cannot leak another tenant's data.
 *
 * All access to bookkeeping tables must go through here.
 */
export async function withTenant<T>(administrationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!administrationId) throw new Error("withTenant: administrationId is required");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.administration_id', ${administrationId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

/**
 * Cross-tenant access for platform code (seeding, platform-admin statistics,
 * background jobs). Use sparingly and never with user-controlled filters
 * without an explicit administration check.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    return fn(tx);
  }, TX_OPTIONS);
}
