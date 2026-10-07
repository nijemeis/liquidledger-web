"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";
import { AuthHead, ErrorBanner, SentState } from "../reset/auth-bits";
import { errorKey } from "../reset/reset-form";
import { signupAction } from "./actions";

export function SignupForm({ countries, defaultCountry }: { countries: { code: string; label: string }[]; defaultCountry: string }) {
  const { t } = useI18n();
  const [f, setF] = useState({ company: "", country: defaultCountry, name: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => (setF((s) => ({ ...s, [k]: e.target.value })), setError(null));

  if (sent) return <SentState title={t("auth.checkInbox")} text={t("auth.trialSent", { email: sent })} note={t("auth.trialSentNote")} cta={{ href: "/login", label: t("auth.backToSignIn") }} />;

  return (
    <>
      <AuthHead step={t("auth.signupStep")} title={t("auth.trialTitle")} text={t("auth.trialText")} />
      <form
        noValidate
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.company.trim() || !f.name.trim() || !f.email.trim()) return setError(t("auth.fieldsMissing"));
          if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return setError(t("auth.emailInvalid"));
          start(async () => {
            const r = await signupAction(f).catch(() => ({ ok: false as const, error: "server" }));
            if (r.ok) setSent(f.email.trim());
            else setError(t(errorKey(r.error)));
          });
        }}
      >
        <label className="field">
          {t("auth.company")}
          <input className="input input-lg" autoComplete="organization" value={f.company} onChange={set("company")} maxLength={160} autoFocus />
        </label>
        <label className="field">
          {t("auth.countryLabel")}
          <select className="select input-lg" value={f.country} onChange={set("country")} style={{ height: 44, borderRadius: 9, fontSize: 15 }}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="field-label">{t("auth.countryNote")}</span>
        </label>
        <label className="field">
          {t("auth.yourName")}
          <input className="input input-lg" autoComplete="name" value={f.name} onChange={set("name")} maxLength={120} />
        </label>
        <label className="field">
          {t("auth.email")}
          <input className="input input-lg" type="email" autoComplete="email" value={f.email} onChange={set("email")} maxLength={320} />
        </label>
        <ErrorBanner>{error}</ErrorBanner>
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy} style={{ marginTop: 4 }}>
          {busy ? <Icon name="CircleNotch" size={17} className="spin" /> : null}
          {t("auth.startTrial")}
          <Icon name="ArrowRight" size={17} />
        </button>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "#5b6474" }}>
          <Icon name="ShieldCheck" size={15} color="#157347" style={{ marginTop: 1, flex: "none" }} />
          <span>
            {t("auth.trialIncludes")}. {t("auth.trialAgree")}
          </span>
        </div>
      </form>
      <div style={{ fontSize: 13, color: "#5b6474", textAlign: "center" }}>
        {t("auth.haveAccount")}{" "}
        <Link href="/login" style={{ fontWeight: 600 }}>
          {t("auth.signIn")}
        </Link>
      </div>
    </>
  );
}
