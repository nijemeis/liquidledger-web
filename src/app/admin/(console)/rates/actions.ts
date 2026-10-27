"use server";
import { z } from "zod";
import type { ExciseBasis, ProductCategory } from "@prisma/client";
import { prisma, withSystem } from "@/lib/db";
import { AdminError, auditStaff, staffAction, type StaffContext } from "@/lib/admin/staff";
import { COUNTRIES } from "@/lib/domain/setup";
import { bandLabel, bandsOverlap } from "@/lib/domain/excise";
import { parseMoney } from "@/lib/format";

// Excise rates are versions: per country and category, all bands with the same
// valid_from form one version, and the latest version on or before a date
// applies. A version that hasn't started yet can be edited or deleted freely.
// One that is (or was) in force can be corrected only with a reason and only
// while no administration in that country has filed an excise return for a
// period it covers — after that, add a new version instead. Booked documents
// keep the excise they were booked with either way.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const band = z.object({
  basis: z.enum(["HL_PRODUCT", "HL_PER_ABV", "HL_PER_PLATO", "HL_PURE_ALCOHOL", "NONE"]),
  rate: z.string().max(20),
  abvMin: z.string().max(10).optional().default(""),
  abvMax: z.string().max(10).optional().default(""),
  platoMin: z.string().max(10).optional().default(""),
  platoMax: z.string().max(10).optional().default(""),
  sparkling: z.enum(["any", "still", "sparkling"]).default("any"),
});
const versionSchema = z.object({
  country: z.string().refine((c) => c in COUNTRIES),
  category: z.enum(["WINE", "BEER", "SPIRITS", "FORTIFIED", "WATER", "SOFT"]),
  validFrom: z.string().regex(DAY),
  /** valid_from of the version being edited; absent when adding a new version. */
  replaces: z.string().regex(DAY).optional().nullable(),
  bands: z.array(band).min(1).max(12),
  note: z.string().trim().max(300).optional().default(""),
  reason: z.string().trim().max(300).optional().default(""),
});
const deleteSchema = z.object({
  country: z.string().refine((c) => c in COUNTRIES),
  category: z.enum(["WINE", "BEER", "SPIRITS", "FORTIFIED", "WATER", "SOFT"]),
  validFrom: z.string().regex(DAY),
  reason: z.string().trim().max(300).optional().default(""),
});

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
function todayUtc() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

/** "8,5" / "8.5" → 850 (hundredths); "" → null; NaN when unreadable. */
function hundredths(s: string, factor: number): number | null {
  const v = s.trim().replace(",", ".");
  if (!v) return null;
  if (!/^\d+(\.\d+)?$/.test(v)) return NaN;
  return Math.round(Number(v) * factor);
}

/**
 * Throws unless the dates between `from` and the next version (excluding the
 * one being replaced) may be recalculated: past dates need a reason and no
 * filed excise return in that window.
 */
async function assertChangeable(ctx: StaffContext, country: string, category: ProductCategory, from: Date, ignore: Date[], reason: string) {
  if (from > todayUtc()) return;
  if (reason.length < 5) throw new AdminError(ctx.t("admin.rates.reasonNeeded"));
  const next = await prisma.exciseRate.findFirst({
    where: { country, category, validFrom: { gt: from, notIn: ignore } },
    orderBy: { validFrom: "asc" },
    select: { validFrom: true },
  });
  const until = next ? new Date(next.validFrom.getTime() - 86_400_000) : null;
  const filed = await withSystem(async (tx) => {
    const admins = await tx.administration.findMany({ where: { country }, select: { id: true } });
    return tx.taxReturn.findFirst({
      where: {
        administrationId: { in: admins.map((a) => a.id) },
        type: "EXCISE",
        status: "FILED",
        periodEnd: { gte: from },
        ...(until ? { periodStart: { lte: until } } : {}),
      },
      orderBy: { periodEnd: "desc" },
      select: { periodStart: true, periodEnd: true },
    });
  });
  if (filed) throw new AdminError(ctx.t("admin.rates.filed", { from: iso(filed.periodStart), to: iso(filed.periodEnd) }));
}

const describe = (rows: { basis: ExciseBasis; rateCents: number; abvMinBp: number | null; abvMaxBp: number | null; platoMinTenths: number | null; platoMaxTenths: number | null; sparkling: boolean | null }[]) =>
  rows.map((r) => ({ band: bandLabel(r) || "all", basis: r.basis, rateCents: r.rateCents }));

