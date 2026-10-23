import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { canView } from "@/lib/permissions";
import { getI18n } from "@/i18n/server";
import { fiscalYearOf } from "@/lib/domain/reports";
import { Icon } from "@/components/icon";
import { XafExport, XafHistory, XafImport } from "./xaf-client";

export const metadata: Metadata = { title: "Import & export" };
export const dynamic = "force-dynamic";

export default async function ImportExportPage() {
  const ctx = await requireApp();
  if (!canView(ctx.role, "reports")) notFound();
  const { t, fmt } = await getI18n(ctx.locale);
  const a = ctx.administration;
  const A = a.id;
  const [batches, firstEntry] = await tenant(ctx, (tx) =>
    Promise.all([
      tx.importBatch.findMany({ where: { administrationId: A }, orderBy: { createdAt: "desc" }, take: 50 }),
      tx.journalEntry.findFirst({ where: { administrationId: A }, orderBy: { date: "asc" }, select: { date: true } }),
    ]),
  );
  const current = fiscalYearOf(new Date(), a.fiscalYearStart).start.getUTCFullYear();
  const earliest = firstEntry ? fiscalYearOf(firstEntry.date, a.fiscalYearStart).start.getUTCFullYear() : current;
  const years = Array.from({ length: Math.max(1, current - earliest + 1) }, (_, i) => current - i).map((y) => {
    const fy = fiscalYearOf(new Date(Date.UTC(y, a.fiscalYearStart - 1, 1)), a.fiscalYearStart);
    return { value: y, label: a.fiscalYearStart === 1 ? String(y) : `${fmt.dateMed(fy.start)} – ${fmt.dateMed(fy.end)}` };
  });
  const canImport = canEditIn(ctx, "reports");

  return (
    <>
      <section className="card card-pad">
        <div className="card-head" style={{ marginBottom: 4 }}>
          <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="UploadSimple" size={18} />
            {t("xaf.import.title")}
          </div>
          {!canImport ? <span className="pill pill-gray">{t("common.readOnly")}</span> : null}
        </div>
        <p className="muted" style={{ margin: "0 0 14px", fontSize: 13.5 }}>{t("xaf.import.text")}</p>
        {canImport ? (
          <XafImport canLock={canEditIn(ctx, "users")} lockedThrough={a.lockedThrough ? fmt.dateMed(a.lockedThrough) : null} />
        ) : (
          <div className="banner banner-info">
            <Icon name="Info" size={17} />
            {t("xaf.err.role")}
          </div>
        )}
      </section>

      <section className="card card-pad">
        <div className="card-head" style={{ marginBottom: 4 }}>
          <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="DownloadSimple" size={18} />
            {t("xaf.export.title")}
          </div>
        </div>
        <p className="muted" style={{ margin: "0 0 14px", fontSize: 13.5 }}>{t("xaf.export.text")}</p>
        <XafExport years={years} />
      </section>

      {batches.length ? (
        <section className="card" style={{ overflow: "hidden" }}>
          <div className="card-pad" style={{ paddingBottom: 8 }}>
            <div className="card-title">{t("xaf.history.title")}</div>
          </div>
          <XafHistory
            canReverse={canImport}
            rows={batches.map((b) => ({
              id: b.id,
              when: fmt.dateMed(b.createdAt),
              file: b.fileName,
              software: b.software,
              company: b.companyName,
              period: b.periodStart && b.periodEnd ? `${fmt.dateMed(b.periodStart)} – ${fmt.dateMed(b.periodEnd)}` : "—",
              entries: fmt.int(b.entries),
              created: t("xaf.history.created", { accounts: b.accountsCreated, relations: b.relationsCreated }),
              reversed: b.reversedAt ? fmt.dateMed(b.reversedAt) : null,
            }))}
          />
        </section>
      ) : null}
    </>
  );
}
