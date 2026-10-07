import "server-only";

// EU VAT number validation through the European Commission's VIES REST API.
// https://ec.europa.eu/taxation_customs/vies/#/technical-information
// VIES is often slow or partly down (per member state); callers must treat a
// failure as "not checked" and never block saving on it.

const ENDPOINT = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const TIMEOUT_MS = 8_000;

/** Countries VIES covers (ISO codes; Greece is "EL" in VIES, Northern Ireland "XI"). */
export const VIES_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV",
  "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "XI",
]);

export type ViesResult =
  | { ok: true; valid: boolean; name: string | null; checkedAt: Date }
  | { ok: false; error: "unsupported" | "unavailable" | "format" };

function viesCountry(iso: string) {
  return iso === "GR" ? "EL" : iso;
}

/** "NL 0012.34567.B01" → "001234567B01" (country prefix removed). */
export function normaliseVatNumber(country: string, vat: string): string {
  let s = vat.replace(/[\s.\-]/g, "").toUpperCase();
  const prefixes = [country.toUpperCase(), viesCountry(country.toUpperCase())];
  for (const p of prefixes) if (s.startsWith(p)) { s = s.slice(p.length); break; }
  return s;
}

export async function checkVies(country: string, vatNumber: string): Promise<ViesResult> {
  const cc = country.toUpperCase();
  if (!VIES_COUNTRIES.has(cc)) return { ok: false, error: "unsupported" };
  const number = normaliseVatNumber(cc, vatNumber);
  if (!/^[0-9A-Z+*]{2,14}$/.test(number)) return { ok: false, error: "format" };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ countryCode: viesCountry(cc), vatNumber: number }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: "unavailable" };
    const body = (await res.json()) as { valid?: unknown; name?: unknown };
    if (typeof body.valid !== "boolean") return { ok: false, error: "unavailable" };
    const name = typeof body.name === "string" && body.name.trim() && body.name.trim() !== "---" ? body.name.trim() : null;
    return { ok: true, valid: body.valid, name, checkedAt: new Date() };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
