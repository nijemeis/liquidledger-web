"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";
import { AuthHead, ErrorBanner, PasswordInput, PasswordMeter } from "./auth-bits";
import { resetAction } from "./actions";

export function errorKey(e: string): string {
  if (e === "differ") return "auth.passwordsDiffer";
  if (e === "throttled") return "auth.throttled";
  if (e === "expired") return "auth.linkInvalid";
  if (["pwShort", "pwLong", "pwEmail", "pwEasy", "nameMissing", "fieldsMissing", "emailInvalid"].includes(e)) return `auth.${e}`;
  return "auth.serverError";
}

export function ResetForm({ token, email }: { token: string; email: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  return (
    <>
      <AuthHead step={t("auth.forgotStep")} title={t("auth.resetTitle")} text={t("auth.resetText")} icon="LockKeyOpen" />
      <form
        noValidate
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (password !== repeat) return setError(t("auth.passwordsDiffer"));
          start(async () => {
            const r = await resetAction({ token, password, repeat }).catch(() => ({ ok: false as const, error: "server" }));
            if (r.ok) router.replace("/login?reset=1");
            else setError(t(errorKey(r.error)));
          });
        }}
      >
        {/* Lets password managers save the new password for the right account. */}
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <div style={{ fontSize: 13.5, color: "#5b6474" }}>
          {t("auth.email")}: <b style={{ color: "#14171f", fontWeight: 600 }}>{email}</b>
        </div>
        <PasswordInput label={t("auth.newPassword")} value={password} onChange={(v) => (setPassword(v), setError(null))} autoFocus />
        <PasswordMeter password={password} />
        <PasswordInput label={t("auth.confirmPassword")} value={repeat} onChange={(v) => (setRepeat(v), setError(null))} />
        <ErrorBanner>{error}</ErrorBanner>
        <div className="banner banner-info">
          <Icon name="ShieldCheck" size={17} />
          {t("auth.resetKeeps2fa")}
        </div>
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !password || !repeat}>
          {busy ? <Icon name="CircleNotch" size={17} className="spin" /> : null}
          {t("auth.setPassword")}
          <Icon name="ArrowRight" size={17} />
        </button>
      </form>
    </>
  );
}

export function LinkInvalid({ kind }: { kind: "reset" | "invite" | "lock" }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14 }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#fdebea", color: "#b42318", display: "grid", placeItems: "center" }}>
        <Icon name="LinkBreak" size={30} />
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{t("auth.resetInvalidTitle")}</h1>
      <p style={{ margin: 0, color: "#5b6474", fontSize: 14.5 }}>
        {t("auth.linkInvalid")} {kind === "invite" ? t("auth.inviteExpiredText") : null}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {kind !== "invite" ? (
          <Link href="/forgot" className="btn btn-primary btn-lg">
            {kind === "lock" ? t("auth.goReset") : t("auth.requestNewLink")}
          </Link>
        ) : null}
        <Link href="/login" className="btn btn-lg">
          {t("auth.backToSignIn")}
        </Link>
      </div>
    </div>
  );
}
