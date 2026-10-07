"use client";
// Small building blocks shared by the forgot / reset / invite / signup / lock screens.
import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { Icon, type IconName } from "@/components/icon";

export function AuthHead({ step, title, text, icon, back }: { step?: string; title: string; text?: React.ReactNode; icon?: IconName; back?: { href: string; label: string } }) {
  return (
    <div>
      {back ? (
        <Link href={back.href} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 14, fontSize: 13, color: "#5b6474" }}>
          <Icon name="ArrowLeft" />
          {back.label}
        </Link>
      ) : null}
      {icon ? (
        <div style={{ width: 48, height: 48, borderRadius: 12, background: "#f9eef2", color: "#7a1f3d", display: "grid", placeItems: "center", marginBottom: 14 }}>
          <Icon name={icon} size={25} />
        </div>
      ) : null}
      {step ? <div style={{ fontSize: 13, color: "#7a1f3d", fontWeight: 500, marginBottom: 6 }}>{step}</div> : null}
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{title}</h1>
      {text ? <p style={{ margin: "6px 0 0", color: "#5b6474", fontSize: 14.5 }}>{text}</p> : null}
    </div>
  );
}

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="banner banner-error" role="alert">
      <Icon name="WarningCircle" size={17} />
      {children}
    </div>
  );
}

export function PasswordInput({ value, onChange, autoComplete = "new-password", label, autoFocus }: { value: string; onChange: (v: string) => void; autoComplete?: string; label: string; autoFocus?: boolean }) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      {label}
      <span style={{ position: "relative", display: "block" }}>
        <input
          className="input input-lg"
          style={{ paddingRight: 44 }}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          autoFocus={autoFocus}
          maxLength={200}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={t("auth.show")} className="btn btn-icon" style={{ position: "absolute", right: 6, top: 6, width: 32, height: 32 }}>
          <Icon name={show ? "EyeSlash" : "Eye"} size={18} color="#5b6474" />
        </button>
      </span>
    </label>
  );
}

/** Live hint: length meter for the 12-character minimum. */
export function PasswordMeter({ password }: { password: string }) {
  const { t } = useI18n();
  const n = Math.min(password.length, 16);
  const ok = password.length >= 12;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: -4 }}>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: "#eef0f3", overflow: "hidden" }}>
        <div style={{ width: `${(n / 16) * 100}%`, height: "100%", background: ok ? "#1aa364" : password.length >= 8 ? "#e0a100" : "#e5484d", transition: "width .15s" }} />
      </div>
      <span style={{ fontSize: 12, color: ok ? "#157347" : "#8a93a3", whiteSpace: "nowrap" }}>{ok ? <Icon name="Check" size={12} /> : null} {t("auth.pwShort")}</span>
    </div>
  );
}

export function SentState({ title, text, note, cta }: { title: string; text: string; note?: string; cta: { href: string; label: string } }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14 }}>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#e6f6ee", color: "#157347", display: "grid", placeItems: "center" }}>
        <Icon name="EnvelopeSimple" size={30} />
      </div>
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{title}</h1>
      <p style={{ margin: 0, color: "#3a4250", fontSize: 14.5 }}>{text}</p>
      {note ? <p style={{ margin: 0, color: "#5b6474", fontSize: 13 }}>{note}</p> : null}
      <Link href={cta.href} className="btn btn-lg" style={{ marginTop: 6 }}>
        <Icon name="ArrowLeft" size={17} />
        {cta.label}
      </Link>
    </div>
  );
}
