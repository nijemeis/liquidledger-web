"use client";
import { useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";
import { AuthHead } from "../reset/auth-bits";
import { noAccessSignOut } from "./actions";

export function NoAccess({ email }: { email: string }) {
  const { t } = useI18n();
  const [busy, start] = useTransition();
  return (
    <>
      <AuthHead step={`${t("auth.noAccessStep")} · ${email}`} title={t("auth.noAccessTitle")} text={t("auth.noAccessText")} icon="Buildings" />
      <div className="banner banner-info">
        <Icon name="Info" size={17} />
        {t("auth.noAccessHint")}
      </div>
      <button
        className="btn btn-primary btn-lg"
        disabled={busy}
        onClick={() =>
          start(async () => {
            await noAccessSignOut();
            window.location.href = "/login";
          })
        }
      >
        <Icon name="SignOut" size={17} />
        {t("common.signOut")}
      </button>
    </>
  );
}
