"use client";
import { createContext, useContext, useMemo } from "react";
import type { Locale } from "./config";
import type { Dict } from "./types";
import { createT, type TFunction } from "./t";
import { makeFormatters, type Formatters } from "@/lib/format";

const Ctx = createContext<{ locale: Locale; t: TFunction; fmt: Formatters } | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Dict; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: createT(messages), fmt: makeFormatters(locale) }), [locale, messages]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}
