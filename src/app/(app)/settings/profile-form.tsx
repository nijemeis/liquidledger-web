"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { useAction, SubmitButton } from "@/components/client";
import { Icon } from "@/components/icon";
import { resetSidebar, updateProfile } from "./actions";

export function ProfileForm({ name: initialName, email, locale: initialLocale, locales }: { name: string; email: string; locale: string; locales: { code: string; label: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [locale, setLocale] = useState(initialLocale);
  const [run, pending] = useAction(updateProfile, { onDone: (r) => r.ok && locale !== initialLocale && router.refresh() });
  const dirty = name.trim() !== initialName || locale !== initialLocale;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run({ name, locale });
      }}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div className="form-grid">
        <label className="field">
          {t("settings.profile.name")}
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" required />
        </label>
        <label className="field">
          {t("settings.profile.email")}
          <input className="input" value={email} readOnly disabled style={{ background: "#f9fafb", color: "#5b6474" }} />
          <span className="field-label">{t("settings.profile.emailHint")}</span>
        </label>
        <label className="field">
          {t("settings.profile.language")}
          <select className="select" value={locale} onChange={(e) => setLocale(e.target.value)}>
            {locales.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code.toUpperCase()} · {l.label}
              </option>
            ))}
          </select>
          <span className="field-label">{t("settings.profile.languageHint")}</span>
        </label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <SubmitButton pending={pending} disabled={!dirty || !name.trim()} icon="Check">
          {t("common.save")}
        </SubmitButton>
      </div>
    </form>
  );
}

export function SidebarReset({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const [run, pending] = useAction(resetSidebar);
  return (
    <button className="btn btn-sm" disabled={disabled || pending} onClick={() => run()}>
      <Icon name="ArrowCounterClockwise" size={15} />
      {t("settings.profile.sidebarResetBtn")}
    </button>
  );
}
