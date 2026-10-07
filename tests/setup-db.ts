import { execSync } from "node:child_process";

/** Migrate the test database once before the run (it must exist; CI creates it). */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://liquidledger:liquidledger@localhost:5432/liquidledger_test";
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url } });
}
