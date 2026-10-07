import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";

export const metadata: Metadata = { title: "Terms" };

const SECTIONS = ["service", "account", "trial", "fees", "data", "tax", "availability", "liability", "end", "law"] as const;

export default async function TermsPage() {
  const { t } = await getI18n();
  return (
    <>
      <h1>{t("settings.legal.termsTitle")}</h1>
      <p className="muted" style={{ margin: 0 }}>{t("settings.legal.updated", { date: "7 October 2026" })}</p>
      {SECTIONS.map((s) => (
        <section key={s}>
          <h2>{t(`settings.legal.terms.${s}.h`)}</h2>
          <p>{t(`settings.legal.terms.${s}.p`)}</p>
        </section>
      ))}
    </>
  );
}
