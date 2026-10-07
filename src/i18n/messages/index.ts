import type { Locale } from "../config";
import type { Dict } from "../types";
import { deepMerge } from "../t";
import common from "./common";
import auth from "./auth";
import dashboard from "./dashboard";
import bank from "./bank";
import sales from "./sales";
import purchases from "./purchases";
import costs from "./costs";
import relations from "./relations";
import products from "./products";
import stock from "./stock";
import excise from "./excise";
import shipments from "./shipments";
import vat from "./vat";
import ledger from "./ledger";
import reports from "./reports";
import settings from "./settings";
import admin from "./admin";

const namespaces = { common, auth, dashboard, bank, sales, purchases, costs, relations, products, stock, excise, shipments, vat, ledger, reports, settings, admin };

const cache = new Map<Locale, Dict>();

/** All messages for a locale, with English filling any gaps. */
export function getMessages(locale: Locale): Dict {
  const hit = cache.get(locale);
  if (hit) return hit;
  const out: Dict = {};
  for (const [name, n] of Object.entries(namespaces)) {
    const en = n.en as Dict;
    out[name] = locale === "en" ? en : deepMerge(en, (n as Record<string, unknown>)[locale] as Dict | undefined);
  }
  cache.set(locale, out);
  return out;
}

/** Only the namespaces a client component tree needs (keeps the payload small). */
export function pickMessages(locale: Locale, names: (keyof typeof namespaces)[]): Dict {
  const all = getMessages(locale);
  const out: Dict = {};
  for (const n of names) out[n] = all[n]!;
  return out;
}

export type NamespaceName = keyof typeof namespaces;
