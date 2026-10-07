import "server-only";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { decrypt, encrypt } from "../crypto";

authenticator.options = { window: 1, step: 30, digits: 6 };

export function newTotpSecret(): string {
  return authenticator.generateSecret(20);
}

export async function totpEnrollment(email: string, secret: string) {
  const uri = authenticator.keyuri(email, "Liquid Ledger", secret);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: "#14171f", light: "#ffffff" } });
  return { uri, qr, secret: secret.replace(/(.{4})/g, "$1 ").trim() };
}

/**
 * Verify a TOTP code. Returns the matched time-step (for replay protection)
 * or null. Pass `lastStep` to reject a code that was already used.
 */
export function verifyTotp(secret: string, code: string, lastStep?: number | null): number | null {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) return null;
  const delta = authenticator.checkDelta(clean, secret);
  if (delta === null) return null;
  const step = Math.floor(Date.now() / 30_000) + delta;
  if (lastStep != null && step <= lastStep) return null;
  return step;
}

export const sealSecret = (secret: string) => encrypt(secret);
export const openSecret = (sealed: string) => decrypt(sealed);
