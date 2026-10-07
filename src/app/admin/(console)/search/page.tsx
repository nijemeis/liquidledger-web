import Link from "next/link";
import { getI18n } from "@/i18n/server";
import { requireStaff } from "@/lib/admin/staff";
import { searchPlatform } from "@/lib/admin/data";
import { CLIENT_STATUS_TONE, USER_STATUS_TONE } from "@/lib/admin/format";
import { Icon } from "@/components/icon";
import { Pill } from "@/components/ui";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireStaff();
  const { q = "" } = await searchParams;
  const { t } = await getI18n();
  const r = await searchPlatform(ctx, q, 50);
  const total = r.clients.length + r.users.length + r.staff.length;
  const row = { display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: "1px solid #eef0f3", fontSize: 13.5, color: "inherit", textDecoration: "none" } as const;
  return (
    <>
      <div className="page-head" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">{t("admin.search.eyebrow")}</div>
          <h1>{t("admin.search.title", { q })}</h1>
        </div>
      </div>
      {total === 0 ? (
        <div className="card">
          <div className="empty">
            <Icon name="MagnifyingGlass" size={30} color="#8a93a3" />
            <div className="empty-title">{q.trim().length < 2 ? t("admin.search.tooShort") : t("common.emptySearch")}</div>
          </div>
        </div>
      ) : null}
      {r.clients.length ? (
        <div className="card card-clip" style={{ marginBottom: 14 }}>
          <div style={{ padding: "12px 16px", fontWeight: 600, borderBottom: "1px solid #e4e7ec" }}>{t("admin.search.clients")}</div>
          {r.clients.map((c) => (
            <Link key={c.id} href={`/admin/clients?id=${c.id}`} className="adm-row" style={row}>
              <Icon name="Buildings" size={17} color="#7a1f3d" />
              <span style={{ flex: 1, minWidth: 0 }} className="truncate">
                <b style={{ fontWeight: 600 }}>{c.name}</b> <span style={{ color: "#5b6474" }}>{c.vat ?? ""}</span>
              </span>
              <span>{c.flag}</span>
              <Pill tone={CLIENT_STATUS_TONE[c.status]}>{t(`admin.clientStatus.${c.status}`)}</Pill>
            </Link>
          ))}
        </div>
      ) : null}
      {r.users.length ? (
        <div className="card card-clip" style={{ marginBottom: 14 }}>
          <div style={{ padding: "12px 16px", fontWeight: 600, borderBottom: "1px solid #e4e7ec" }}>{t("admin.search.users")}</div>
          {r.users.map((u) => (
            <Link key={u.id} href={`/admin/users?q=${encodeURIComponent(u.email)}`} className="adm-row" style={row}>
              <Icon name="User" size={17} color="#7a1f3d" />
              <span style={{ flex: 1, minWidth: 0 }} className="truncate">
                <b style={{ fontWeight: 500 }}>{u.name}</b> <span style={{ color: "#5b6474" }}>{u.email}</span>
              </span>
              <span className="truncate" style={{ color: "#5b6474", maxWidth: 220 }}>{u.client ?? "—"}</span>
              <Pill tone={USER_STATUS_TONE[u.status] ?? "gray"}>{t(`admin.userStatus.${u.status}`)}</Pill>
            </Link>
          ))}
        </div>
      ) : null}
      {r.staff.length ? (
        <div className="card card-clip">
          <div style={{ padding: "12px 16px", fontWeight: 600, borderBottom: "1px solid #e4e7ec" }}>{t("admin.search.staff")}</div>
          {r.staff.map((s) => (
            <Link key={s.id} href="/admin/users?tab=staff" className="adm-row" style={row}>
              <Icon name="ShieldCheck" size={17} color="#7a1f3d" />
              <span style={{ flex: 1 }}>
                <b style={{ fontWeight: 500 }}>{s.name}</b> <span style={{ color: "#5b6474" }}>{s.email}</span>
              </span>
              <span style={{ color: "#5b6474" }}>{t(`admin.staffRole.${s.role}`)}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}
