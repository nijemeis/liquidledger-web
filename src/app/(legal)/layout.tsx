import Link from "next/link";
import { getI18n } from "@/i18n/server";
import { Logo } from "@/components/logo";
import { Icon } from "@/components/icon";

export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f8" }}>
      <header style={{ background: "#fff", borderBottom: "1px solid #e4e7ec" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <Logo size={32} />
            <span className="wordmark" style={{ fontSize: 22, color: "#7a1f3d" }}>Liquid Ledger</span>
          </Link>
          <span style={{ flex: 1 }} />
          <Link href="/privacy" style={{ fontSize: 13.5 }}>{t("settings.legal.privacyTitle")}</Link>
          <Link href="/terms" style={{ fontSize: 13.5 }}>{t("settings.legal.termsTitle")}</Link>
        </div>
      </header>
      <main style={{ maxWidth: 820, margin: "0 auto", padding: "28px 20px 64px" }}>
        <div className="banner banner-warn" style={{ marginBottom: 18 }}>
          <Icon name="Warning" size={17} />
          <span>
            <b>{t("settings.legal.draft")}</b> {t("settings.legal.draftText")}
          </span>
        </div>
        <article className="card card-pad legal" style={{ padding: "28px 32px" }}>
          {children}
        </article>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 18, fontSize: 12.5, color: "#8a93a3" }}>
          <span>© {new Date().getFullYear()} Liquid Ledger</span>
          <Link href="/login" style={{ color: "#5b6474" }}>{t("auth.backToSignIn")}</Link>
        </div>
      </main>
      <style>{`.legal h1{font-size:24px;font-weight:600;letter-spacing:-.015em;margin:0 0 4px}.legal h2{font-size:16px;font-weight:600;margin:22px 0 6px}.legal p,.legal li{font-size:14px;color:#3a4250;line-height:1.6}.legal ul{padding-left:20px}`}</style>
    </div>
  );
}
