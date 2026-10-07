import Link from "next/link";
import type { ClientStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { requireStaff } from "@/lib/admin/staff";
import { countryOf, formatBytes, mfaKindOf, mrrOf, storageBytes, userCountsByClient } from "@/lib/admin/data";
import { CLIENT_STATUS_TONE, daysLeft, initialsOf, relTime } from "@/lib/admin/format";
import { activeSupportSession } from "@/lib/admin/support";
import { PLANS } from "@/lib/domain/setup";
import { FIXED } from "@/lib/policies";
import { Icon } from "@/components/icon";
import { Pill, TabLinks } from "@/components/ui";
import { NewClientButton, NewClientDrawer } from "./new-client";
import { ClientDrawer, type ClientDetail } from "./client-drawer";

const TABS: [string, ClientStatus | null][] = [
  ["all", null],
  ["active", "ACTIVE"],
  ["trial", "TRIAL"],
  ["past_due", "PAST_DUE"],
  ["suspended", "SUSPENDED"],
];
const COLS = "minmax(0,1.8fr) 110px 100px 70px 100px 120px 150px 24px";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ tab?: string; id?: string; new?: string }> }) {
  const ctx = await requireStaff("clients.read");
  const sp = await searchParams;
  const { t, fmt } = await getI18n();
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? "all";
  const status = TABS.find(([k]) => k === tab)![1];

  const [clients, userCounts] = await Promise.all([prisma.client.findMany({ orderBy: [{ createdAt: "asc" }] }), userCountsByClient()]);
  const shown = clients.filter((c) => !status || c.status === status);
  const qs = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab: tab === "all" ? undefined : tab, ...p })) if (v) u.set(k, v);
    const s = u.toString();
    return `/admin/clients${s ? `?${s}` : ""}`;
  };
  const statusLabel = (c: { status: ClientStatus; trialEndsAt: Date | null }) =>
    c.status === "TRIAL" ? t("admin.clients.trialLeft", { n: daysLeft(c.trialEndsAt) }) : t(`admin.clientStatus.${c.status}`);

  // Drawer details
  let detail: ClientDetail | null = null;
  const sel = sp.id ? clients.find((c) => c.id === sp.id) : null;
  if (sel) {
    const [admins, members, support] = await Promise.all([
      prisma.administration.findMany({ where: { clientId: sel.id, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } }),
      prisma.user.findMany({
        where: { memberships: { some: { administration: { clientId: sel.id, deletedAt: null } } } },
        include: { _count: { select: { passkeys: true } }, memberships: { where: { administration: { clientId: sel.id } }, orderBy: { createdAt: "asc" }, take: 1 } },
        orderBy: { createdAt: "asc" },
      }),
      activeSupportSession(sel.id),
    ]);
    const bytes = await storageBytes(admins.map((a) => a.id));
    const limit = PLANS[sel.plan].administrations;
    const country = countryOf(sel.country);
    const mrr = mrrOf(sel);
    detail = {
      id: sel.id,
      name: sel.name,
      initials: initialsOf(sel.name),
      country: sel.country,
      countryLine: `${country.flag} ${t(`admin.country.${sel.country}`)}`,
      vatNumber: sel.vatNumber ?? "",
      since: fmt.monthLong(sel.createdAt),
      status: sel.status,
      statusLabel: statusLabel(sel),
      plan: sel.plan,
      modules: sel.modules,
      facts: [
        [t("admin.clients.f.plan"), t(`admin.plan.${sel.plan}`)],
        [t("admin.clients.f.mrr"), mrr ? fmt.money(mrr, { decimals: 0 }) : "—"],
        [t("admin.clients.f.users"), fmt.int(members.length)],
        [t("admin.clients.f.administrations"), limit === null ? t("admin.clients.ofUnlimited", { n: admins.length }) : t("admin.clients.ofN", { n: admins.length, max: limit })],
        [t("admin.clients.f.lastActive"), relTime(sel.lastActiveAt, t, fmt)],
        [t("admin.clients.f.region"), FIXED.dataRegion],
        [t("admin.clients.f.taxRegime"), country.vatReturn || "—"],
        [t("admin.clients.f.storage"), formatBytes(bytes)],
      ],
      users: members.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.memberships[0]?.role ?? "READ_ONLY",
        status: u.status,
        mfa: mfaKindOf(u),
      })),
      support: support
        ? { id: support.id, staffName: support.staff.name, mine: support.staffId === ctx.staff.id, reason: support.reason, until: fmt.time(support.expiresAt), expiresAt: support.expiresAt.toISOString() }
        : null,
    };
  }

  return (
    <>
      <div className="page-head" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">{t("admin.clients.eyebrow")}</div>
          <h1>{t("admin.clients.title")}</h1>
        </div>
        {ctx.can("clients.write") ? <NewClientButton /> : null}
      </div>
      <div className="card card-clip">
        <TabLinks
          active={tab}
          tabs={TABS.map(([k, s]) => ({ key: k, label: t(`admin.clients.tab.${k}`), count: s ? clients.filter((c) => c.status === s).length : clients.length, href: `/admin/clients${k === "all" ? "" : `?tab=${k}`}` }))}
        />
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 980 }}>
            <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 12 }}>
              <div>{t("admin.clients.col.client")}</div>
              <div>{t("admin.clients.col.country")}</div>
              <div>{t("admin.clients.col.plan")}</div>
              <div style={{ textAlign: "right" }}>{t("admin.clients.col.users")}</div>
              <div style={{ textAlign: "right" }}>{t("admin.clients.col.mrr")}</div>
              <div>{t("admin.clients.col.lastActive")}</div>
              <div>{t("admin.clients.col.status")}</div>
              <div />
            </div>
            {shown.map((c) => {
              const mrr = mrrOf(c);
              return (
                <Link key={c.id} href={qs({ id: c.id })} scroll={false} className="adm-row" style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "11px 16px", alignItems: "center", borderBottom: "1px solid #eef0f3", background: c.id === sp.id ? "#fcf5f7" : "#fff", fontSize: 13.5, color: "inherit", textDecoration: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <div style={{ width: 32, height: 32, flex: "none", borderRadius: 8, background: "#f9eef2", color: "#7a1f3d", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12 }}>{initialsOf(c.name)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontWeight: 600 }}>{c.name}</div>
                      <div className="n" style={{ fontSize: 12.5, color: "#5b6474" }}>{c.vatNumber ?? "—"}</div>
                    </div>
                  </div>
                  <div className="truncate">
                    {countryOf(c.country).flag} {t(`admin.country.${c.country}`)}
                  </div>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 6, background: "#f0f2f5", color: "#3a4250" }}>{t(`admin.plan.${c.plan}`)}</span>
                  </div>
                  <div className="n" style={{ textAlign: "right" }}>{userCounts.get(c.id) ?? 0}</div>
                  <div className="n" style={{ textAlign: "right", fontWeight: 500 }}>{mrr ? fmt.money(mrr, { decimals: 0 }) : "—"}</div>
                  <div style={{ color: "#5b6474" }}>{relTime(c.lastActiveAt, t, fmt)}</div>
                  <div>
                    <Pill tone={CLIENT_STATUS_TONE[c.status]}>{statusLabel(c)}</Pill>
                  </div>
                  <Icon name="CaretRight" color="#8a93a3" />
                </Link>
              );
            })}
            {shown.length === 0 ? <div className="empty">{t("admin.clients.empty")}</div> : null}
          </div>
        </div>
      </div>
      {detail ? <ClientDrawer key={detail.id} c={detail} closeHref={qs({})} caps={{ write: ctx.can("clients.write"), billing: ctx.can("clients.billing"), support: ctx.can("support.open") }} /> : null}
      {sp.new && ctx.can("clients.write") ? <NewClientDrawer closeHref={qs({})} /> : null}
    </>
  );
}
