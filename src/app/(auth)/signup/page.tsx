import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { getUserSession } from "@/lib/auth/session";
import { COUNTRIES } from "@/lib/domain/setup";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Start a free trial" };

export default async function SignupPage() {
  if (await getUserSession()) redirect("/dashboard");
  const { locale } = await getI18n();
  const names = new Intl.DisplayNames([INTL_LOCALE[locale]], { type: "region" });
  const countries = Object.entries(COUNTRIES).map(([code, c]) => ({ code, label: `${c.flag}  ${names.of(code) ?? c.name}` }));
  const preferred = { nl: "NL", fr: "FR", de: "DE", it: "IT", es: "ES", pl: "PL", en: "NL" }[locale] ?? "NL";
  return <SignupForm countries={countries} defaultCountry={preferred} />;
}
