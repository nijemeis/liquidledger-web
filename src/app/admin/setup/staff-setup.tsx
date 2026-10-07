"use client";
import { useState } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";
import { adminAuthPost } from "../auth-api";

type RegOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];

export function StaffSetup({ token, name, email, role }: { token: string; name: string; email: string; role: string }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) return setError(t("admin.setup.tooShort"));
    if (password !== confirm) return setError(t("admin.setup.mismatch"));
    if (!browserSupportsWebAuthn()) return setError(t("admin.auth.unsupported"));
    setBusy(true);
    try {
      const o = await adminAuthPost<{ ok: boolean; options?: RegOptions; error?: string; message?: string; reason?: string }>("setup-options", { token, password });
      if (!o.ok || !o.options) {
        setError(o.error === "password" ? (o.message ?? t("admin.setup.weak")) : o.error === "token" ? t("admin.setup.tokenGone") : o.error === "throttled" ? t("admin.auth.throttled") : t("admin.auth.server"));
        setBusy(false);
        return;
      }
      const response = await startRegistration({ optionsJSON: o.options });
      const r = await adminAuthPost("setup", { response });
      if (r.ok && r.next === "done") {
        setDone(true);
        setTimeout(() => (window.location.href = r.redirect ?? "/admin"), 900);
        return;
      }
      setError(r.error === "token" ? t("admin.setup.tokenGone") : r.error === "expired" ? t("admin.auth.expired") : t("admin.setup.passkeyFailed"));
    } catch {
      setError(t("admin.auth.passkeyCancelled"));
    }
    setBusy(false);
  }

  if (done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "#e6f6ee", color: "#157347", display: "grid", placeItems: "center" }}>
          <Icon name="CheckCircle" size={30} />
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>{t("admin.setup.doneTitle")}</h1>
        <p style={{ margin: 0, color: "#5b6474" }}>{t("admin.setup.doneText")}</p>
      </div>
    );
  }

  return (
    <>
      <div>
        <div style={{ fontSize: 13, color: "#7a1f3d", fontWeight: 500, marginBottom: 6 }}>{t("admin.setup.eyebrow")}</div>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>{t("admin.setup.title", { name: name.split(" ")[0] ?? name })}</h1>
        <p style={{ margin: "6px 0 0", color: "#5b6474", fontSize: 14 }}>{t("admin.setup.text", { email, role })}</p>
      </div>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <label className="field">
          {t("admin.setup.password")}
          <input className="input input-lg" type="password" autoComplete="new-password" value={password} onChange={(e) => (setPassword(e.target.value), setError(null))} autoFocus />
          <span className="field-label">{t("admin.setup.passwordHint")}</span>
        </label>
        <label className="field">
          {t("admin.setup.confirm")}
          <input className="input input-lg" type="password" autoComplete="new-password" value={confirm} onChange={(e) => (setConfirm(e.target.value), setError(null))} />
        </label>
        <div style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 9, background: "#fcf5f7", fontSize: 13, color: "#7a1f3d" }}>
          <Icon name="Fingerprint" size={18} style={{ flex: "none" }} />
          <span>{t("admin.setup.passkeyNote")}</span>
        </div>
        {error ? (
          <div className="banner banner-error" role="alert">
            <Icon name="WarningCircle" size={17} />
            {error}
          </div>
        ) : null}
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? <Icon name="CircleNotch" size={17} className="spin" /> : <Icon name="Fingerprint" size={18} />}
          {t("admin.setup.submit")}
        </button>
      </form>
    </>
  );
}