export async function saveRateVersion(input: z.input<typeof versionSchema>) {
  return staffAction("rates.write", async (ctx) => {
    const v = versionSchema.safeParse(input);
    if (!v.success) throw new AdminError(ctx.t("admin.err.input"));
    const { country, category, note, reason } = v.data;
    const validFrom = day(v.data.validFrom);
    const replaces = v.data.replaces ? day(v.data.replaces) : null;
    if (Number.isNaN(validFrom.getTime()) || (replaces && Number.isNaN(replaces.getTime()))) throw new AdminError(ctx.t("admin.err.input"));

    // Bands → rows, validated.
    const rows = v.data.bands.map((b) => {
      const rateCents = b.basis === "NONE" ? 0 : parseMoney(b.rate);
      if (rateCents === null || rateCents < 0 || rateCents > 100_000_000) throw new AdminError(ctx.t("admin.rates.badRate"));
      const abvMinBp = hundredths(b.abvMin, 100);
      const abvMaxBp = hundredths(b.abvMax, 100);
      const platoMinTenths = hundredths(b.platoMin, 10);
      const platoMaxTenths = hundredths(b.platoMax, 10);
      for (const n of [abvMinBp, abvMaxBp, platoMinTenths, platoMaxTenths]) if (Number.isNaN(n) || (n !== null && (n < 0 || n > 100_000))) throw new AdminError(ctx.t("admin.rates.badBand"));
      if ((abvMinBp !== null && abvMaxBp !== null && abvMinBp >= abvMaxBp) || (platoMinTenths !== null && platoMaxTenths !== null && platoMinTenths >= platoMaxTenths))
        throw new AdminError(ctx.t("admin.rates.badBand"));
      return { basis: b.basis, rateCents, abvMinBp, abvMaxBp, platoMinTenths, platoMaxTenths, sparkling: b.sparkling === "any" ? null : b.sparkling === "sparkling" };
    });
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++)
        if (bandsOverlap(rows[i]!, rows[j]!)) throw new AdminError(ctx.t("admin.rates.overlap", { a: bandLabel(rows[i]!) || "—", b: bandLabel(rows[j]!) || "—" }));

    // Version bookkeeping and the history rules.
    if (!replaces || replaces.getTime() !== validFrom.getTime()) {
      const clash = await prisma.exciseRate.findFirst({ where: { country, category, validFrom } });
      if (clash) throw new AdminError(ctx.t("admin.rates.clash"));
    }
    const before = replaces ? await prisma.exciseRate.findMany({ where: { country, category, validFrom: replaces } }) : [];
    if (replaces && !before.length) throw new AdminError(ctx.t("admin.rates.gone"));
    const earliest = replaces && replaces < validFrom ? replaces : validFrom;
    await assertChangeable(ctx, country, category, earliest, replaces ? [replaces] : [], reason);

    await prisma.$transaction(async (tx) => {
      if (replaces) await tx.exciseRate.deleteMany({ where: { country, category, validFrom: replaces } });
      await tx.exciseRate.createMany({
        data: rows.map((r) => ({ country, category, validFrom, ...r, note: note || null, createdBy: ctx.staff.email })),
      });
    });
    const label = `${country} ${category.toLowerCase()}`;
    const correcting = earliest <= todayUtc();
    await auditStaff(ctx, {
      action: replaces ? (correcting ? "rates.correct" : "rates.edit") : "rates.update",
      summary: `${replaces ? (correcting ? "Corrected" : "Edited") : "Added"} ${label} excise rates effective ${iso(validFrom)} (${rows.length} band${rows.length === 1 ? "" : "s"})${reason ? ` — reason: ${reason}` : ""}`,
      targetType: "excise_rate",
      targetId: `${country}:${category}:${iso(validFrom)}`,
      before: replaces ? { validFrom: iso(replaces), bands: describe(before) } : undefined,
      after: { validFrom: iso(validFrom), bands: describe(rows), ...(reason ? { reason } : {}) },
    });
    return { message: ctx.t(replaces ? "admin.rates.saved" : "admin.rates.added", { what: label, date: ctx.fmt.dateMed(validFrom) }) };
  });
}

export async function deleteRateVersion(input: z.input<typeof deleteSchema>) {
  return staffAction("rates.write", async (ctx) => {
    const v = deleteSchema.safeParse(input);
    if (!v.success) throw new AdminError(ctx.t("admin.err.input"));
    const { country, category, reason } = v.data;
    const validFrom = day(v.data.validFrom);
    const rows = await prisma.exciseRate.findMany({ where: { country, category, validFrom } });
    if (!rows.length) throw new AdminError(ctx.t("admin.rates.gone"));
    await assertChangeable(ctx, country, category, validFrom, [validFrom], reason);
    await prisma.exciseRate.deleteMany({ where: { country, category, validFrom } });
    const label = `${country} ${category.toLowerCase()}`;
    await auditStaff(ctx, {
      action: "rates.delete",
      summary: `Deleted ${label} excise rates effective ${iso(validFrom)}${reason ? ` — reason: ${reason}` : ""}`,
      targetType: "excise_rate",
      targetId: `${country}:${category}:${iso(validFrom)}`,
      before: { validFrom: iso(validFrom), bands: describe(rows) },
      after: reason ? { reason } : undefined,
    });
    return { message: ctx.t("admin.rates.deleted", { what: label, date: ctx.fmt.dateMed(validFrom) }) };
  });
}
