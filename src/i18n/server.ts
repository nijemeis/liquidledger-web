import "server-only";
import { cookies, headers } from "next/headers";
import { getUserSession } from "@/lib/auth/session";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";
import { getMessages } from "./messages";
import { createT } from "./t";
import { makeFormatters } from "@/lib/format";

export const LANG_COOKIE = "ll_lang";

/** Signed-in user's language, else the language cookie, else the browser's. */
export async function getLocale(): Promise<Locale> {
  const s = await getUserSession();
  if (s && isLocale(s.user.locale)) return s.user.locale;
  const c = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLocale(c)) return c;
  const accept = (await headers()).get("accept-language") ?? "";
  for (const part of accept.split(",")) {
    const code = part.split(";")[0]!.trim().slice(0, 2).toLowerCase();
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}

export async function getI18n(locale?: Locale) {
  const l = locale ?? (await getLocale());
  const messages = getMessages(l);
  return { locale: l, messages, t: createT(messages), fmt: makeFormatters(l) };
}
