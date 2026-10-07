import { Logo } from "@/components/logo";
import { getI18n } from "@/i18n/server";

/** Dark frame for the admin sign-in, set-up and 403 screens. */
export async function AuthFrame({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  return (
    <div style={{ minHeight: "100vh", background: "#1c1216", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px" }}>
      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px" }}>
          <Logo size={32} inverted />
          <div className="wordmark" style={{ fontSize: 21, color: "#fff" }}>Liquid Ledger</div>
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, background: "#7a1f3d", color: "#fff" }}>
            {t("admin.badge")}
          </span>
        </div>
        <div style={{ background: "#fff", borderRadius: 14, padding: "28px 28px 26px", boxShadow: "0 24px 60px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", gap: 18 }}>{children}</div>
        <div style={{ fontSize: 12.5, color: "#b9a6ae", textAlign: "center" }}>{t("admin.auth.footer")}</div>
      </div>
    </div>
  );
}
