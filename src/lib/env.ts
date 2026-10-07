import "server-only";

function req(name: string, fallback?: string): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

export const isProd = process.env.NODE_ENV === "production";

export const env = {
  get appUrl() {
    return req("APP_URL", "http://localhost:3000").replace(/\/$/, "");
  },
  /** Base URL of the platform admin console (e.g. https://admin.liquidledger.net). */
  get adminUrl() {
    return req("ADMIN_URL", `${this.appUrl}/admin`).replace(/\/$/, "");
  },
  /** Hostname that serves the admin console in production (e.g. admin.liquidledger.net). */
  get adminHost() {
    return process.env.ADMIN_HOST?.trim() || null;
  },
  get encryptionKey() {
    return req("APP_ENCRYPTION_KEY");
  },
  get rpId() {
    return req("WEBAUTHN_RP_ID", "localhost");
  },
  get rpName() {
    return req("WEBAUTHN_RP_NAME", "Liquid Ledger");
  },
  /** Origins allowed to complete WebAuthn ceremonies. */
  get webauthnOrigins() {
    const list = process.env.WEBAUTHN_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean);
    if (list?.length) return list;
    const origins = [new URL(this.appUrl).origin];
    try {
      origins.push(new URL(this.adminUrl).origin);
    } catch {}
    return [...new Set(origins)];
  },
  /** Header holding the real client IP behind the load balancer (e.g. do-connecting-ip, cf-connecting-ip). */
  get trustedIpHeader() {
    return process.env.TRUSTED_IP_HEADER?.trim().toLowerCase() || "x-forwarded-for";
  },
};
