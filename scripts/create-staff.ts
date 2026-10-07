/* eslint-disable no-console */
// Create a platform staff member and print a one-time set-up link (password + passkey).
//   npm run staff:create -- --email you@liquidledger.net --name "Your Name" --role SUPER_ADMIN
// Re-running for an existing email issues a fresh set-up link (e.g. after losing a passkey).
import { PrismaClient, type StaffRole } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const role = (arg("role") ?? "SUPER_ADMIN").toUpperCase() as StaffRole;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("--email is required");
  if (!["SUPER_ADMIN", "SUPPORT", "FINANCE"].includes(role)) throw new Error("--role must be SUPER_ADMIN, SUPPORT or FINANCE");
  const prisma = new PrismaClient();
  try {
    const staff = await prisma.staffUser.upsert({
      where: { email },
      create: { email, name: name ?? email.split("@")[0]!, role, status: "INVITED" },
      update: { ...(name ? { name } : {}), role },
    });
    const token = randomBytes(32).toString("base64url");
    await prisma.emailToken.updateMany({ where: { staffId: staff.id, purpose: "STAFF_SETUP", usedAt: null }, data: { usedAt: new Date() } });
    await prisma.emailToken.create({
      data: { staffId: staff.id, purpose: "STAFF_SETUP", tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 48 * 3600_000) },
    });
    await prisma.auditEvent.create({
      data: { actorType: "SYSTEM", actorLabel: "CLI", action: "staff.setup_link", summary: `Set-up link issued for ${email} (${role})` },
    });
    const base = (process.env.ADMIN_URL ?? "http://localhost:3000/admin").replace(/\/$/, "");
    console.log(`\nStaff member ${staff.name} <${email}> · ${role}`);
    console.log(`Set-up link (valid 48 hours, single use):\n  ${base}/setup?token=${token}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
