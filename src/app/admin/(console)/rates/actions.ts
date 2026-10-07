"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AdminError, auditStaff, staffAction } from "@/lib/admin/staff";
import { COUNTRIES } from "@/lib/domain/setup";
import { parseMoney } from "@/lib/format";

const schema = z.object({
  country: z.string().refine((c) => c in COUNTRIES),
  category: z.enum(["WINE", "BEER", "SPIRITS", "FORTIFIED", "WATER", "SOFT"]),
  basis: z.enum(["HL_PRODUCT", "HL_PER_ABV", "HL_PER_PLATO", "HL_PURE_ALCOHOL", "NONE"]),
  rate: z.string().max(20),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(300).optional().default(""),
});

/**
 * Add a new rate version. Rates are never edited in place: a change is a new
 * row with a later valid_from, so documents calculated with the old rate stay
 * reproducible.
 */
export async function addExciseRate(input: z.input<typeof schema>) {
  return staffAction("rates.write", async (ctx) => {
    const v = schema.safeParse(input);
    if (!v.success) throw new AdminError(ctx.t("admin.err.input"));
    const cents = v.data.basis === "NONE" ? 0 : parseMoney(v.data.rate);
    if (cents === null || cents < 0 || cents > 100_000_000) throw new AdminError(ctx.t("admin.rates.badRate"));
    const validFrom = new Date(`${v.data.validFrom}T00:00:00Z`);
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (Number.isNaN(validFrom.getTime()) || validFrom.getTime() <= todayUtc) throw new AdminError(ctx.t("admin.rates.future"));
    const clash = await prisma.exciseRate.findFirst({ where: { country: v.data.country, category: v.data.category, validFrom } });
    if (clash) throw new AdminError(ctx.t("admin.rates.clash"));
    const current = await prisma.exciseRate.findFirst({ where: { country: v.data.country, category: v.data.category, validFrom: { lte: new Date(todayUtc) } }, orderBy: { validFrom: "desc" } });
    const row = await prisma.exciseRate.create({
      data: { country: v.data.country, category: v.data.category, basis: v.data.basis, rateCents: cents, validFrom, note: v.data.note || null, createdBy: ctx.staff.email },
    });
    const label = `${v.data.country} ${v.data.category.toLowerCase()}`;
    await auditStaff(ctx, {
      action: "rates.update",
      summary: `Added ${label} excise rate ${ctx.fmt.money(cents)} per ${v.data.basis} (effective ${v.data.validFrom})`,
      targetType: "excise_rate",
      targetId: row.id,
      before: current ? { rateCents: current.rateCents, basis: current.basis, validFrom: current.validFrom.toISOString().slice(0, 10) } : undefined,
      after: { rateCents: cents, basis: v.data.basis, validFrom: v.data.validFrom },
    });
    return { message: ctx.t("admin.rates.added", { what: label, date: ctx.fmt.dateMed(validFrom) }) };
  });
}
