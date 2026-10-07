import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireApp } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { initials } from "@/lib/format";
import { ProfileForm, SidebarReset } from "./profile-form";

export const metadata: Metadata = { title: "Settings" };

export default async function ProfilePage() {
  const ctx = await requireApp();
  if (!ctx.user) redirect("/settings/administration");
  const { t, fmt } = await getI18n(ctx.locale);
  const pref = (await cookies()).get("ll_sidebar")?.value;
  const u = ctx.user;
  return (
    <>
      <section className="card card-pad">
        <div className="card-head" style={{ marginBottom: 4 }}>
          <div className="card-title">{t("settings.profile.title")}</div>
        </div>
        <p className="muted" style={{ margin: "0 0 16px", fontSize: 13.5 }}>{t("settings.profile.text")}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div className="avatar" style={{ width: 52, height: 52, fontSize: 18 }}>{initials(u.name)}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{u.name}</div>
            <div className="muted truncate" style={{ fontSize: 13 }}>
              {u.email} · {t("settings.profile.memberSince", { date: fmt.dateMed(u.createdAt) })}
            </div>
          </div>
        </div>
        <ProfileForm name={u.name} email={u.email} locale={ctx.locale} locales={LOCALES.map((l) => ({ code: l, label: LOCALE_NAMES[l] }))} />
      </section>

      <section className="card card-pad">
        <div className="card-title" style={{ marginBottom: 4 }}>{t("settings.profile.interface")}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13.5 }}>
            <div style={{ fontWeight: 500 }}>{t("settings.profile.sidebar")}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {pref === "closed" ? t("settings.profile.sidebarClosed") : pref === "open" ? t("settings.profile.sidebarOpen") : t("settings.profile.sidebarAuto")}
            </div>
          </div>
          <SidebarReset disabled={!pref} />
        </div>
      </section>

      <section className="card card-clip">
        <div className="card-pad" style={{ paddingBottom: 10 }}>
          <div className="card-title">{t("settings.profile.memberships")}</div>
          <div className="muted" style={{ fontSize: 13 }}>{t("settings.profile.membershipsText")}</div>
        </div>
        <div className="tbl">
          {ctx.memberships.map((m) => (
            <div key={m.administrationId} className="tbl-row" style={{ gridTemplateColumns: "32px minmax(0,1fr) auto", minWidth: 360 }}>
              <div className="tile" style={{ background: "#fcf5f7", color: "#7a1f3d", fontSize: 12, fontWeight: 700 }}>{initials(m.legalName)}</div>
              <div className="cell-main truncate">
                {m.legalName}
                {m.administrationId === ctx.administration.id ? <span className="muted" style={{ fontWeight: 400 }}> · {t("settings.profile.current")}</span> : null}
              </div>
              <span className="pill pill-wine">{t(`settings.role.${m.role}`)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
