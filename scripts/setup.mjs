// One-time local setup:  npm run setup
// Creates .env (with a fresh encryption key), checks the database, applies the
// migrations and loads the demo company. Safe to run again: it never
// overwrites an existing .env, and re-running reloads the demo data.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import net from "node:net";

const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
const step = (s) => console.log(`\n\x1b[35m▸ ${s}\x1b[0m`);

// 1. .env
if (!existsSync(".env")) {
  step("Creating .env");
  const key = randomBytes(32).toString("base64");
  const env = readFileSync(".env.example", "utf8").replace(/^APP_ENCRYPTION_KEY=.*$/m, `APP_ENCRYPTION_KEY="${key}"`);
  writeFileSync(".env", env);
  console.log("  .env written with a new APP_ENCRYPTION_KEY");
} else {
  step(".env already exists — keeping it");
}
const dotenv = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const dbUrl = process.env.DATABASE_URL ?? dotenv.DATABASE_URL;
if (!dotenv.APP_ENCRYPTION_KEY) {
  console.error("\nAPP_ENCRYPTION_KEY is empty in .env. Set it to the output of: openssl rand -base64 32");
  process.exit(1);
}

// 2. Database reachable?
step("Checking the database");
const { hostname, port } = new URL(dbUrl);
const reachable = await new Promise((resolve) => {
  const s = net.connect({ host: hostname, port: Number(port || 5432) }, () => (s.end(), resolve(true)));
  s.on("error", () => resolve(false));
  s.setTimeout(3000, () => (s.destroy(), resolve(false)));
});
if (!reachable) {
  console.error(`\n  Can't reach PostgreSQL at ${hostname}:${port || 5432}.`);
  console.error("  Start it with:  docker compose up -d   (needs Docker Desktop running)");
  console.error("  …then run  npm run setup  again.\n");
  process.exit(1);
}
console.log(`  PostgreSQL is listening on ${hostname}:${port || 5432}`);

// 3. Migrations + demo data
step("Applying database migrations");
run("npx prisma migrate deploy");
run("npx prisma generate");
step("Loading the demo company (Vale & Hart Drinks B.V.)");
run("npx tsx --env-file=.env prisma/seed.ts");

console.log(`\x1b[32m
Done. Start the app with:   npm run dev
Then open http://localhost:3000 and sign in as marta@valehart.nl / wijnkelder-2026.
For the 6-digit code, run in a second terminal:   npm run dev:code
\x1b[0m`);
