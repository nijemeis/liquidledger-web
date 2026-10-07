"use client";
import { useState } from "react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";
import { adminAuthPost, type AdminAuthResponse } from "../auth-api";

type Options = Parameters<typeof startAuthentication>[0]["optionsJSON"];

export function StaffLogin() {
  const { t } = useI18n();
  const [step, setStep] = useState<"creds" | "passkey">("creds");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);

  const errorText = (r: AdminAuthResponse) => {
    switch (r.error) {
      case "missing":
        return t("admin.auth.missing");
      case "invalid":
        return t("admin.auth.invalid");
      case "locked":
        return t("admin.auth.locked", { minutes: r.minutes ?? 15 });
      case "throttled":
        return t("admin.auth.throttled");
      case "expired":
        return t("admin.auth.expired");
      case "no_passkey":
        return t("admin.auth.noPasskey");
      case "passkey":
        return t("admin.auth.passkeyFailed");
      case "ip":
        return t("admin.ip.title");
      default:
        return t("admin.auth.server");
    }
  };

  const finish = (r: AdminAuthResponse) => {
    if (r.ok && r.next === "done") {
      window.location.href = r.redirect ?? "/admin";
      return true;
    }
    return false;
  };

  async function runPasskey(opts: Options) {
    setBusy(true);
    setError(null);
    try {
      const response = await startAuthentication({ optionsJSON: opts });
      const r = await adminAuthPost("passkey", { response });
      if (finish(r)) return;
      setError(errorText(r));
      if (r.error === "expired" || r.error === "locked" || r.error === "passkey" || r.error === "invalid") {
        setStep("creds");
        setPassword("");
      }
    } catch {
      setError(t("admin.auth.passkeyCancelled"));
    }
    setBusy(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return setError(t("admin.auth.missing"));
    if (!browserSupportsWebAuthn()) return setError(t("admin.auth.unsupported"));
    setBusy(true);
    setError(null);
    const r = await adminAuthPost("login", { email, password });
    setBusy(false);
    if (r.ok && r.next === "passkey" && r.options) {
      setOptions(r.options as Options);
      setStep("passkey");
      void runPasskey(r.options as Options);
      return;
    }
    if (!finish(r)) setError(errorText(r));
  }

  async function passkeyOnly() {
    setError(null);
    if (!browserSupportsWebAuthn()) return setError(t("admin.auth.unsupported"));
    setBusy(true);
    try {
      const o = await adminAuthPost<{ ok: boolean; options?: Options; error?: string }>("passkey-login-options");
      if (!o.ok || !o.options) {
        setError(errorText(o));
        setBusy(false);
        return;
      }
      const response = await startAuthentication({ optionsJSON: o.options });
      const r = await adminAuthPost("passkey-login", { response });
      if (finish(r)) return;
      setError(errorText(r));
    } catch {
      setError(t("admin.auth.passkeyCancelled"));
    }
    setBusy(false);
  }

  const banner = error ? (
    <div className="banner banner-error" role="alert">
      <Icon name="WarningCircle" size={17} />
      {error}
    </div>
  ) : null;

  if (step === "passkey") {
    return (
      <>
        <div>
          <button onClick={() => (setStep("creds"), setError(null))} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: 0, marginBottom: 14, border: 0, background: "none", fontSize: 13, color: "#5b6474" }}>
            <Icon name="ArrowLeft" />
            {t("common.back")}
          </button>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "#f9eef2", color: "#7a1f3d", display: "grid", placeItems: "center", marginBottom: 14 }}>
            <Icon name="Fingerprint" size={25} />
          </div>
          <div style={{ fontSize: 13, color: "#7a1f3d", fontWeight: 500, marginBottom: 6 }}>{t("admin.auth.step2")}</div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>{t("admin.auth.passkeyTitle")}</h1>
          <p style={{ margin: "6px 0 0", color: "#5b6474", fontSize: 14 }}>{t("admin.auth.passkeyText")}</p>
        </div>
        {banner}
        <button className="btn btn-primary btn-lg" disabled={busy || !options} onClick={() => options && runPasskey(options)}>
          {busy ? <Icon name="CircleNotch" size={17} className="spin" /> : <Icon name="Fingerprint" size={18} />}
          {busy ? t("admin.auth.waiting") : t("admin.auth.usePasskey")}
        </button>
      </>
    );
  }

  return (
    <>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>{t("admin.auth.title")}</h1>
        <p style={{ margin: "6px 0 0", color: "#5b6474", fontSize: 14 }}>{t("admin.auth.subtitle")}</p>
      </div>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
        <label className="field">
          {t("admin.auth.email")}
          <input className="input input-lg" type="email" autoComplete="username webauthn" value={email} onChange={(e) => (setEmail(e.target.value), setError(null))} autoFocus />
        </label>
        <label className="field">
          {t("admin.auth.password")}
          <span style={{ position: "relative", display: "block" }}>
            <input
              className="input input-lg"
              style={{ paddingRight: 44, width: "100%" }}
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => (setPassword(e.target.value), setError(null))}
            />
            <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={t("admin.auth.show")} className="btn btn-icon" style={{ position: "absolute", right: 6, top: 6, width: 32, height: 32 }}>
              <Icon name={showPw ? "EyeSlash" : "Eye"} size={18} color="#5b6474" />
            </button>
          </span>
        </label>
        {banner}
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? <Icon name="CircleNotch" size={17} className="spin" /> : null}
          {t("admin.auth.continue")}
          <Icon name="ArrowRight" size={17} />
        </button>
      </form>
      <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#8a93a3", fontSize: 12.5 }}>
        <span style={{ flex: 1, height: 1, background: "#e4e7ec" }} />
        {t("admin.auth.or")}
        <span style={{ flex: 1, height: 1, background: "#e4e7ec" }} />
      </div>
      <button onClick={passkeyOnly} className="btn" disabled={busy} style={{ height: 44, borderRadius: 9, fontSize: 14.5, gap: 8 }}>
        <Icon name="Fingerprint" size={19} color="#7a1f3d" />
        {t("admin.auth.passkeyLogin")}
      </button>
      <div style={{ display: "flex", gap: 8, fontSize: 12.5, color: "#5b6474" }}>
        <Icon name="Info" size={16} color="#8a93a3" style={{ marginTop: 1 }} />
        {t("admin.auth.lostPasskey")}
      </div>
    </>
  );
}
