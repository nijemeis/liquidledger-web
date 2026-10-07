import Link from "next/link";
import { prisma } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { requireStaff } from "@/lib/admin/staff";
import { countryOf, LOCKED, mrrOf, NO_2FA } from "@/lib/admin/data";
import { actionIcon, auditTime, daysLeft, relTime } from "@/lib/admin/format";
import { COUNTRIES } from "@/lib/domain/setup";
import { Icon, type IconName } from "@/components/icon";
import { TONE, type Tone } from "@/components/ui";
import { NewClientButton } from "./clients/new-client";

export default async function AdminOverview({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const { t, fmt } = await getI18n();
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400_000);

  const [clients, users, noMfa, lockedUsers, failed, recent] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true, country: true, status: true, plan: true, trialEndsAt: true, lastActiveAt: true } }),
    prisma.user.count({ where: { status: { not: "DISABLED" } } }),
    prisma.user.findMany({ where: NO_2FA, select: { name: true, status: true }, orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ where: LOCKED(now), select: { name: true, lockReason: true }, orderBy: { updatedAt: "desc" } }),
    prisma.subscriptionInvoice.findMany({ where: { status: "FAILED" }, include: { client: { select: { id: true, name: true } } }, orderBy: { issuedAt: "desc" }, take: 3 }),
    ctx.can("audit.read") ? prisma.auditEvent.findMany({ orderBy: { at: "desc" }, take: 6 }) : Promise.resolve([]),
  ]);

  const active = clients.filter((c) => c.status === "ACTIVE");
  const trials = clients.filter((c) => c.status === "TRIAL");
  const ending = trials.filter((c) => c.trialEndsAt && c.trialEndsAt <= in7).sort((a, b) => a.trialEndsAt!.getTime() - b.trialEndsAt!.getTime());
  const mrr = clients.reduce((s, c) => s + mrrOf(c), 0);
  const paying = clients.filter((c) => mrrOf(c) > 0).length;

  const kpis: { icon: IconName; label: string; value: string; note: string; color: string; href: string }[] = [
    { icon: "Buildings", label: t("admin.overview.activeClients"), value: fmt.int(active.length), note: t("admin.overview.onTrial", { n: trials.length }), color: "#5b6474", href: "/admin/clients?tab=active" },
    { icon: "Users", label: t("admin.overview.users"), value: fmt.int(users), note: noMfa.length ? t("admin.overview.without2fa", { n: noMfa.length }) : t("admin.overview.all2fa"), color: noMfa.length ? "#9a5b00" : "#157347", href: "/admin/users?tab=no2fa" },
    { icon: "ChartLineUp", label: t("admin.overview.mrr"), value: fmt.money(mrr, { decimals: 0 }), note: t("admin.overview.paying", { n: paying }), color: "#157347", href: "/admin/billing" },
    {
      icon: "HourglassMedium",
      label: t("admin.overview.trialsEnding"),
      value: fmt.int(ending.length),
      note: ending[0] ? t("admin.overview.trialFirst", { name: ending[0].name.replace(/\s+(B\.V\.|S\.r\.l\.|GmbH|SAS|NV|S\.L\.|S\.p\.A\.)$/, ""), n: daysLeft(ending[0].trialEndsAt) }) : t("admin.overview.noTrialsEnding"),
      color: "#5b6474",
      href: "/admin/clients?tab=trial",
    },
  ];

  const attention: { icon: IconName; tone: Tone; title: string; meta: string; href: string }[] = [
    ...failed.map((i) => ({
      icon: "CreditCard" as IconName,
      tone: "amber" as Tone,
      title: t("admin.overview.paymentFailed", { client: i.client.name }),
      meta: t("admin.overview.paymentFailedMeta", { number: i.number, amount: fmt.money(i.amountCents) }),
      href: `/admin/clients?id=${i.client.id}`,
    })),
    ...(lockedUsers.length
      ? [{ icon: "LockSimple" as IconName, tone: "red" as Tone, title: t(lockedUsers.length === 1 ? "admin.overview.lockedOutOne" : "admin.overview.lockedOut", { n: lockedUsers.length }), meta: `${lockedUsers[0]!.name}${lockedUsers[0]!.lockReason ? " · " + lockedUsers[0]!.lockReason : ""}${lockedUsers.length > 1 ? " · +" + (lockedUsers.length - 1) : ""}`, href: "/admin/users?tab=locked" }]
      : []),
    ...(noMfa.length
      ? [{ icon: "ShieldWarning" as IconName, tone: "amber" as Tone, title: t(noMfa.length === 1 ? "admin.overview.no2faOne" : "admin.overview.no2fa", { n: noMfa.length }), meta: noMfa.every((u) => u.status === "INVITED") ? t("admin.overview.no2faInvited") : t("admin.overview.no2faMeta"), href: "/admin/users?tab=no2fa" }]
      : []),
    ...ending.map((c) => ({
      icon: "HourglassMedium" as IconName,
      tone: "blue" as Tone,
      title: t("admin.overview.trialEnds", { n: daysLeft(c.trialEndsAt), client: c.name }),
      meta: t("admin.overview.lastActive", { when: relTime(c.lastActiveAt, t, fmt) }),
      href: `/admin/clients?id=${c.id}`,
    })),
  ];

  const byCountry = Object.keys(COUNTRIES)
    .map((cc) => ({ cc, n: clients.filter((c) => c.country === cc).length }))
    .concat(
      [...new Set(clients.map((c) => c.country))].filter((cc) => !COUNTRIES[cc]).map((cc) => ({ cc, n: clients.filter((c) => c.country === cc).length })),
    );
  const maxN = Math.max(1, ...byCountry.map((c) => c.n));

  return (
    <>
      <div className="page-head" style={{ marginBottom: 20 }}>
        <div>
          <div className="eyebrow">{fmt.dateLong(now)}</div>
          <h1>{t("admin.overview.title")}</h1>
        </div>
        {ctx.can("clients.write") ? <NewClientButton /> : null}
      </div>
      {sp.denied ? (
        <div className="banner banner-warn" style={{ marginBottom: 14 }}>
          <Icon name="Warning" size={17} />
          {t("admin.denied")}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14, marginBottom: 14 }}>
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="card" style={{ padding: "16px 18px", color: "inherit", textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#5b6474" }}>
              <Icon name={k.icon} size={17} />
              {k.label}
            </div>
            <div className="n" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4 }}>{k.value}</div>
            <div style={{ fontSize: 12.5, color: k.color }}>{k.note}</div>
          </Link>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,400px),1fr))", gap: 14 }}>
        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 8 }}>{t("admin.overview.attention")}</div>
          {attention.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 4px", color: "#157347" }}>
              <Icon name="CheckCircle" size={18} />
              {t("admin.overview.nothing")}
            </div>
          ) : null}
          {attention.map((a, i) => (
            <Link key={i} href={a.href} className="adm-hover" style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "10px 4px", borderBottom: "1px solid #f0f2f5", color: "inherit", textDecoration: "none" }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", background: TONE[a.tone].bg, color: TONE[a.tone].fg }}>
                <Icon name={a.icon} size={17} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{a.title}</div>
                <div style={{ fontSize: 12.5, color: "#5b6474" }}>{a.meta}</div>
              </div>
              <Icon name="CaretRight" color="#8a93a3" />
            </Link>
          ))}
        </div>

        <div className="card card-pad">
          <div className="card-title" style={{ marginBottom: 12 }}>{t("admin.overview.byCountry")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {byCountry.map((c) => (
              <div key={c.cc} style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr) 34px", gap: 10, alignItems: "center", fontSize: 13 }}>
                <span className="truncate">
                  {countryOf(c.cc).flag} {t(`admin.country.${c.cc}`) === `admin.country.${c.cc}` ? countryOf(c.cc).name : t(`admin.country.${c.cc}`)}
                </span>
                <div style={{ height: 8, borderRadius: 999, background: "#f0f2f5" }}>
                  <div style={{ height: "100%", width: `${(c.n / maxN) * 100}%`, borderRadius: 999, background: "#7a1f3d" }} />
                </div>
                <span className="n" style={{ textAlign: "right", fontWeight: 500 }}>{c.n}</span>
              </div>
            ))}
          </div>
        </div>

        {ctx.can("audit.read") ? (
          <div className="card card-pad">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <div className="card-title">{t("admin.overview.recent")}</div>
              <Link href="/admin/audit" style={{ fontSize: 13 }}>{t("admin.overview.toAudit")}</Link>
            </div>
            {recent.map((e) => {
              const ic = actionIcon(e.action);
              return (
                <div key={e.id} style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr) auto", gap: 10, padding: "8px 0", borderBottom: "1px solid #f0f2f5", fontSize: 13 }}>
                  <Icon name={ic.icon} size={16} color="#5b6474" style={{ marginTop: 1 }} />
                  <span>
                    <b style={{ fontWeight: 600 }}>{e.actorLabel}</b> {e.summary}
                  </span>
                  <span className="n" style={{ color: "#8a93a3", fontSize: 12, whiteSpace: "nowrap" }}>{auditTime(e.at, t, fmt)}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </>
  );
}
