"use server";
import { z } from "zod";
import type { Plan } from "@prisma/client";
import { prisma, withSystem } from "@/lib/db";
import { AdminError, auditStaff, staffAction } from "@/lib/admin/staff";
import { COUNTRIES, createClientWithAdministration, MODULES, PLANS, addMembership } from "@/lib/domain/setup";
import { inviteClientUser, nameFromEmail, sendInviteMail } from "@/lib/admin/users";
import { createSupportHandoff, endSupportSession, openSupportSession } from "@/lib/admin/support";

const PLAN = z.enum(["STARTER", "BUSINESS", "PRO", "ENTERPRISE"]);
const COUNTRY = z.string().refine((c) => c in COUNTRIES);
const ID = z.string().min(1).max(64);
const PLAN_LABEL: Record<Plan, string> = { STARTER: "Starter", BUSINESS: "Business", PRO: "Pro", ENTERPRISE: "Enterprise" };

const newClientSchema = z.object({
  name: z.string().trim().min(2).max(160),
  country: COUNTRY,
  vatNumber: z.string().trim().max(32).optional().default(""),
  plan: PLAN,
  trial: z.boolean(),
  ownerName: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().toLowerCase().email().max(320),
});

export async function createClient(input: z.input<typeof newClientSchema>) {
  return staffAction("clients.write", async (ctx) => {
    const parsed = newClientSchema.safeParse(input);
    if (!parsed.success) throw new AdminError(ctx.t("admin.err.newClient"));
    const v = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email: v.ownerEmail } });
    if (existing && existing.status === "DISABLED") throw new AdminError(ctx.t("admin.err.userDisabled", { email: v.ownerEmail }));
    const language = COUNTRIES[v.country]!.language;
    const { client, administration, owner } = await withSystem(async (tx) => {
      const created = await createClientWithAdministration(tx, {
        name: v.name,
        country: v.country,
        vatNumber: v.vatNumber.replace(/\s/g, "").toUpperCase() || null,
        plan: v.plan,
        trial: v.trial,
      });
      const owner = existing ?? (await tx.user.create({ data: { email: v.ownerEmail, name: v.ownerName || nameFromEmail(v.ownerEmail), locale: language, status: "INVITED" } }));
      await addMembership(tx, owner.id, created.administration.id, "OWNER");
      return { ...created, owner };
    });
    if (owner.status === "INVITED") await sendInviteMail(owner, client.name, "OWNER", ctx.staff.name);
    await auditStaff(ctx, {
      action: "client.create",
      summary: `Created client ${client.name} · ${PLAN_LABEL[v.plan]}${v.trial ? " · 30-day trial" : ""} · invited ${owner.email} as Owner`,
      clientId: client.id,
      administrationId: administration.id,
      targetType: "client",
      targetId: client.id,
    });
    return { message: ctx.t("admin.clients.created", { name: client.name, email: owner.email }), clientId: client.id };
  });
}

const editSchema = z.object({ name: z.string().trim().min(2).max(160), vatNumber: z.string().trim().max(32), country: COUNTRY });

export async function updateClient(clientId: string, input: z.input<typeof editSchema>) {
  return staffAction("clients.write", async (ctx) => {
    const v = editSchema.safeParse(input);
    if (!v.success || !ID.safeParse(clientId).success) throw new AdminError(ctx.t("admin.err.input"));
    const before = await prisma.client.findUnique({ where: { id: clientId } });
    if (!before) throw new AdminError(ctx.t("admin.err.noClient"));
    const after = await prisma.client.update({
      where: { id: clientId },
      data: { name: v.data.name, vatNumber: v.data.vatNumber.replace(/\s/g, "").toUpperCase() || null, country: v.data.country },
    });
    await auditStaff(ctx, {
      action: "client.update",
      summary: `Edited client details${before.name !== after.name ? ` · renamed from ${before.name}` : ""}`,
      clientId,
      targetType: "client",
      targetId: clientId,
      before: { name: before.name, vatNumber: before.vatNumber, country: before.country },
      after: { name: after.name, vatNumber: after.vatNumber, country: after.country },
    });
    return { message: ctx.t("admin.clients.saved", { name: after.name }) };
  });
}

export async function setModule(clientId: string, module: string, on: boolean) {
  return staffAction("clients.write", async (ctx) => {
    if (!(MODULES as readonly string[]).includes(module)) throw new AdminError(ctx.t("admin.err.input"));
    const c = await prisma.client.findUnique({ where: { id: String(clientId) } });
    if (!c) throw new AdminError(ctx.t("admin.err.noClient"));
    const modules = on ? [...new Set([...c.modules, module])] : c.modules.filter((m) => m !== module);
    await prisma.client.update({ where: { id: c.id }, data: { modules } });
    const label = ctx.t(`admin.module.${module}`);
    await auditStaff(ctx, {
      action: "client.modules",
      summary: `${on ? "Enabled" : "Disabled"} module ${module}`,
      clientId: c.id,
      targetType: "client",
      targetId: c.id,
      before: { modules: c.modules },
      after: { modules },
    });
    return { message: ctx.t(on ? "admin.clients.moduleOn" : "admin.clients.moduleOff", { module: label, name: c.name }) };
  });
}

