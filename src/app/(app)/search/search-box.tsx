"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";

export function SearchBox({ q }: { q: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [v, setV] = useState(q);
  return (
    <form
      role="search"
      className="search"
      style={{ maxWidth: 640, height: 44, borderRadius: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/search?q=${encodeURIComponent(v.trim())}`);
      }}
    >
      <Icon name="MagnifyingGlass" size={18} />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={t("common.search")} aria-label={t("common.search_")} autoFocus={!q} style={{ fontSize: 15 }} />
      <button type="submit" className="btn btn-sm btn-primary">{t("common.search_")}</button>
    </form>
  );
}
