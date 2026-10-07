"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";
import { AuthHead, ErrorBanner } from "../reset/auth-bits";
import { lockAction } from "./actions";

export function LockConfirm({ token }: { token: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14 }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#e6f6ee", color: "#157347", display: "grid", placeItems: "center" }}>
          <Icon name="LockSimple" size={30} />
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>{t("auth.lockDoneTitle")}</h1>
        <p style={{ margin: 0, color: "#3a4250", fontSize: 14.5 }}>{t("auth.lockDone")}</p>
        <Link href="/forgot" className="btn btn-primary btn-lg" style={{ marginTop: 6 }}>
          {t("auth.goReset")}
          <Icon name="ArrowRight" size={17} />
        </Link>
      </div>
    );
  }

  return (
    <>
      <div>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: "#fdebea", color: "#b42318", display: "grid", placeItems: "center", marginBottom: 14 }}>
          <Icon name="ShieldWarning" size={25} />
        </div>
        <AuthHead step={t("auth.lockStep")} title={t("auth.lockTitle")} text={t("auth.lockText")} />
      </div>
      <ErrorBanner>{error}</ErrorBanner>
      <button
        className="btn btn-lg"
        disabled={busy}
        style={{ background: "#b42318", borderColor: "#b42318", color: "#fff" }}
        onClick={() =>
          start(async () => {
            const r = await lockAction({ token }).catch(() => ({ ok: false }));
            if (r.ok) setDone(true);
            else setError(t("auth.linkInvalid"));
          })
        }
      >
        {busy ? <Icon name="CircleNotch" size={17} className="spin" /> : <Icon name="LockSimple" size={17} />}
        {t("auth.lockConfirm")}
      </button>
      <Link href="/login" className="btn btn-lg">
        {t("auth.backToSignIn")}
      </Link>
    </>
  );
}
