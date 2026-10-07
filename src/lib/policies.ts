import "server-only";
import { prisma } from "./db";

export interface SecurityPolicies {
  enforce2fa: true; // locked on
  staffPasskey: true; // locked on
  trust30: boolean;
  newDevice: boolean;
  ipAllow: boolean;
  ipAllowList: string[]; // CIDRs or single IPs for the admin console
  sso: boolean;
}

export const FIXED = {
  sessionIdleMinutes: 30,
  sessionAbsoluteHours: 12,
  lockoutAttempts: 5,
  lockoutMinutes: 15,
  trustDays: 30,
  supportSessionMinutes: 60,
  dataRegion: "EU · Frankfurt",
} as const;

const DEFAULTS: SecurityPolicies = {
  enforce2fa: true,
  staffPasskey: true,
  trust30: true,
  newDevice: true,
  ipAllow: false,
  ipAllowList: [],
  sso: true,
};

let cache: { at: number; value: SecurityPolicies } | null = null;

export async function getPolicies(): Promise<SecurityPolicies> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  const row = await prisma.platformSetting.findUnique({ where: { key: "security" } });
  const stored = (row?.value ?? {}) as Partial<SecurityPolicies>;
  const value: SecurityPolicies = { ...DEFAULTS, ...stored, enforce2fa: true, staffPasskey: true };
  cache = { at: Date.now(), value };
  return value;
}

export async function setPolicies(patch: Partial<Omit<SecurityPolicies, "enforce2fa" | "staffPasskey">>, by: string) {
  const current = await getPolicies();
  const value = { ...current, ...patch, enforce2fa: true, staffPasskey: true };
  await prisma.platformSetting.upsert({
    where: { key: "security" },
    create: { key: "security", value, updatedBy: by },
    update: { value, updatedBy: by },
  });
  cache = null;
  return value;
}

/** Minimal IPv4/IPv6 allow-list check supporting exact IPs and IPv4 CIDRs. */
export function ipAllowed(ip: string | null, list: string[]): boolean {
  if (!ip) return false;
  const clean = ip.replace(/^::ffff:/, "");
  for (const entry of list) {
    const e = entry.trim();
    if (!e) continue;
    if (!e.includes("/")) {
      if (e === clean) return true;
      continue;
    }
    const [base, bitsStr] = e.split("/");
    const bits = Number(bitsStr);
    const a = toInt(base!);
    const b = toInt(clean);
    if (a === null || b === null || !(bits >= 0 && bits <= 32)) continue;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((a & mask) === (b & mask)) return true;
  }
  return false;
}

function toInt(ip: string): number | null {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return null;
  return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
}
