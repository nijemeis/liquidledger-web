// Node-only startup checks (imported from instrumentation.ts).
import { prisma } from "./lib/db";

export async function startupChecks() {
  try {
    // Row-level security is only a guarantee if the app's database role can't bypass it.
    const rows = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    const r = rows[0];
    if (r && (r.rolsuper || r.rolbypassrls)) {
      const msg = "[security] The database role can bypass row-level security (superuser or BYPASSRLS). Connect as a dedicated non-superuser role.";
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_RLS_BYPASS_ROLE !== "1") {
        console.error(msg + " Refusing to start.");
        process.exit(1);
      }
      console.warn(msg);
    }
    for (const name of ["APP_ENCRYPTION_KEY", "APP_URL", "WEBAUTHN_RP_ID"]) {
      if (!process.env[name]) console.warn(`[config] ${name} is not set.`);
    }
  } catch (e) {
    console.error("[startup] database check failed", e);
  }
}
