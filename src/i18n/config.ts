export const LOCALES = ["nl", "en", "fr", "de", "it", "es", "pl"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_NAMES: Record<Locale, string> = {
  nl: "Nederlands",
  en: "English",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  es: "Español",
  pl: "Polski",
};

/** BCP-47 tag used for number and date formatting. */
export const INTL_LOCALE: Record<Locale, string> = {
  nl: "nl-NL",
  en: "en-GB",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  es: "es-ES",
  pl: "pl-PL",
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}
