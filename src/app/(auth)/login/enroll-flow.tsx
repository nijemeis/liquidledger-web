"use client";
import { useRef, useState } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";
import { CodeBoxes, type CodeBoxesHandle } from "@/components/code-boxes";
import { authPost } from "./api";
import { RecoveryCodes } from "@/components/recovery-codes";

type Stage = "choose" | "app" | "codes";

/** Mandatory 2FA set-up: passkey (recommended) or authenticator app, then recovery codes. */
export function EnrollFlow({ onBack, onDone }: { onBack: () => void; onDone: (redirect: string) => void }) {
  const { t } = useI18n();
  const [stage, setStage] = useState<Stage>("choose");
  const [qr, setQr] = useState<{ qr: string; secret: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [redirect, setRedirect] = useState("/dashboard");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otpErr, setOtpErr] = useState(false);
  const [shake, setShake] = useState(0);
  const boxes = useRef<CodeBoxesHandle>(null);

  async function startApp() {
    setBusy(true);
    setError(null);
    const r = await authPost<{ ok: boolean; qr?: string; secret?: string; error?: string }>("enroll-totp-start");
    setBusy(false);
    if (!r.ok || !r.qr) return setError(t("auth.expired"));
    setQr({ qr: r.qr, secret: r.secret! });
    setStage("app");
  }

  async function confirm(code: string) {
    setBusy(true);
    const r = await authPost<{ ok: boolean; codes?: string[]; redirect?: string; error?: string }>("enroll-totp", { code });
    setBusy(false);
    if (r.ok && r.codes) {
      setCodes(r.codes);
      setRedirect(r.redirect ?? "/dashboard");
      setStage("codes");
    } else if (r.error === "code") {
      setOtpErr(true);
      setShake((s) => s + 1);
      boxes.current?.clear();
    } else setError(t("auth.expired"));
  }

  async function passkey() {
    setError(null);
    if (!browserSupportsWebAuthn()) return setError(t("auth.passkeyUnsupported"));
    setBusy(true);
    try {
      const o = await authPost<{ ok: boolean; options?: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("enroll-passkey-options");
      if (!o.ok || !o.options) throw new Error("expired");
      const response = await startRegistration({ optionsJSON: o.options });
      const r = await authPost<{ ok: boolean; codes?: string[]; redirect?: string }>("enroll-passkey", { response });
      if (!r.ok || !r.codes) throw new Error();
      setCodes(r.codes);
      setRedirect(r.redirect ?? "/dashboard");
      setStage("codes");
    } catch {
      setError(t("auth.passkeyFailed"));
    }
    setBusy(false);
  }

  const head = (title: string, text: string, icon: Parameters<typeof Icon>[0]["name"]) => (
    <div>
      {stage !== "codes" ? (
        <button onClick={stage === "choose" ? onBack : () => setStage("choose")} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: 0, marginBottom: 14, border: 0, background: "none", fontSize: 13, color: "#5b6474" }}>
          <Icon name="ArrowLeft" />
          {t("auth.back")}
        </button>
      ) : null}
      <div style={{ width: 48, height: 48, borderRadius: 12, background: "#f9eef2", color: "#7a1f3d", display: "grid", placeItems: "center", marginBottom: 14 }}>
        <Icon name={icon} size={25} />
      </div>
      <div style={{ fontSize: 13, color: "#7a1f3d", fontWeight: 500, marginBottom: 6 }}>{t("auth.enrollStep")}</div>
      <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>{title}</h1>
      <p style={{ margin: "6px 0 0", color: "#5b6474", fontSize: 14.5 }}>{text}</p>
    </div>
  );

  const err = error ? (
    <div className="banner banner-error" role="alert">
      <Icon name="WarningCircle" size={17} />
      {error}
    </div>
  ) : null;

  if (stage === "codes") {
    return (
      <>
        {head(t("auth.codesTitle"), t("auth.codesText"), "Key")}
        <RecoveryCodes codes={codes} />
        <button className="btn btn-primary btn-lg" onClick={() => onDone(redirect)}>
          {t("auth.codesSaved")}
          <Icon name="ArrowRight" size={17} />
        </button>
      </>
    );
  }

  if (stage === "app" && qr) {
    return (
      <>
        {head(t("auth.scanTitle"), t("auth.scanText"), "QrCode")}
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.qr} alt="QR code" width={164} height={164} style={{ border: "1px solid #e4e7ec", borderRadius: 10 }} />
          <div style={{ flex: 1, minWidth: 160, fontSize: 12.5, color: "#5b6474" }}>
            {t("auth.manualKey")}
            <div className="n" style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#14171f", wordBreak: "break-all", userSelect: "all" }}>
              {qr.secret}
            </div>
          </div>
        </div>
        <CodeBoxes ref={boxes} label={t("auth.digit")} error={otpErr} shakeKey={shake} disabled={busy} onComplete={confirm} onChange={() => setOtpErr(false)} />
        {otpErr ? (
          <div className="banner banner-error" role="alert">
            <Icon name="WarningCircle" size={17} />
            {t("auth.otpErr")}
          </div>
        ) : null}
        {err}
      </>
    );
  }

  return (
    <>
      {head(t("auth.enrollTitle"), t("auth.enrollText"), "ShieldCheck")}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button className="select-card" onClick={passkey} disabled={busy} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Icon name="Fingerprint" size={24} color="#7a1f3d" />
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontWeight: 600 }}>{t("auth.enrollPasskey")}</span>
            <span style={{ display: "block", fontSize: 12.5, color: "#5b6474" }}>{t("auth.enrollPasskeyText")}</span>
          </span>
          <Icon name="CaretRight" color="#8a93a3" />
        </button>
        <button className="select-card" onClick={startApp} disabled={busy} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Icon name="DeviceMobile" size={24} color="#7a1f3d" />
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontWeight: 600 }}>{t("auth.enrollApp")}</span>
            <span style={{ display: "block", fontSize: 12.5, color: "#5b6474" }}>{t("auth.enrollAppText")}</span>
          </span>
          <Icon name="CaretRight" color="#8a93a3" />
        </button>
      </div>
      {err}
    </>
  );
}
