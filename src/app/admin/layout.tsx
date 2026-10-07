import type { Metadata } from "next";
import { getI18n } from "@/i18n/server";
import { pickMessages } from "@/i18n/messages";
import { I18nProvider } from "@/i18n/client";
import { ToastProvider } from "@/components/client";
import { adminIpAllowed } from "@/lib/admin/staff";
import { AuthFrame } from "./auth-frame";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Platform admin", template: "%s · Platform admin" } };

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getI18n();
  const ip = await adminIpAllowed();
  if (!ip.allowed) {
    // IP allow-list (Security policies): nothing of the console is served.
    return (
      <AuthFrame>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "#fdebea", color: "#b42318", display: "grid", placeItems: "center" }}>
            <Icon name="Prohibit" size={26} />
          </div>
          <div style={{ fontSize: 13, color: "#b42318", fontWeight: 600 }}>403</div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>{t("admin.ip.title")}</h1>
          <p style={{ margin: 0, color: "#5b6474" }}>{t("admin.ip.text", { ip: ip.ip ?? "unknown" })}</p>
        </div>
      </AuthFrame>
    );
  }
  return (
    <I18nProvider locale={locale} messages={pickMessages(locale, ["admin", "common"])}>
      <ToastProvider>{children}</ToastProvider>
    </I18nProvider>
  );
}
