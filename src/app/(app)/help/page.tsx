import type { Metadata } from "next";
import Link from "next/link";
import { requireApp } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Icon, type IconName } from "@/components/icon";
import { PageHead } from "@/components/ui";

export const metadata: Metadata = { title: "Help & support" };

const SUPPORT_EMAIL = "support@liquidledger.net";
const STATUS_URL = "https://status.liquidledger.net";

export default async function HelpPage() {
  const ctx = await requireApp();
  const { t } = await getI18n(ctx.locale);
  const card = (icon: IconName, tone: { bg: string; fg: string }, title: string, items: { text: string; href?: string }[], note?: string) => (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="tile" style={{ width: 36, height: 36, background: tone.bg, color: tone.fg }}>
          <Icon name={icon} size={19} />
        </span>
        <div className="card-title">{title}</div>
      </div>
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, color: "#3a4250" }}>
        {items.map((i) => (
          <li key={i.text}>
            {i.href ? (
              <Link href={i.href} style={{ color: "inherit" }}>
                {i.text} <Icon name="ArrowRight" size={12} color="#7a1f3d" />
              </Link>
            ) : (
              i.text
            )}
          </li>
        ))}
      </ol>
      {note ? (
        <div className="banner banner-warn" style={{ marginTop: "auto" }}>
          <Icon name="Scales" size={17} />
          {note}
        </div>
      ) : null}
    </section>
  );

  return (
    <>
      <PageHead eyebrow={t("settings.help.eyebrow")} title={t("settings.help.title")} />
      <div className="grid-3">
        {card("Lightning", { bg: "#f9eef2", fg: "#7a1f3d" }, t("settings.help.startTitle"), [
          { text: t("settings.help.start1"), href: "/settings/administration" },
          { text: t("settings.help.start2"), href: "/bank" },
          { text: t("settings.help.start3"), href: "/products" },
          { text: t("settings.help.start4"), href: "/purchases" },
          { text: t("settings.help.start5"), href: "/settings/users" },
        ])}
        {card(
          "Percent",
          { bg: "#e8f0fb", fg: "#1f4f8f" },
          t("settings.help.taxTitle"),
          [{ text: t("settings.help.tax1") }, { text: t("settings.help.tax2") }, { text: t("settings.help.tax3") }, { text: t("settings.help.tax4") }],
          t("settings.help.taxNote"),
        )}
        {card("ShieldCheck", { bg: "#e6f6ee", fg: "#157347" }, t("settings.help.secTitle"), [
          { text: t("settings.help.sec1"), href: "/settings/security" },
          { text: t("settings.help.sec2") },
          { text: t("settings.help.sec3") },
          { text: t("settings.help.sec4") },
        ])}
      </div>
      <div className="grid-2">
        <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="tile" style={{ width: 36, height: 36, background: "#f9eef2", color: "#7a1f3d" }}>
              <Icon name="Lifebuoy" size={19} />
            </span>
            <div className="card-title">{t("settings.help.contactTitle")}</div>
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: "#3a4250" }}>{t("settings.help.contactText")}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn btn-primary" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Liquid Ledger · ${ctx.administration.legalName}`)}`}>
              <Icon name="EnvelopeSimple" size={16} />
              {SUPPORT_EMAIL}
            </a>
            <a className="btn" href={STATUS_URL} target="_blank" rel="noopener noreferrer">
              <Icon name="Pulse" size={16} />
              {t("settings.help.status")}
              <Icon name="ArrowSquareOut" size={14} color="#5b6474" />
            </a>
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>{t("settings.help.contactNote")}</div>
        </section>
        <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="tile" style={{ width: 36, height: 36, background: "#f0f2f5", color: "#4b5563" }}>
              <Icon name="Keyboard" size={19} />
            </span>
            <div className="card-title">{t("settings.help.keysTitle")}</div>
          </div>
          {[
            ["⌘K / Ctrl K", t("settings.help.keySearch")],
            ["+ " + t("common.new") + " → I", t("common.newMenu.sales")],
            ["+ " + t("common.new") + " → U", t("common.newMenu.upload")],
            ["+ " + t("common.new") + " → E", t("common.newMenu.receipt")],
            ["Esc", t("settings.help.keyClose")],
          ].map(([k, label]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5, borderBottom: "1px solid #eef0f3", paddingBottom: 8 }}>
              <span>{label}</span>
              <span className="n" style={{ fontSize: 12, padding: "1px 7px", border: "1px solid #e4e7ec", borderRadius: 5, color: "#5b6474", whiteSpace: "nowrap" }}>{k}</span>
            </div>
          ))}
          <div className="muted" style={{ fontSize: 12.5 }}>
            <Link href="/privacy">{t("settings.legal.privacyTitle")}</Link> · <Link href="/terms">{t("settings.legal.termsTitle")}</Link>
          </div>
        </section>
      </div>
    </>
  );
}
