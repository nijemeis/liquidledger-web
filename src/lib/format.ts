import { INTL_LOCALE, type Locale } from "@/i18n/config";

const MINUS = "−";

/**
 * Locale-aware formatting. Money is passed as integer cents.
 * en → €1,234.56 · nl → € 1.234,56 · fr → 1 234,56 €
 */
export function makeFormatters(locale: Locale) {
  const tag = INTL_LOCALE[locale];
  const moneyCache = new Map<string, Intl.NumberFormat>();
  const nf = (currency: string, decimals: number) => {
    const k = `${currency}:${decimals}`;
    let f = moneyCache.get(k);
    if (!f) {
      f = new Intl.NumberFormat(tag, { style: "currency", currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      moneyCache.set(k, f);
    }
    return f;
  };
  const intF = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const dec = (d: number) => new Intl.NumberFormat(tag, { minimumFractionDigits: d, maximumFractionDigits: d });
  const dateLong = new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
  const dateShort = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" });
  const dateMed = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const monthShort = new Intl.DateTimeFormat(tag, { month: "short", timeZone: "UTC" });
  const monthLong = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" });
  const time = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
  const dateTime = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });

  return {
    locale,
    /** €1,234.56 from cents. `decimals` 0 rounds to whole units. */
    money(cents: number, opts: { currency?: string; decimals?: number; sign?: boolean } = {}) {
      const { currency = "EUR", decimals = 2, sign = false } = opts;
      const v = Math.abs(cents) / 100;
      const s = nf(currency, decimals).format(decimals === 0 ? Math.round(v) : v);
      if (cents < 0) return MINUS + s;
      return sign && cents > 0 ? "+" + s : s;
    },
    int(n: number) {
      const s = intF.format(Math.abs(Math.round(n)));
      return n < 0 ? MINUS + s : s;
    },
    num(n: number, decimals: number) {
      return dec(decimals).format(n);
    },
    pct(bp: number) {
      return dec(bp % 100 === 0 ? 0 : bp % 10 === 0 ? 1 : 2).format(bp / 100) + "%";
    },
    dateLong: (d: Date) => dateLong.format(d),
    date: (d: Date) => fixSept(dateShort.format(d)),
    dateMed: (d: Date) => fixSept(dateMed.format(d)),
    month: (d: Date) => fixSept(monthShort.format(d)),
    monthLong: (d: Date) => monthLong.format(d),
    time: (d: Date) => time.format(d),
    dateTime: (d: Date) => dateTime.format(d),
  };
}

/** en-GB abbreviates September as "Sept"; the design uses "Sep". */
function fixSept(s: string) {
  return s.replace(/\bSept\b/, "Sep");
}

export type Formatters = ReturnType<typeof makeFormatters>;

/** Parse "1.234,56" / "1,234.56" / "12.5" into cents. Returns null when not a number. */
export function parseMoney(input: string): number | null {
  let s = input.trim().replace(/[€$£\s]/g, "");
  if (!s) return null;
  const neg = s.startsWith("-") || s.startsWith(MINUS);
  s = s.replace(/^[-−]/, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return neg ? -cents : cents;
}

export function initials(name: string): string {
  return name
    .replace(/[^\p{L} ]/gu, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