export async function setClientSuspended(clientId: string, suspend: boolean) {
  return staffAction("clients.billing", async (ctx) => {
    const c = await prisma.client.findUnique({ where: { id: String(clientId) } });
    if (!c) throw new AdminError(ctx.t("admin.err.noClient"));
    const status = suspend ? "SUSPENDED" : c.trialEndsAt && c.trialEndsAt > new Date() && !(await prisma.subscriptionInvoice.count({ where: { clientId: c.id } })) ? "TRIAL" : "ACTIVE";
    await prisma.client.update({ where: { id: c.id }, data: { status } });
    await auditStaff(ctx, {
      action: suspend ? "client.suspend" : "client.reactivate",
      summary: suspend ? "Suspended client · users can still view and export" : "Reactivated client",
      clientId: c.id,
      targetType: "client",
      targetId: c.id,
      before: { status: c.status },
      after: { status },
    });
    return { message: ctx.t(suspend ? "admin.clients.suspended" : "admin.clients.reactivated", { name: c.name }) };
  });
}

export async function changePlan(clientId: string, plan: Plan) {
  return staffAction("clients.billing", async (ctx) => {
    const p = PLAN.safeParse(plan);
    if (!p.success) throw new AdminError(ctx.t("admin.err.input"));
    const c = await prisma.client.findUnique({ where: { id: String(clientId) }, include: { administrations: { where: { deletedAt: null } } } });
    if (!c) throw new AdminError(ctx.t("admin.err.noClient"));
    if (c.plan === p.data) return { message: ctx.t("admin.clients.planSame", { plan: PLAN_LABEL[p.data] }) };
    const limit = PLANS[p.data].administrations;
    if (limit !== null && c.administrations.length > limit) throw new AdminError(ctx.t("admin.err.planTooSmall", { n: c.administrations.length, plan: PLAN_LABEL[p.data] }));
    await prisma.client.update({ where: { id: c.id }, data: { plan: p.data } });
    await auditStaff(ctx, {
      action: "client.plan",
      summary: `Changed plan ${PLAN_LABEL[c.plan]} → ${PLAN_LABEL[p.data]}`,
      clientId: c.id,
      targetType: "client",
      targetId: c.id,
      before: { plan: c.plan },
      after: { plan: p.data },
    });
    const price = PLANS[p.data].price;
    return { message: ctx.t("admin.clients.planChanged", { name: c.name, from: PLAN_LABEL[c.plan], to: PLAN_LABEL[p.data], price: price === null ? ctx.t("admin.plans.custom") : ctx.fmt.money(price, { decimals: 0 }) }) };
  });
}

const inviteSchema = z.object({
  clientId: ID,
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(["OWNER", "ADMIN", "BOOKKEEPER", "WAREHOUSE", "ACCOUNTANT", "READ_ONLY"]),
});

export async function inviteUser(input: z.input<typeof inviteSchema>) {
  return staffAction("clients.write", async (ctx) => {
    const v = inviteSchema.safeParse(input);
    if (!v.success) throw new AdminError(ctx.t("admin.err.email"));
    const { user } = await inviteClientUser(ctx, v.data);
    return { message: ctx.t(user.status === "INVITED" ? "admin.users.invited" : "admin.users.added", { email: user.email, role: ctx.t(`admin.role.${v.data.role}`) }) };
  });
}

// ── Support access ──────────────────────────────────────────────────────────

export async function openSupport(clientId: string, reason: string) {
  return staffAction("support.open", async (ctx) => {
    const { session, notified } = await openSupportSession(ctx, String(clientId), String(reason ?? ""));
    const c = await prisma.client.findUniqueOrThrow({ where: { id: session.clientId } });
    return { message: ctx.t("admin.support.opened", { name: c.name, n: notified }), supportSessionId: session.id };
  });
}

export async function openClientApp(supportSessionId: string) {
  return staffAction("support.open", async (ctx) => {
    const url = await createSupportHandoff(ctx, String(supportSessionId));
    return { url };
  });
}

export async function endSupport(supportSessionId: string) {
  return staffAction("support.open", async (ctx) => {
    await endSupportSession(ctx, String(supportSessionId));
    return { message: ctx.t("admin.support.ended") };
  });
}
