"use server";
import { z } from "zod";
import { appAction, auditApp } from "@/lib/app-context";
import { PostingError } from "@/lib/domain/ledger";
import { revokeCurrentUserSession } from "@/lib/auth/session";
import { getI18n } from "@/i18n/server";

const opt = (max: number) => z.string().trim().max(max).transform((v) => v || null);

const schema = z.object({
  legalName: z.string().trim().min(1).max(160),
  addressLine: opt(160),
  postcode: opt(20),
  city: opt(80),
  email: z.string().trim().max(320).refine((v) => !v || /^\S+@\S+\.\S+$/.test(v), "email").transform((v) => v || null),
  cocNumber: opt(40),
  vatNumber: z.string().trim().max(20).transform((v) => v.replace(/\s/g, "").toUpperCase() || null).refine((v) => !v || /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(v), "vat"),
  iban: z.string().trim().max(42).transform((v) => v.replace(/\s/g, "").toUpperCase() || null).refine((v) => !v || /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v), "iban"),
  exciseLicenceNo: opt(40),
  exciseAuthority: opt(80),
  vatPeriod: z.enum(["MONTHLY", "QUARTERLY"]),
  invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/, "prefix"),
  ledgerLanguage: z.enum(["nl", "en"]),
  fiscalYearStart: z.coerce.number().int().min(1).max(12),
});

export type AdministrationInput = z.input<typeof schema>;

export async function updateAdministration(input: AdministrationInput) {
  return appAction("users", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    const p = schema.safeParse(input);
    if (!p.success) {
      const issue = p.error.issues[0];
      const key = issue?.message && ["email", "vat", "iban", "prefix"].includes(issue.message) ? issue.message : "required";
      throw new PostingError(t(`settings.admin.invalid.${key}`));
    }
    const before = await tx.administration.findUniqueOrThrow({ where: { id: ctx.administration.id } });
    const changed = Object.fromEntries(Object.entries(p.data).filter(([k, v]) => (before as Record<string, unknown>)[k] !== v));
    if (!Object.keys(changed).length) return { message: t("settings.admin.noChanges") };
    await tx.administration.update({ where: { id: ctx.administration.id }, data: p.data });
    const was = Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k] as string | number | null]));
    await auditApp(ctx, "administration.update", `Updated administration details · ${Object.keys(changed).join(", ")}`, { targetType: "administration", targetId: ctx.administration.id, before: was, after: changed }, tx);
    return { message: t("settings.admin.saved", { n: Object.keys(changed).length }) };
  });
}

export async function deleteAdministration(input: { confirm: string }) {
  const res = await appAction("deleteAdministration", async (ctx, tx) => {
    const { t } = await getI18n(ctx.locale);
    if (z.string().max(200).parse(input.confirm).trim() !== ctx.administration.legalName) throw new PostingError(t("settings.admin.deleteMismatch"));
    await tx.administration.update({ where: { id: ctx.administration.id }, data: { deletedAt: new Date() } });
    // Everyone working in this administration is signed out of it.
    await tx.session.updateMany({ where: { administrationId: ctx.administration.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await auditApp(ctx, "administration.delete", `Deleted administration ${ctx.administration.legalName} (soft delete)`, { targetType: "administration", targetId: ctx.administration.id }, tx);
    return { message: t("settings.admin.deleted", { name: ctx.administration.legalName }) };
  });
  if (res.ok) await revokeCurrentUserSession();
  return res;
}
