/* eslint-disable no-console */
// Development helper: prints the current authenticator code for a demo user,
// so you can sign in locally without setting up an authenticator app.
//   npm run dev:code                 (marta@valehart.nl)
//   npm run dev:code -- joost@valehart.nl
// Refuses to run in production.
import { PrismaClient } from "@prisma/client";
import { createDecipheriv } from "node:crypto";
import { authenticator } from "otplib";

if (process.env.NODE_ENV === "production") {
  console.error("dev:code is for local development only.");
  process.exit(1);
}

const email = (process.argv[2] ?? "marta@valehart.nl").toLowerCase();

function open(sealed: string): string {
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY ?? "", "base64");
  const [, iv, tag, ct] = sealed.split(".");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv!, "base64url"));
  d.setAuthTag(Buffer.from(tag!, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct!, "base64url")), d.final()]).toString("utf8");
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.totpSecretEnc) {
      console.error(`${email} has no authenticator app set up.`);
      process.exit(1);
    }
    const secret = open(user.totpSecretEnc);
    const left = 30 - (Math.floor(Date.now() / 1000) % 30);
    console.log(`\n  ${email}\n  Code: \x1b[1m${authenticator.generate(secret)}\x1b[0m  (valid ${left}s more)\n  Secret for an authenticator app: ${secret}\n`);
  } finally {
    await prisma.$disconnect();
  }
}
main();
