// Client-safe constants for the admin client screens (mirrors COUNTRIES/PLANS in src/lib/domain/setup.ts).
import type { Plan } from "@prisma/client";

export const COUNTRY_CODES = ["NL", "BE", "FR", "DE", "IT", "ES", "PL"] as const;
export const COUNTRY_FLAGS: Record<string, string> = { NL: "🇳🇱", BE: "🇧🇪", FR: "🇫🇷", DE: "🇩🇪", IT: "🇮🇹", ES: "🇪🇸", PL: "🇵🇱" };
export const PLAN_KEYS: Plan[] = ["STARTER", "BUSINESS", "PRO", "ENTERPRISE"];
export const VAT_EXAMPLE: Record<string, string> = { NL: "NL123456789B01", BE: "BE0123456789", FR: "FR12345678901", DE: "DE123456789", IT: "IT12345678901", ES: "ESB12345678", PL: "PL1234567890" };
/** Language the owner's invite is sent in. */
export const COUNTRY_LANGUAGE: Record<string, string> = { NL: "nl", BE: "nl", FR: "fr", DE: "de", IT: "it", ES: "es", PL: "pl" };
