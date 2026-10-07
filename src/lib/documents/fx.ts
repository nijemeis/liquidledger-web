// ECB euro foreign exchange reference rates (daily, ~16:00 CET), cached per day.
// Rates are "1 EUR = x CUR"; we store the inverse on documents ("1 CUR = y EUR").

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

type EcbDay = { date: string; rates: Record<string, number> };
let cache: { fetchedOn: string; day: EcbDay } | null = null;

export function parseEcbXml(xml: string): EcbDay | null {
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) return null;
  const rates: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]!] = Number(m[2]);
  return { date, rates };
}

async function ecbDay(): Promise<EcbDay | null> {
  const today = new Date().toISOString().slice(0, 10);
  if (cache?.fetchedOn === today) return cache.day;
  try {
    const res = await fetch(ECB_URL, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!res.ok) return cache?.day ?? null;
    const day = parseEcbXml(await res.text());
    if (!day) return cache?.day ?? null;
    cache = { fetchedOn: today, day };
    return day;
  } catch {
    return cache?.day ?? null;
  }
}

/** EUR value of 1 unit of `currency` from the latest ECB reference rates, or null when unavailable. */
export async function ecbRate(currency: string): Promise<{ rate: number; date: Date } | null> {
  const cur = currency.toUpperCase();
  if (cur === "EUR") return { rate: 1, date: new Date() };
  const day = await ecbDay();
  const perEur = day?.rates[cur];
  if (!day || !perEur) return null;
  return { rate: Math.round((1 / perEur) * 1e8) / 1e8, date: new Date(`${day.date}T00:00:00Z`) };
}
