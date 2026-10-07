import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";

export const metadata: Metadata = { title: "Privacy" };

const SECTIONS = ["who", "data", "why", "where", "keep", "share", "rights", "security", "contact"] as const;

export default async function PrivacyPage() {
  const { t } = await getI18n();
  return (
    <>
      <h1>{t("settings.legal.privacyTitle")}</h1>
      <p className="muted" style={{ margin: 0 }}>{t("settings.legal.updated", { date: "7 October 2026" })}</p>
      {SECTIONS.map((s) => (
        <section key={s}>
          <h2>{t(`settings.legal.privacy.${s}.h`)}</h2>
          <p>{t(`settings.legal.privacy.${s}.p`)}</p>
        </section>
      ))}
    </>
  );
}
