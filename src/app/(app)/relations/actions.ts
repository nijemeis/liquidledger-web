"use server";
import { z } from "zod";
import { appAction, auditApp } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { PostingError } from "@/lib/domain/ledger";
import { checkVies } from "@/lib/vies";
import { validIban } from "@/lib/countries";
import { canEdit } from "@/lib/permissions";

const Input = z.object({
  id: z.string().optional().nullable(),
  kind: z.enum(["CUSTOMER", "SUPPLIER", "BOTH"]),
  name: z.string().trim().max(200),
  typeLabel: z.string().trim().max(80).optional().nullable(),
  country: z.string().trim().length(2),
  addressLine: z.string().trim().max(200).optional().nullable(),
  postcode: z.string().trim().max(20).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  vatNumber: z.string().trim().max(30).optional().nullable(),
  exciseStatus: z.string().trim().max(120).optional().nullable(),
  exciseNumber: z.string().trim().max(40).optional().nullable(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  defaultPriceList: z.string().trim().max(40).optional().nullable(),
  taxRegimeOverride: z.enum(["DOMESTIC", "EU_B2B", "EXPORT"]).optional().nullable(),
  iban: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** Customers need sales rights, suppliers purchase rights. */
function permFor(kind: string) {
  return kind === "SUPPLIER" ? ("purchases" as const) : ("sales" as const);
}

export async function saveRelation(raw: z.infer<typeof Input>) {
  const input = Input.parse(raw);
  return appAction(permFor(input.kind), async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    if (input.kind === "BOTH" && !canEdit(ctx.role, "purchases")) throw new PostingError(t("relations.readOnly"));
    if (!input.name) throw new PostingError(t("relations.nameRequired"));
    if (input.iban && !validIban(input.iban)) throw new PostingError(t("relations.ibanInvalid"));
    const A = ctx.administration.id;
    const vat = clean(input.vatNumber)?.replace(/\s/g, "").toUpperCase() ?? null;
    const data = {
      kind: input.kind,
      name: input.name,
      typeLabel: clean(input.typeLabel),
      country: input.country.toUpperCase(),
      addressLine: clean(input.addressLine),
      postcode: clean(input.postcode),
      city: clean(input.city),
      email: clean(input.email)?.toLowerCase() ?? null,
      phone: clean(input.phone),
      vatNumber: vat,
      exciseStatus: clean(input.exciseStatus),
      exciseNumber: clean(input.exciseNumber),
      paymentTermsDays: input.paymentTermsDays,
      defaultPriceList: clean(input.defaultPriceList),
      taxRegimeOverride: input.taxRegimeOverride ?? null,
      iban: clean(input.iban)?.replace(/\s/g, "").toUpperCase() ?? null,
      notes: clean(input.notes),
    };
    const before = input.id ? await tx.relation.findFirst({ where: { id: input.id, administrationId: A } }) : null;
    if (input.id && !before) throw new PostingError("Relation not found.");
    // Re-check VIES when the VAT number changed; never block saving on it.
    let vies: Partial<{ viesValid: boolean | null; viesCheckedAt: Date | null; viesName: string | null }> = {};
    if (vat && vat !== before?.vatNumber) {
      const r = await checkVies(data.country, vat);
      vies = r.ok ? { viesValid: r.valid, viesCheckedAt: r.checkedAt, viesName: r.name } : { viesValid: null, viesCheckedAt: null, viesName: null };
    } else if (!vat) vies = { viesValid: null, viesCheckedAt: null, viesName: null };
    const rel = before
      ? await tx.relation.update({ where: { id: before.id }, data: { ...data, ...vies } })
      : await tx.relation.create({ data: { ...data, ...vies, administrationId: A } });
    await auditApp(ctx, before ? "relation.update" : "relation.create", `${before ? "Updated" : "Added"} relation ${rel.name}`, { targetType: "relation", targetId: rel.id }, tx);
    const message = vies.viesValid ? t("relations.viesSavedValid", { name: rel.name }) : before ? t("relations.saved", { name: rel.name }) : t("relations.created", { name: rel.name });
    return { message, id: rel.id };
  });
}

export async function checkViesNumber(input: { id?: string | null; country: string; vatNumber: string }) {
  return appAction<{ valid?: boolean; viesName?: string | null }>(null, async (ctx, tx) => {
    const { t, fmt } = await getI18n(ctx.locale);
    const r = await checkVies(input.country, input.vatNumber);
    if (!r.ok) {
      const key = r.error === "unsupported" ? "viesUnsupported" : r.error === "format" ? "viesFormat" : "viesDown";
      return { ok: false as const, error: t(`relations.${key}`) };
    }
    if (input.id) {
      await tx.relation.updateMany({
        where: { id: input.id, administrationId: ctx.administration.id },
        data: { viesValid: r.valid, viesCheckedAt: r.checkedAt, viesName: r.name },
      });
    }
    if (!r.valid) return { ok: false as const, error: t("relations.viesBad") };
    return { message: t("relations.viesOk", { name: r.name ? ` · ${r.name}` : "" }) + ` (${fmt.date(r.checkedAt)})`, valid: true, viesName: r.name };
  });
}

export async function setArchived(id: string, archived: boolean) {
  return appAction(null, async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const rel = await tx.relation.findFirst({ where: { id, administrationId: ctx.administration.id } });
    if (!rel) throw new PostingError("Relation not found.");
    if (!canEdit(ctx.role, permFor(rel.kind))) throw new PostingError(t("relations.readOnly"));
    await tx.relation.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await auditApp(ctx, archived ? "relation.archive" : "relation.restore", `${archived ? "Archived" : "Restored"} relation ${rel.name}`, { targetType: "relation", targetId: id }, tx);
    return { message: t(archived ? "relations.archivedMsg" : "relations.restoredMsg", { name: rel.name }) };
  });
}
