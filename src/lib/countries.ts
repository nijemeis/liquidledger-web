import { EU } from "./domain/vat";

// ISO 3166-1 alpha-2 codes offered in country pickers (EU first, then the rest).
const OTHER = [
  "GB", "CH", "NO", "IS", "US", "CA", "MX", "BR", "AR", "CL", "PE", "UY", "ZA", "NG", "GH", "KE", "MA", "EG",
  "TR", "IL", "AE", "SA", "IN", "CN", "JP", "KR", "SG", "HK", "TW", "TH", "VN", "AU", "NZ", "GE", "AM", "UA", "MD", "RS", "BA", "ME", "MK", "AL",
];

export const COUNTRY_CODES = [...[...EU].sort(), ...OTHER];

export function flag(code: string): string {
  const c = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale === "en" ? "en-GB" : locale], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** ISO 13616 IBAN check (mod 97). */
export function validIban(iban: string): boolean {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}
