import type { Plan, Role } from "@prisma/client";
import type { Tx } from "./types";
import { NL_CHART } from "./chart";

// Countries the platform can onboard (admin "New client" and the free trial).
export const COUNTRIES: Record<string, { flag: string; name: string; authority: string; vatReturn: string; chart: string; vatExample: string; language: string }> = {
  NL: { flag: "🇳🇱", name: "Netherlands", authority: "Dutch excise (Douane)", vatReturn: "NL VAT return", chart: "NL-RGS", vatExample: "NL123456789B01", language: "nl" },
  BE: { flag: "🇧🇪", name: "Belgium", authority: "Belgian excise (AAD&A)", vatReturn: "BE VAT return", chart: "BE-PCMN", vatExample: "BE0123456789", language: "nl" },
  FR: { flag: "🇫🇷", name: "France", authority: "French excise (DGDDI)", vatReturn: "CA3 VAT return", chart: "FR-PCG", vatExample: "FR12345678901", language: "fr" },
  DE: { flag: "🇩🇪", name: "Germany", authority: "German excise (Zoll)", vatReturn: "UStVA", chart: "DE-SKR03", vatExample: "DE123456789", language: "de" },
  IT: { flag: "🇮🇹", name: "Italy", authority: "Italian excise (ADM)", vatReturn: "LIPE", chart: "IT", vatExample: "IT12345678901", language: "it" },
  ES: { flag: "🇪🇸", name: "Spain", authority: "Spanish excise (AEAT)", vatReturn: "Modelo 303", chart: "ES-PGC", vatExample: "ESB12345678", language: "es" },
  PL: { flag: "🇵🇱", name: "Poland", authority: "Polish excise (KAS)", vatReturn: "JPK_V7", chart: "PL", vatExample: "PL1234567890", language: "pl" },
};

export const PLANS: Record<Plan, { price: number | null; administrations: number | null; users: number | null }> = {
  STARTER: { price: 4900, administrations: 1, users: 3 },
  BUSINESS: { price: 14900, administrations: 1, users: 10 },
  PRO: { price: 24900, administrations: 3, users: null },
  ENTERPRISE: { price: null, administrations: null, users: null },
};

export const MODULES = ["excise", "customs", "emcs", "fx", "payroll", "api"] as const;

/** Create a client with its first administration, chart of accounts and defaults. */
export async function createClientWithAdministration(
  tx: Tx,
  input: { name: string; country: string; vatNumber?: string | null; plan: Plan; trial: boolean; modules?: string[] },
) {
  const c = COUNTRIES[input.country] ?? COUNTRIES.NL!;
  const client = await tx.client.create({
    data: {
      name: input.name,
      country: input.country,
      vatNumber: input.vatNumber || null,
      plan: input.plan,
      status: input.trial ? "TRIAL" : "ACTIVE",
      trialEndsAt: input.trial ? new Date(Date.now() + 30 * 86400_000) : null,
      modules: input.modules ?? ["excise"],
    },
  });
  const admin = await tx.administration.create({
    data: {
      clientId: client.id,
      legalName: input.name,
      country: input.country,
      chartTemplate: c.chart,
      ledgerLanguage: input.country === "NL" || input.country === "BE" ? "nl" : "en",
      vatNumber: input.vatNumber || null,
      exciseAuthority: c.authority,
    },
  });
  await seedAdministrationDefaults(tx, admin.id);
  return { client, administration: admin };
}

export async function seedAdministrationDefaults(tx: Tx, administrationId: string) {
  await tx.$executeRaw`SELECT set_config('app.administration_id', ${administrationId}, true)`;
  await tx.ledgerAccount.createMany({
    data: NL_CHART.map((a) => ({ administrationId, code: a.code, nameNl: a.nl, nameEn: a.en, type: a.type, system: true })),
    skipDuplicates: true,
  });
  const hasWarehouse = await tx.warehouse.count({ where: { administrationId } });
  if (!hasWarehouse) {
    await tx.warehouse.create({ data: { administrationId, name: "Main warehouse", kind: "DUTY_PAID" } });
  }
  const hasBank = await tx.bankAccount.count({ where: { administrationId } });
  if (!hasBank) await tx.bankAccount.create({ data: { administrationId, name: "Bank", accountCode: "1000" } });
}

export async function addMembership(tx: Tx, userId: string, administrationId: string, role: Role) {
  return tx.membership.upsert({
    where: { userId_administrationId: { userId, administrationId } },
    create: { userId, administrationId, role },
    update: { role },
  });
}
