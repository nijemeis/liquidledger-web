"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dropdown } from "@/components/client";
import { Icon } from "@/components/icon";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/config";
import { setLanguageCookie } from "./actions";

export function AuthLanguage({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <Dropdown
      width={210}
      trigger={(_, toggle) => (
        <button onClick={toggle} aria-label={label} className="btn" style={{ padding: "0 10px", fontSize: 13.5, fontWeight: 600 }}>
          <Icon name="GlobeSimple" size={17} color="#7a1f3d" />
          {locale.toUpperCase()}
          <Icon name="CaretDown" size={12} color="#5b6474" />
        </button>
      )}
    >
      {(close) =>
        LOCALES.map((l) => (
          <button
            key={l}
            className="menu-item brand"
            aria-checked={l === locale}
            onClick={() => {
              close();
              start(async () => {
                await setLanguageCookie(l);
                router.refresh();
              });
            }}
          >
            <span style={{ width: 26, fontSize: 12, fontWeight: 600, color: "#7a1f3d" }}>{l.toUpperCase()}</span>
            <span style={{ flex: 1 }}>{LOCALE_NAMES[l]}</span>
          </button>
        ))
      }
    </Dropdown>
  );
}
