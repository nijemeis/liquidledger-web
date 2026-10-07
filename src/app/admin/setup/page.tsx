import type { Metadata } from "next";
import { findStaffSetupToken } from "@/lib/auth/staff-flow";
import { getI18n } from "@/i18n/server";
import { Icon } from "@/components/icon";
import { AuthFrame } from "../auth-frame";
import { StaffSetup } from "./staff-setup";

export const metadata: Metadata = { title: "Set up access", referrer: "no-referrer" };

export default async function AdminSetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const { t } = await getI18n();
  const state = await findStaffSetupToken(token);
  if (!state.ok) {
    return (
      <AuthFrame>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "#fff3dc", color: "#9a5b00", display: "grid", placeItems: "center" }}>
            <Icon name="Warning" size={26} />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>{t(`admin.setup.bad.${state.reason}.title`)}</h1>
          <p style={{ margin: 0, color: "#5b6474" }}>{t(`admin.setup.bad.${state.reason}.text`)}</p>
          <a href="/admin/login" className="btn" style={{ alignSelf: "flex-start", marginTop: 4 }}>
            <Icon name="ArrowLeft" />
            {t("admin.setup.toLogin")}
          </a>
        </div>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame>
      <StaffSetup token={token} name={state.staff.name} email={state.staff.email} role={t(`admin.staffRole.${state.staff.role}`)} />
    </AuthFrame>
  );
}
