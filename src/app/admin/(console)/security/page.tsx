import { getI18n } from "@/i18n/server";
import { requireStaff } from "@/lib/admin/staff";
import { FIXED, getPolicies } from "@/lib/policies";
import { PolicyToggles, IpAllowList } from "./policies-client";

export default async function SecurityPage() {
  const ctx = await requireStaff("policies.write");
  const { t } = await getI18n();
  const p = await getPolicies();
  const toggles = (["enforce2fa", "staffPasskey", "trust30", "newDevice", "ipAllow", "sso"] as const).map((k) => ({
    key: k,
    title: t(`admin.security.p.${k}.title`),
    desc: t(`admin.security.p.${k}.desc`),
    on: Boolean(p[k]),
    locked: k === "enforce2fa" || k === "staffPasskey",
  }));
  const fixed: [string, string, string][] = [
    [t("admin.security.fixed.timeout.title"), t("admin.security.fixed.timeout.desc"), t("admin.security.fixed.timeout.value", { n: FIXED.sessionIdleMinutes })],
    [t("admin.security.fixed.lockout.title"), t("admin.security.fixed.lockout.desc"), t("admin.security.fixed.lockout.value", { n: FIXED.lockoutAttempts, m: FIXED.lockoutMinutes })],
    [t("admin.security.fixed.region.title"), t("admin.security.fixed.region.desc"), FIXED.dataRegion],
  ];
  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: "#5b6474" }}>{t("admin.security.eyebrow")}</div>
        <h1 style={{ margin: "2px 0 0", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>{t("admin.security.title")}</h1>
        <p style={{ margin: "6px 0 0", color: "#5b6474", maxWidth: "70ch" }}>{t("admin.security.lede")}</p>
      </div>
      <div className="card card-clip" style={{ maxWidth: 880 }}>
        <PolicyToggles items={toggles} />
        {fixed.map(([title, desc, value]) => (
          <div key={title} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 16, alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #eef0f3" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{title}</div>
              <div style={{ fontSize: 13, color: "#5b6474" }}>{desc}</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 500, padding: "6px 10px", borderRadius: 8, border: "1px solid #d5d9e0", whiteSpace: "nowrap" }}>{value}</span>
          </div>
        ))}
      </div>
      <div className="card card-pad" style={{ maxWidth: 880, marginTop: 14 }}>
        <IpAllowList initial={p.ipAllowList.join("\n")} myIp={ctx.ip} enforced={p.ipAllow} />
      </div>
    </>
  );
}
