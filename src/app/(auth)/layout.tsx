import Link from "next/link";
import { getI18n } from "@/i18n/server";
import { pickMessages } from "@/i18n/messages";
import { I18nProvider } from "@/i18n/client";
import { Logo } from "@/components/logo";
import { Icon, type IconName } from "@/components/icon";
import { ToastProvider } from "@/components/client";
import { AuthLanguage } from "./language";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getI18n();
  const kinds: [IconName, string][] = [
    ["Wine", t("auth.wine")],
    ["BeerStein", t("auth.beer")],
    ["Brandy", t("auth.spirits")],
    ["Drop", t("auth.water")],
    ["PintGlass", t("auth.soft")],
  ];
  return (
    <I18nProvider locale={locale} messages={pickMessages(locale, ["auth", "common"])}>
      <ToastProvider>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,460px),1fr))", minHeight: "100vh", background: "#fff" }}>
          <div style={{ position: "relative", minHeight: 340, overflow: "hidden", background: "radial-gradient(120% 90% at 85% 100%,#9a2e52 0%,#7a1f3d 45%,#4a1023 100%)", color: "#fff" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/login-visual.webp" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(180deg,rgba(60,10,28,0.55) 0%,rgba(60,10,28,0.15) 38%,rgba(60,10,28,0.25) 60%,rgba(50,8,22,0.88) 100%)" }} />
            <svg viewBox="0 0 48 48" width="560" height="560" aria-hidden="true" style={{ position: "absolute", right: -170, bottom: -190, opacity: 0.1, pointerEvents: "none" }}>
              <defs>
                <clipPath id="ll-bg">
                  <circle cx="24" cy="24" r="12" />
                </clipPath>
              </defs>
              <circle cx="24" cy="24" r="22" fill="none" stroke="#fff" strokeWidth="1" />
              <circle cx="24" cy="24" r="14" fill="none" stroke="#fff" strokeWidth="1.4" />
              <g clipPath="url(#ll-bg)" stroke="#fff" strokeWidth="0.8">
                <path d="M16 10V38M20 10V38M24 10V38M28 10V38M32 10V38" />
              </g>
              <circle cx="24" cy="30" r="2.6" fill="#fff" />
            </svg>
            <div style={{ position: "relative", height: "100%", minHeight: 340, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 40, padding: "36px 44px 44px", pointerEvents: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Logo size={42} inverted />
                <div className="wordmark" style={{ fontSize: 30, color: "#fff" }}>Liquid Ledger</div>
              </div>
              <div style={{ maxWidth: 520 }}>
                <div className="wordmark" style={{ fontSize: 54, lineHeight: 1.02, letterSpacing: "-0.005em", color: "#fff", whiteSpace: "normal", textWrap: "balance" }}>From cask to cash.</div>
                <div style={{ fontSize: 17, lineHeight: 1.5, marginTop: 14, color: "#fbeef2", maxWidth: "44ch" }}>{t("auth.lede")}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 22 }}>
                  {kinds.map(([icon, label]) => (
                    <span key={icon} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 999, background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.22)", fontSize: 13, color: "#fff", backdropFilter: "blur(6px)" }}>
                      <Icon name={icon} size={15} />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", padding: "24px 32px" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", position: "relative" }}>
              <AuthLanguage locale={locale} label={t("auth.lang")} />
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 0" }}>
              <div style={{ width: "100%", maxWidth: 392, display: "flex", flexDirection: "column", gap: 22 }}>{children}</div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, fontSize: 12.5, color: "#8a93a3" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="LockSimple" size={14} color="#7a1f3d" />
                {t("auth.secure")}
              </span>
              <span style={{ display: "flex", gap: 14 }}>
                <Link href="/privacy" style={{ color: "#5b6474" }}>{t("auth.privacy")}</Link>
                <Link href="/terms" style={{ color: "#5b6474" }}>{t("auth.terms")}</Link>
                <span>© {new Date().getFullYear()} Liquid Ledger</span>
              </span>
            </div>
          </div>
        </div>
      </ToastProvider>
    </I18nProvider>
  );
}
