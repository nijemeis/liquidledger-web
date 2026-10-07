"use server";
import { cookies } from "next/headers";
import { isLocale } from "@/i18n/config";
import { LANG_COOKIE } from "@/i18n/server";

export async function setLanguageCookie(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LANG_COOKIE, locale, { path: "/", maxAge: 365 * 86400, sameSite: "lax", httpOnly: false });
}
