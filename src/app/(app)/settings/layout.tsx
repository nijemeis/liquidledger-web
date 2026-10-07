import { requireApp } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { canView } from "@/lib/permissions";
import { PageHead } from "@/components/ui";
import { SettingsNav, type SettingsNavItem } from "./settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireApp();
  const { t } = await getI18n(ctx.locale);
  const personal = ctx.kind === "user";
  const items: SettingsNavItem[] = [
    ...(personal
      ? ([
          { href: "/settings", label: t("settings.nav.profile"), icon: "User", group: t("settings.nav.you") },
          { href: "/settings/security", label: t("settings.nav.security"), icon: "ShieldCheck", group: t("settings.nav.you") },
        ] as SettingsNavItem[])
      : []),
    ...(canView(ctx.role, "users") ? ([{ href: "/settings/users", label: t("settings.nav.users"), icon: "Users", group: t("settings.nav.company") }] as SettingsNavItem[]) : []),
    { href: "/settings/administration", label: t("settings.nav.administration"), icon: "Buildings", group: t("settings.nav.company") },
    ...(canView(ctx.role, "purchases") ? ([{ href: "/settings/rules", label: t("settings.nav.rules"), icon: "MagicWand", group: t("settings.nav.company") }] as SettingsNavItem[]) : []),
  ];
  return (
    <>
      <PageHead eyebrow={ctx.administration.legalName} title={t("settings.title")} />
      <div className="settings-grid">
        <SettingsNav items={items} />
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
      </div>
      <style>{`.settings-grid{display:grid;grid-template-columns:212px minmax(0,1fr);gap:24px;align-items:start}
.settings-nav{position:sticky;top:76px;display:flex;flex-direction:column;gap:2px}
@media (max-width:900px){.settings-grid{grid-template-columns:minmax(0,1fr);gap:16px}.settings-nav{position:static;flex-direction:row;flex-wrap:wrap;gap:6px}.settings-nav .settings-group{display:none}}`}</style>
    </>
  );
}
