"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { useI18n } from "@/i18n/client";
import { Icon, type IconName } from "@/components/icon";
import { CodeBoxes, type CodeBoxesHandle } from "@/components/code-boxes";
import { useToast } from "@/components/client";
import { EnrollFlow } from "./enroll-flow";
import { authPost, type LoginResponse, type MfaMethods } from "./api";

type Step = "creds" | "mfa" | "enroll" | "done";
type Method = "app" | "sms" | "recovery" | "passkey";

const METHOD_ICON: Record<Method, IconName> = { app: "DeviceMobile", sms: "ChatText", recovery: "Key", passkey: "Fingerprint" };

export function LoginFlow({ notice }: { notice: "reset" | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const [step, setStep] = useState<Step>("creds");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [methods, setMethods] = useState<MfaMethods | null>(null);
  const [method, setMethod] = useState<Method>("app");
  const [trust, setTrust] = useState(true);
  const [otpErr, setOtpErr] = useState(false);
  const [shake, setShake] = useState(0);
  const [recovery, setRecovery] = useState("");
  const [code, setCode] = useState("");
  const [done, setDone] = useState<{ redirect: string; name: string; company: string | null; trusted?: boolean } | null>(null);
  const boxes = useRef<CodeBoxesHandle>(null);

  const errorText = (r: Extract<LoginResponse, { ok: false }>) => {
    switch (r.error) {
      case "missing":
        return t("auth.credErr");
      case "invalid":
        return t("auth.credInvalid");
      case "locked":
        return r.minutes ? t("auth.locked", { minutes: r.minutes }) : t("auth.lockedIndef");
      case "throttled":
        return t("auth.throttled");
      case "expired":
        return t("auth.expired");
      default:
        return t("auth.serverError");
    }
  };

  const handle = (r: LoginResponse) => {
    if (!r.ok) {
      if (r.error === "code") {
        setOtpErr(true);
        setShake((s) => s + 1);
        setCode("");
        boxes.current?.clear();
        return;
      }
      if (r.error === "expired" || r.error === "locked") setStep("creds");
      setError(errorText(r));
      return;
    }
    setError(null);
    if (r.next === "done") {
      setDone(r);
      setStep("done");
    } else if (r.next === "enroll") setStep("enroll");
    else if (r.next === "mfa") {
      setMethods(r.methods);
      const first: Method = r.methods.totp ? "app" : r.methods.passkey ? "passkey" : r.methods.sms ? "sms" : "recovery";
      pickMethod(first, r.methods);
      setStep("mfa");
    }
  };

  async function submitCreds(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return setError(t("auth.credErr"));
    setBusy(true);
    handle(await authPost("login", { email, password }));
    setBusy(false);
  }

  async function passkeyLogin() {
    setError(null);
    if (!browserSupportsWebAuthn()) return setError(t("auth.passkeyUnsupported"));
    setBusy(true);
    try {
      const o = await authPost<{ ok: boolean; options?: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("passkey-options");
      if (!o.ok || !o.options) throw new Error();
      const response = await startAuthentication({ optionsJSON: o.options });
      handle(await authPost("passkey", { response }));
    } catch {
      setError(t("auth.passkeyFailed"));
    }
    setBusy(false);
  }

  async function verify(code: string) {
    if (busy) return;
    setBusy(true);
    setOtpErr(false);
    const action = method === "sms" ? "sms" : method === "recovery" ? "recovery" : "totp";
    handle(await authPost(action, { code, trust }));
    setBusy(false);
  }

  async function passkeyMfa() {
    setBusy(true);
    setError(null);
    try {
      const o = await authPost<{ ok: boolean; options?: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("mfa-passkey-options");
      if (!o.ok || !o.options) throw new Error();
      const response = await startAuthentication({ optionsJSON: o.options });
      handle(await authPost("mfa-passkey", { response, trust }));
    } catch {
      setError(t("auth.passkeyFailed"));
    }
    setBusy(false);
  }

  async function pickMethod(m: Method, ms = methods) {
    setMethod(m);
    setOtpErr(false);
    setError(null);
    setRecovery("");
    setCode("");
    boxes.current?.clear();
    if (m === "sms" && ms?.sms) {
      const r = await authPost<{ ok: boolean; phone?: string; error?: string }>("sms-send");
      if (r.ok) toast(t("auth.sms", { phone: r.phone ?? ms.sms }), "info");
      else setError(r.error === "expired" ? t("auth.expired") : t("auth.smsUnavailable"));
    }
  }

  // ── Step 1 ────────────────────────────────────────────────────────────────
  if (step === "creds") {
    return (
      <>
        <div>
          <div style={{ fontSize: 13, color: "#7a1f3d", fontWeight: 500, marginBottom: 6 }}>{t("auth.step1")}</div>
          <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{t("auth.signIn")}</h1>
          <p style={{ margin: "6px 0 0", color: "#5b6474", fontSize: 14.5 }}>{t("auth.welcome")}</p>
        </div>
        {notice === "reset" ? (
          <div className="banner banner-ok">
            <Icon name="CheckCircle" size={17} />
            {t("auth.resetDone")}
          </div>
        ) : null}
        <form onSubmit={submitCreds} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
          <label className="field">
            {t("auth.email")}
            <input className="input input-lg" type="email" autoComplete="username webauthn" value={email} onChange={(e) => (setEmail(e.target.value), setError(null))} />
          </label>
          <label className="field">
            <span style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              {t("auth.password")}
              <Link href="/forgot" style={{ fontWeight: 500 }}>
                {t("auth.forgot")}
              </Link>
            </span>
            <span style={{ position: "relative", display: "block" }}>
              <input
                className="input input-lg"
                style={{ paddingRight: 44 }}
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => (setPassword(e.target.value), setError(null))}
              />
              <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={t("auth.show")} className="btn btn-icon" style={{ position: "absolute", right: 6, top: 6, width: 32, height: 32 }}>
                <Icon name={showPw ? "EyeSlash" : "Eye"} size={18} color="#5b6474" />
              </button>
            </span>
          </label>
          {error ? (
            <div className="banner banner-error" role="alert">
              <Icon name="WarningCircle" size={17} />
              {error}
            </div>
          ) : null}
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy} style={{ marginTop: 4 }}>
            {busy ? <Icon name="CircleNotch" size={17} className="spin" /> : null}
            {t("auth.continue")}
            <Icon name="ArrowRight" size={17} />
          </button>
        </form>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#8a93a3", fontSize: 12.5 }}>
          <span style={{ flex: 1, height: 1, background: "#e4e7ec" }} />
          {t("auth.or")}
          <span style={{ flex: 1, height: 1, background: "#e4e7ec" }} />
        </div>
        <button onClick={passkeyLogin} className="btn" disabled={busy} style={{ height: 44, borderRadius: 9, fontSize: 14.5, gap: 8 }}>
          <Icon name="Fingerprint" size={19} color="#7a1f3d" />
          {t("auth.passkey")}
        </button>
        <div style={{ fontSize: 13, color: "#5b6474", textAlign: "center" }}>
          {t("auth.noAccount")}{" "}
          <Link href="/signup" style={{ fontWeight: 600 }}>
            {t("auth.trial")}
          </Link>
        </div>
      </>
    );
  }

  // ── Enrolment ─────────────────────────────────────────────────────────────
  if (step === "enroll") {
    return (
      <EnrollFlow
        onBack={() => setStep("creds")}
        onDone={(redirect) => {
          window.location.href = redirect;
        }}
      />
    );
  }

  // ── Step 3 ────────────────────────────────────────────────────────────────
  if (step === "done" && done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14 }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#e6f6ee", color: "#157347", display: "grid", placeItems: "center" }}>
          <Icon name="CheckCircle" size={32} />
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{t("auth.doneTitle")}</h1>
        <p style={{ margin: 0, color: "#5b6474", fontSize: 14.5 }}>
          {done.company ? t("auth.done", { name: done.name, company: done.company }) : t("auth.doneNoCompany", { name: done.name })}
          {done.trusted ? ` · ${t("auth.trust").toLowerCase()} ✓` : ""}
        </p>
        <a href={done.redirect} className="btn btn-primary btn-lg" style={{ marginTop: 6 }} autoFocus>
          {t("auth.open")}
          <Icon name="ArrowRight" size={17} />
        </a>
      </div>
    );
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────
  const ms = methods ?? { totp: true, passkey: false, sms: null, recovery: true };
  const others = (["app", "passkey", "sms", "recovery"] as Method[]).filter(
    (m) => m !== method && ((m === "app" && ms.totp) || (m === "passkey" && ms.passkey) || (m === "sms" && ms.sms) || (m === "recovery" && ms.recovery)),
  );
  const otherLabel = (m: Method) => (m === "app" ? t("auth.useApp") : m === "sms" ? t("auth.useSms", { phone: ms.sms ?? "" }) : m === "passkey" ? t("auth.usePasskey") : t("auth.useRecovery"));
  const methodText = method === "app" ? t("auth.app") : method === "sms" ? t("auth.sms", { phone: ms.sms ?? "" }) : method === "passkey" ? t("auth.passkeyText") : t("auth.recovery");

  return (
    <>
      <div>
        <button onClick={() => (setStep("creds"), setError(null))} className="btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: 0, marginBottom: 14, border: 0, background: "none", fontSize: 13, color: "#5b6474" }}>
          <Icon name="ArrowLeft" />
          {t("auth.back")}
        </button>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: "#f9eef2", color: "#7a1f3d", display: "grid", placeItems: "center", marginBottom: 14 }}>
          <Icon name={METHOD_ICON[method]} size={25} />
        </div>
        <div style={{ fontSize: 13, color: "#7a1f3d", fontWeight: 500, marginBottom: 6 }}>{t("auth.step2")}</div>
        <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>{method === "passkey" ? t("auth.passkeyTitle") : t("auth.twoTitle")}</h1>
        <p style={{ margin: "6px 0 0", color: "#5b6474", fontSize: 14.5 }}>{methodText}</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (method === "recovery") verify(recovery);
          else if (method === "passkey") passkeyMfa();
          else if (code.length === 6) verify(code);
        }}
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {method === "app" || method === "sms" ? (
          <CodeBoxes ref={boxes} key={method} label={t("auth.digit")} error={otpErr} shakeKey={shake} disabled={busy} onComplete={verify} onChange={(c) => (setCode(c), setOtpErr(false))} />
        ) : method === "recovery" ? (
          <input
            className="input input-lg n"
            autoFocus
            autoComplete="one-time-code"
            placeholder={t("auth.recoveryPlaceholder")}
            value={recovery}
            onChange={(e) => (setRecovery(e.target.value), setOtpErr(false))}
            aria-invalid={otpErr}
            style={{ letterSpacing: "0.08em", animation: otpErr ? "ll-shake 0.4s both" : "none" }}
            key={shake}
          />
        ) : null}
        {otpErr ? (
          <div className="banner banner-error" role="alert">
            <Icon name="WarningCircle" size={17} />
            {method === "recovery" ? t("auth.recoveryErr") : t("auth.otpErr")}
          </div>
        ) : null}
        {error ? (
          <div className="banner banner-error" role="alert">
            <Icon name="WarningCircle" size={17} />
            {error}
          </div>
        ) : null}
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, color: "#3a4250", cursor: "pointer" }}>
          <input type="checkbox" className="checkbox" checked={trust} onChange={() => setTrust((v) => !v)} style={{ marginTop: 1 }} />
          <span>{t("auth.trust")}</span>
        </label>
        {method === "passkey" ? (
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            <Icon name="Fingerprint" size={18} />
            {t("auth.usePasskey")}
          </button>
        ) : method === "recovery" ? (
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy || recovery.replace(/\W/g, "").length < 12}>
            <Icon name="ShieldCheck" size={18} />
            {busy ? t("auth.verifying") : t("auth.verify")}
          </button>
        ) : (
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy || code.length < 6} style={{ opacity: busy || code.length === 6 ? 1 : 0.55 }}>
            <Icon name="ShieldCheck" size={18} />
            {busy ? t("auth.verifying") : t("auth.verify")}
          </button>
        )}
      </form>

      {others.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
          <div style={{ fontSize: 12.5, color: "#8a93a3", marginBottom: 4 }}>{t("auth.otherWay")}</div>
          {others.map((m) => (
            <button key={m} onClick={() => pickMethod(m)} className="menu-item brand" style={{ padding: "9px 10px", borderRadius: 8 }}>
              <Icon name={METHOD_ICON[m]} size={18} color="#7a1f3d" />
              <span style={{ flex: 1 }}>{otherLabel(m)}</span>
              <Icon name="CaretRight" color="#8a93a3" />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
