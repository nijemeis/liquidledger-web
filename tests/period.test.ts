import { describe, expect, it } from "vitest";
import { dateWhere, inPeriod, periodChoices, resolvePeriod } from "@/lib/period";

const now = new Date("2026-10-08T10:00:00Z");
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("period filter", () => {
  it("defaults to this financial year", () => {
    const p = resolvePeriod(undefined, 1, now);
    expect(p).toMatchObject({ key: "year", kind: "year", year: 2026 });
    expect(p.from).toEqual(d("2026-01-01"));
    expect(p.to).toEqual(d("2026-12-31"));
  });
  it("follows a financial year that starts in July", () => {
    const p = resolvePeriod("year", 7, now);
    expect(p.from).toEqual(d("2026-07-01"));
    expect(p.to).toEqual(d("2027-06-30"));
    const last = resolvePeriod("lastyear", 7, now);
    expect(last.from).toEqual(d("2025-07-01"));
    expect(last.to).toEqual(d("2026-06-30"));
  });
  it("handles rolling days, months and all time", () => {
    expect(resolvePeriod("30d", 1, now).from).toEqual(d("2026-09-09"));
    expect(resolvePeriod("90d", 1, now).from).toEqual(d("2026-07-11"));
    const m = resolvePeriod("m2026-02", 1, now);
    expect([m.from, m.to]).toEqual([d("2026-02-01"), d("2026-02-28")]);
    expect(resolvePeriod("all", 1, now)).toMatchObject({ from: null, to: null });
    expect(dateWhere(resolvePeriod("all", 1, now))).toBeUndefined();
    expect(resolvePeriod("nonsense", 1, now).key).toBe("year");
  });
  it("includes the whole last day", () => {
    const p = resolvePeriod("m2026-09", 1, now);
    expect(inPeriod(p, new Date("2026-09-30T23:30:00Z"))).toBe(true);
    expect(inPeriod(p, d("2026-10-01"))).toBe(false);
  });
  it("offers this and last year's months, newest first", () => {
    const c = periodChoices(1, now);
    expect(c.months[0]).toMatchObject({ year: 2026 });
    expect(c.months[0]!.keys[0]).toBe("m2026-10");
    expect(c.months[0]!.keys.at(-1)).toBe("m2026-01");
    expect(c.months[1]!.keys).toHaveLength(12);
  });
});
