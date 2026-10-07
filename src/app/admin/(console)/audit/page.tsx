import Link from "next/link";
import { prisma } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { requireStaff } from "@/lib/admin/staff";
import { actionIcon, auditTime } from "@/lib/admin/format";
import { auditQueryString, auditWhere, parseAuditFilters } from "@/lib/admin/audit-query";
import { Icon } from "@/components/icon";

const COLS = "140px minmax(0,1fr) minmax(0,1.8fr) minmax(0,1fr) 120px";
const PER = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaff("audit.read");
  const sp = await searchParams;
  const { t, fmt } = await getI18n();
  const f = parseAuditFilters(sp);
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  const where = auditWhere(f);
  const [events, total, clients] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * PER, take: PER }),
    prisma.auditEvent.count({ where }),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const pages = Math.max(1, Math.ceil(total / PER));
  const filtered = Object.values(f).some(Boolean);

  return (
    <>
      <div className="page-head" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">{t("admin.audit.eyebrow")}</div>
          <h1>{t("admin.audit.title")}</h1>
        </div>
        <a className="btn" href={`/admin/audit/export${auditQueryString(f)}`} download>
          <Icon name="DownloadSimple" size={16} />
          {t("admin.audit.export")}
        </a>
      </div>

      <form method="get" action="/admin/audit" className="card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", padding: "12px 14px", marginBottom: 14 }}>
        <label className="field" style={{ flex: "1 1 200px" }}>
          <span className="field-label">{t("admin.audit.f.client")}</span>
          <select name="client" className="select" defaultValue={f.client ?? ""}>
            <option value="">{t("admin.audit.f.allClients")}</option>
            <option value="none">{t("admin.audit.f.platform")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: "0 1 150px" }}>
          <span className="field-label">{t("admin.audit.f.actor")}</span>
          <select name="actor" className="select" defaultValue={f.actor ?? ""}>
            <option value="">{t("admin.audit.f.anyone")}</option>
            <option value="USER">{t("admin.audit.actor.USER")}</option>
            <option value="STAFF">{t("admin.audit.actor.STAFF")}</option>
            <option value="SYSTEM">{t("admin.audit.actor.SYSTEM")}</option>
          </select>
        </label>
        <label className="field" style={{ flex: "1 1 180px" }}>
          <span className="field-label">{t("admin.audit.f.action")}</span>
          <input name="q" className="input" defaultValue={f.q ?? ""} placeholder={t("admin.audit.f.actionPh")} />
        </label>
        <label className="field" style={{ flex: "0 1 150px" }}>
          <span className="field-label">{t("admin.audit.f.from")}</span>
          <input name="from" type="date" className="input" defaultValue={f.from ?? ""} />
        </label>
        <label className="field" style={{ flex: "0 1 150px" }}>
          <span className="field-label">{t("admin.audit.f.to")}</span>
          <input name="to" type="date" className="input" defaultValue={f.to ?? ""} />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-primary">
            <Icon name="Funnel" size={16} />
            {t("admin.audit.f.apply")}
          </button>
          {filtered ? (
            <Link href="/admin/audit" className="btn">
              {t("admin.audit.f.clear")}
            </Link>
          ) : null}
        </div>
      </form>

      <div className="card card-clip">
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 900 }}>
            <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 12 }}>
              <div>{t("admin.audit.col.time")}</div>
              <div>{t("admin.audit.col.who")}</div>
              <div>{t("admin.audit.col.what")}</div>
              <div>{t("admin.audit.col.client")}</div>
              <div>{t("admin.audit.col.ip")}</div>
            </div>
            {events.length === 0 ? <div className="empty">{t("admin.audit.empty")}</div> : null}
            {events.map((e) => {
              const ic = actionIcon(e.action);
              return (
                <div key={e.id} style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "10px 16px", alignItems: "center", fontSize: 13.5, borderBottom: "1px solid #eef0f3" }}>
                  <div className="n" style={{ color: "#5b6474" }} title={fmt.dateTime(e.at)}>
                    {auditTime(e.at, t, fmt)}
                  </div>
                  <div className="truncate" style={{ fontWeight: 500 }} title={`${t(`admin.audit.actor.${e.actorType}`)}`}>
                    {e.actorLabel}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }} title={e.action}>
                    <Icon name={ic.icon} size={16} color={ic.color} />
                    <span style={{ minWidth: 0 }}>{e.summary}</span>
                  </div>
                  <div className="truncate" style={{ color: "#3a4250" }}>
                    {e.clientId ? clientName.get(e.clientId) ?? "—" : <span style={{ color: "#8a93a3" }}>{t("admin.audit.platform")}</span>}
                  </div>
                  <div className="n" style={{ color: "#8a93a3", fontSize: 12.5 }}>{e.ip ?? "—"}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", fontSize: 13, color: "#5b6474", flexWrap: "wrap", gap: 8 }}>
          <span>
            {t("admin.audit.count", { n: fmt.int(total) })} · {t("admin.audit.pageOf", { page, pages })}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            {page > 1 ? (
              <Link className="btn btn-sm" href={`/admin/audit${auditQueryString(f, { page: page - 1 })}`}>
                <Icon name="ArrowLeft" size={14} />
                {t("admin.audit.prev")}
              </Link>
            ) : null}
            {page < pages ? (
              <Link className="btn btn-sm" href={`/admin/audit${auditQueryString(f, { page: page + 1 })}`}>
                {t("admin.audit.next")}
                <Icon name="ArrowRight" size={14} />
              </Link>
            ) : null}
          </span>
        </div>
      </div>
    </>
  );
}
