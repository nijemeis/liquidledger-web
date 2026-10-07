import type { Metadata } from "next";
import { canEditIn, requireApp } from "@/lib/app-context";
import { prisma } from "@/lib/db";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { COUNTRIES, PLANS } from "@/lib/domain/setup";
import { canView } from "@/lib/permissions";
import { AdministrationForm, DangerZone } from "./administration-form";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

export default async function AdministrationPage() {
  const ctx = await requireApp();
  const { t, fmt, locale } = await getI18n(ctx.locale);
  const a = ctx.administration;
  const c = a.client;
  const canEdit = canEditIn(ctx, "users");
  const owner = ctx.kind === "user" && canView(ctx.role, "billing");
  const country = COUNTRIES[a.country];
  const regionName = new Intl.DisplayNames([INTL_LOCALE[locale]], { type: "region" }).of(a.country) ?? a.country;
  const plan = PLANS[c.plan];
  const users = owner
    ? await prisma.membership.findMany({ where: { administration: { clientId: c.id, deletedAt: null } }, select: { userId: true }, distinct: ["userId"] })
    : [];
  const statusTone: Record<string, string> = { TRIAL: "pill-blue", ACTIVE: "pill-green", PAST_DUE: "pill-amber", SUSPENDED: "pill-red" };
  const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, i, 1))) }));

  return (
    <>
      <section className="card card-pad">
        <div className="card-head" style={{ marginBottom: 4 }}>
          <div className="card-title">{t("settings.admin.title")}</div>
          {!canEdit ? <span className="pill pill-gray">{t("common.readOnly")}</span> : null}
        </div>
        <p className="muted" style={{ margin: "0 0 14px", fontSize: 13.5 }}>{t("settings.admin.text")}</p>
        <dl className="dl" style={{ margin: "0 0 18px", padding: "12px 14px", background: "#f9fafb", border: "1px solid #e4e7ec", borderRadius: 10 }}>
          <div>
            <dt>{t("common.country")}</dt>
            <dd>
              {country?.flag} {regionName}
            </dd>
          </div>
          <div>
            <dt>{t("settings.admin.chart")}</dt>
            <dd>{a.chartTemplate}</dd>
          </div>
          <div>
            <dt>{t("settings.admin.currency")}</dt>
            <dd>{a.baseCurrency}</dd>
          </div>
          <div>
            <dt>{t("settings.admin.vatReturn")}</dt>
            <dd>{country?.vatReturn ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("settings.admin.closedThrough")}</dt>
            <dd className="n">{a.lockedThrough ? fmt.dateMed(a.lockedThrough) : "—"}</dd>
          </div>
        </dl>
        <AdministrationForm
          canEdit={canEdit}
          months={months}
          vatExample={country?.vatExample ?? "NL123456789B01"}
          initial={{
            legalName: a.legalName,
            addressLine: a.addressLine ?? "",
            postcode: a.postcode ?? "",
            city: a.city ?? "",
            email: a.email ?? "",
            cocNumber: a.cocNumber ?? "",
            vatNumber: a.vatNumber ?? "",
            iban: a.iban ?? "",
            exciseLicenceNo: a.exciseLicenceNo ?? "",
            exciseAuthority: a.exciseAuthority ?? "",
            vatPeriod: a.vatPeriod,
            invoicePrefix: a.invoicePrefix,
            ledgerLanguage: a.ledgerLanguage === "en" ? "en" : "nl",
            fiscalYearStart: a.fiscalYearStart,
          }}
        />
      </section>

      {owner ? (
        <section className="card card-pad">
          <div className="card-head">
            <div className="card-title">{t("settings.admin.billing")}</div>
            <span className={`pill ${statusTone[c.status] ?? "pill-gray"}`}>{t(`settings.clientStatus.${c.status}`)}</span>
          </div>
          <div className="grid-cards" style={{ marginBottom: 0 }}>
            <div className="card stat">
              <div className="stat-label">{t("settings.admin.plan")}</div>
              <div className="stat-value">{t(`settings.plan.${c.plan}`)}</div>
              <div className="stat-note">{plan.price !== null ? t("settings.admin.perMonth", { price: fmt.money(plan.price, { decimals: 0 }) }) : t("settings.admin.custom")}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">{t("settings.admin.users")}</div>
              <div className="stat-value n">
                {users.length}
                {plan.users !== null ? <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}> / {plan.users}</span> : null}
              </div>
              <div className="stat-note">{plan.users === null ? t("settings.admin.unlimited") : t("settings.admin.seatsLeft", { n: Math.max(0, plan.users - users.length) })}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">{c.status === "TRIAL" ? t("settings.admin.trialEnds") : t("settings.admin.customerSince")}</div>
              <div className="stat-value n">{c.status === "TRIAL" && c.trialEndsAt ? fmt.dateMed(c.trialEndsAt) : fmt.dateMed(c.createdAt)}</div>
              <div className="stat-note">
                {c.status === "TRIAL" && c.trialEndsAt
                  ? t("settings.admin.daysLeft", { n: Math.max(0, Math.ceil((c.trialEndsAt.getTime() - Date.now()) / 86400_000)) })
                  : t("settings.admin.dataRegion")}
              </div>
            </div>
          </div>
          <p className="muted" style={{ margin: "12px 0 0", fontSize: 13 }}>{t("settings.admin.billingNote")}</p>
        </section>
      ) : null}

      {owner ? <DangerZone legalName={a.legalName} canDelete={canEditIn(ctx, "deleteAdministration")} /> : null}
    </>
  );
}
