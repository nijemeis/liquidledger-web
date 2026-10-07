import { prisma } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { requireStaff } from "@/lib/admin/staff";
import { level, PERMISSION_GROUPS, ROLES } from "@/lib/permissions";
import { Icon } from "@/components/icon";

const COLS = "minmax(0,1.6fr) repeat(6,minmax(90px,1fr))";
const STAFF_ROLES = ["SUPER_ADMIN", "SUPPORT", "FINANCE"] as const;

export default async function RolesPage() {
  await requireStaff();
  const { t, fmt } = await getI18n();
  const [byRole, staffByRole] = await Promise.all([
    prisma.membership.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.staffUser.groupBy({ by: ["role"], where: { status: { not: "DISABLED" } }, _count: { _all: true } }),
  ]);
  const n = (r: string) => byRole.find((x) => x.role === r)?._count._all ?? 0;
  const sn = (r: string) => staffByRole.find((x) => x.role === r)?._count._all ?? 0;

  const cell = (lv: "F" | "V" | "N", label: string) =>
    lv === "F" ? (
      <Icon name="CheckCircle" weight="fill" size={18} color="#157347" />
    ) : lv === "V" ? (
      <Icon name="Eye" size={18} color="#1f4f8f" />
    ) : (
      <Icon name="Minus" size={18} color="#c4cbd6" />
    );

  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: "#5b6474" }}>{t("admin.roles.eyebrow")}</div>
        <h1 style={{ margin: "2px 0 0", fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>{t("admin.roles.title")}</h1>
        <p style={{ margin: "6px 0 0", color: "#5b6474", maxWidth: "70ch" }}>{t("admin.roles.lede")}</p>
      </div>
      <div className="card card-clip">
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 940 }}>
            <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "12px 16px", fontSize: 12, fontWeight: 600, color: "#3a4250", background: "#f9fafb", borderBottom: "1px solid #e4e7ec" }}>
              <div style={{ color: "#5b6474", fontWeight: 500 }}>{t("admin.roles.permission")}</div>
              {ROLES.map((r) => (
                <div key={r} style={{ textAlign: "center" }}>
                  {t(`admin.role.${r}`)}
                  <div style={{ fontWeight: 400, color: "#8a93a3", fontSize: 11.5 }}>{t("admin.roles.users", { n: fmt.int(n(r)) })}</div>
                </div>
              ))}
            </div>
            {PERMISSION_GROUPS.map((g) => (
              <div key={g.group}>
                <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "9px 16px", fontSize: 13.5, borderBottom: "1px solid #eef0f3", background: "#f9fafb" }}>
                  <div style={{ fontWeight: 600, color: "#5b6474" }}>{t(`admin.roles.group.${g.group}`)}</div>
                </div>
                {g.items.map((p) => (
                  <div key={p} style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "9px 16px", alignItems: "center", fontSize: 13.5, borderBottom: "1px solid #eef0f3", background: "#fff" }}>
                    <div>{t(`admin.roles.perm.${p}`)}</div>
                    {ROLES.map((r) => {
                      const lv = level(r, p);
                      return (
                        <div key={r} style={{ textAlign: "center", display: "grid", placeItems: "center" }} title={t(`admin.roles.level.${lv}`)} aria-label={t(`admin.roles.level.${lv}`)}>
                          {cell(lv, t(`admin.roles.level.${lv}`))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "12px 16px", fontSize: 12.5, color: "#5b6474" }}>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Icon name="CheckCircle" weight="fill" size={16} color="#157347" />
            {t("admin.roles.level.F")}
          </span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Icon name="Eye" size={16} color="#1f4f8f" />
            {t("admin.roles.level.V")}
          </span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Icon name="Minus" size={16} color="#c4cbd6" />
            {t("admin.roles.level.N")}
          </span>
        </div>
      </div>

      <div className="card card-clip" style={{ marginTop: 14 }}>
        <div style={{ padding: "14px 16px", fontWeight: 600, fontSize: 15, borderBottom: "1px solid #e4e7ec" }}>{t("admin.roles.staffTitle")}</div>
        {STAFF_ROLES.map((r) => (
          <div key={r} style={{ display: "grid", gridTemplateColumns: "180px minmax(0,1fr) 90px", gap: 12, padding: "11px 16px", alignItems: "center", fontSize: 13.5, borderBottom: "1px solid #eef0f3" }}>
            <div>
              <span style={{ fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 6, background: "#f9eef2", color: "#7a1f3d" }}>{t(`admin.staffRole.${r}`)}</span>
            </div>
            <div style={{ color: "#3a4250" }}>{t(`admin.staffRoleDesc.${r}`)}</div>
            <div className="n" style={{ textAlign: "right", color: "#5b6474" }}>{t("admin.roles.staffCount", { n: sn(r) })}</div>
          </div>
        ))}
      </div>
    </>
  );
}
