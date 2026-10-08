"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { Icon } from "./icon";
import { DEFAULT_PERIOD, periodChoices, resolvePeriod } from "@/lib/period";

/**
 * Period picker for list screens. Writes ?period= (default: this financial
 * year) and keeps the other URL state, except an open detail (?id=) and paging.
 */
export function PeriodSelect({ value, fiscalYearStart = 1, param = "period", reset = [] }: { value: string; fiscalYearStart?: number; param?: string; reset?: string[] }) {
  const { t, fmt } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const choices = periodChoices(fiscalYearStart);
  const label = (key: string) => {
    const p = resolvePeriod(key, fiscalYearStart);
    switch (p.kind) {
      case "year":
        return t("common.period.year", { year: p.year! });
      case "lastyear":
        return t("common.period.lastYear", { year: p.year! });
      case "30d":
        return t("common.period.d30");
      case "90d":
        return t("common.period.d90");
      case "all":
        return t("common.period.all");
      case "month":
        return fmt.monthLong(p.month!);
    }
  };
  const go = (key: string) => {
    const q = new URLSearchParams(sp.toString());
    if (key === DEFAULT_PERIOD) q.delete(param);
    else q.set(param, key);
    q.delete("id");
    q.delete("page");
    for (const r of reset) q.delete(r);
    const s = q.toString();
    router.push(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
  };
  // A month outside the offered range (from a link) still shows as selected.
  const offered = [...choices.quick, ...choices.months.flatMap((g) => g.keys), ...choices.older];
  return (
    <label className="period-select" style={{ display: "inline-flex", alignItems: "center", gap: 6, position: "relative" }}>
      <Icon name="CalendarBlank" size={16} color="#5b6474" style={{ position: "absolute", left: 10, pointerEvents: "none" }} />
      <span className="sr-only">{t("common.period.label")}</span>
      <select className="select" value={value} onChange={(e) => go(e.target.value)} style={{ paddingLeft: 32, width: "auto", minWidth: 190, textTransform: "none" }}>
        {offered.includes(value) ? null : <option value={value}>{label(value)}</option>}
        {choices.quick.map((k) => (
          <option key={k} value={k}>
            {label(k)}
          </option>
        ))}
        {choices.months.map((g) => (
          <optgroup key={g.year} label={t("common.period.monthsOf", { year: g.year })}>
            {g.keys.map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </optgroup>
        ))}
        <optgroup label="—">
          {choices.older.map((k) => (
            <option key={k} value={k}>
              {label(k)}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
