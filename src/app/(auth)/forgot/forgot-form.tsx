"use client";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";
import { AuthHead, ErrorBanner, SentState } from "../reset/auth-bits";
import { forgotAction } from "./actions";

export function ForgotForm() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, start] = useTransition();

  if (sent) return <SentState title={t("auth.checkInbox")} text={t("auth.resetSent")} note={t("auth.forgotNote")} cta={{ href: "/login", label: t("auth.backToSignIn") }} />;

  return (
    <>
      <AuthHead step={t("auth.forgotStep")} title={t("auth.forgotTitle")} text={t("auth.forgotText")} back={{ href: "/login", label: t("auth.backToSignIn") }} />
      <form
        noValidate
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t("auth.emailInvalid"));
          start(async () => {
            const r = await forgotAction({ email }).catch(() => ({ ok: false as const, error: "server" as const }));
            if (r.ok) setSent(true);
            else setError(r.error === "throttled" ? t("auth.throttled") : r.error === "emailInvalid" ? t("auth.emailInvalid") : t("auth.serverError"));
          });
        }}
      >
        <label className="field">
          {t("auth.email")}
          <input className="input input-lg" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => (setEmail(e.target.value), setError(null))} />
        </label>
        <ErrorBanner>{error}</ErrorBanner>
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy} style={{ marginTop: 4 }}>
          {busy ? <Icon name="CircleNotch" size={17} className="spin" /> : <Icon name="PaperPlaneTilt" size={17} />}
          {t("auth.sendLink")}
        </button>
      </form>
    </>
  );
}
