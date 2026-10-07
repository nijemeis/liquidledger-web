"use client";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";
import { EnrollFlow } from "../login/enroll-flow";
import { AuthHead, ErrorBanner, PasswordInput, PasswordMeter } from "../reset/auth-bits";
import { errorKey } from "../reset/reset-form";
import { acceptInviteAction } from "./actions";

export function InviteFlow({ token, email, name: initialName, title, text, role, enrolling }: { token: string; email: string; name: string; title: string; text: string; role: string; enrolling?: boolean }) {
  const { t } = useI18n();
  const [stage, setStage] = useState<"form" | "enroll">(enrolling ? "enroll" : "form");
  const [name, setName] = useState(initialName);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (stage === "enroll" || enrolling) {
    return (
      <EnrollFlow
        onBack={() => {
          window.location.href = "/login";
        }}
        onDone={(redirect) => {
          window.location.href = redirect;
        }}
      />
    );
  }

  return (
    <>
      <AuthHead step={t("auth.inviteStep")} title={title} text={text} icon="UserPlus" />
      <form
        noValidate
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError(t("auth.nameMissing"));
          if (password !== repeat) return setError(t("auth.passwordsDiffer"));
          start(async () => {
            const r = await acceptInviteAction({ token, name, password, repeat }).catch(() => ({ ok: false as const, error: "server" }));
            if (r.ok) setStage("enroll");
            else setError(t(errorKey(r.error)));
          });
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9, background: "#fcf5f7", border: "1px solid #f1d5df", fontSize: 13.5 }}>
          <Icon name="EnvelopeSimple" size={18} color="#7a1f3d" />
          <span style={{ flex: 1, minWidth: 0 }} className="truncate">
            <span style={{ color: "#5b6474" }}>{t("auth.inviteAs")} </span>
            <b style={{ fontWeight: 600 }}>{email}</b>
          </span>
          <span className="pill pill-wine">{role}</span>
        </div>
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <label className="field">
          {t("auth.yourName")}
          <input className="input input-lg" autoComplete="name" value={name} maxLength={120} onChange={(e) => (setName(e.target.value), setError(null))} autoFocus={!initialName} />
        </label>
        <PasswordInput label={t("auth.password")} value={password} onChange={(v) => (setPassword(v), setError(null))} autoFocus={Boolean(initialName)} />
        <PasswordMeter password={password} />
        <PasswordInput label={t("auth.confirmPassword")} value={repeat} onChange={(v) => (setRepeat(v), setError(null))} />
        <ErrorBanner>{error}</ErrorBanner>
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !password || !repeat}>
          {busy ? <Icon name="CircleNotch" size={17} className="spin" /> : null}
          {t("auth.acceptInvite")}
          <Icon name="ArrowRight" size={17} />
        </button>
      </form>
    </>
  );
}
