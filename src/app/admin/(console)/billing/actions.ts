"use server";
import { prisma } from "@/lib/db";
import { AdminError, auditStaff, staffAction } from "@/lib/admin/staff";
import { PLANS } from "@/lib/domain/setup";

export async function markInvoice(invoiceId: string, status: "PAID" | "FAILED") {
  return staffAction("billing.write", async (ctx) => {
    if (status !== "PAID" && status !== "FAILED") throw new AdminError(ctx.t("admin.err.input"));
    const inv = await prisma.subscriptionInvoice.findUnique({ where: { id: String(invoiceId) }, include: { client: true } });
    if (!inv) throw new AdminError(ctx.t("admin.err.noInvoice"));
    if (inv.status === status) return { message: ctx.t("admin.billing.unchanged") };
    await prisma.subscriptionInvoice.update({ where: { id: inv.id }, data: { status, paidAt: status === "PAID" ? new Date() : null } });
    // Side effect on the client's status.
    let side = "";
    if (status === "FAILED" && inv.client.status === "ACTIVE") {
      await prisma.client.update({ where: { id: inv.clientId }, data: { status: "PAST_DUE" } });
      side = "pastDue";
    } else if (status === "PAID" && inv.client.status === "PAST_DUE") {
      const stillFailed = await prisma.subscriptionInvoice.count({ where: { clientId: inv.clientId, status: "FAILED", id: { not: inv.id } } });
      if (!stillFailed) {
        await prisma.client.update({ where: { id: inv.clientId }, data: { status: "ACTIVE" } });
        side = "active";
      }
    }
    await auditStaff(ctx, {
      action: status === "PAID" ? "billing.invoice_paid" : "billing.payment_failed",
      summary: `Marked ${inv.number} ${status === "PAID" ? "paid" : "failed"}${side === "pastDue" ? " · client now past due" : side === "active" ? " · client active again" : ""}`,
      clientId: inv.clientId,
      targetType: "subscription_invoice",
      targetId: inv.id,
      before: { status: inv.status },
      after: { status },
    });
    const base = ctx.t(status === "PAID" ? "admin.billing.markedPaid" : "admin.billing.markedFailed", { number: inv.number });
    return { message: side ? `${base} · ${ctx.t(`admin.billing.side.${side}`, { name: inv.client.name })}` : base };
  });
}

/** Create this month's subscription invoices for active and past-due clients (idempotent). */
export async function generateMonthInvoices() {
  return staffAction("billing.write", async (ctx) => {
    const now = new Date();
    const y = now.getUTCFullYear();
    const mo = now.getUTCMonth();
    const periodStart = new Date(Date.UTC(y, mo, 1));
    const periodEnd = new Date(Date.UTC(y, mo + 1, 0));
    const prefix = `LL-${y}-${String(mo + 1).padStart(2, "0")}-`;
    const clients = await prisma.client.findMany({ where: { status: { in: ["ACTIVE", "PAST_DUE"] } }, orderBy: { createdAt: "asc" } });
    const existing = await prisma.subscriptionInvoice.findMany({ where: { periodStart }, select: { clientId: true } });
    const have = new Set(existing.map((e) => e.clientId));
    const last = await prisma.subscriptionInvoice.findMany({ where: { number: { startsWith: prefix } }, select: { number: true } });
    let seq = Math.max(100, ...last.map((l) => Number(l.number.slice(prefix.length)) || 0));
    let created = 0;
    let skippedCustom = 0;
    for (const c of clients) {
      if (have.has(c.id)) continue;
      const price = PLANS[c.plan].price;
      if (price === null) {
        skippedCustom++;
        continue;
      }
      seq += 1;
      await prisma.subscriptionInvoice.create({ data: { clientId: c.id, number: `${prefix}${seq}`, plan: c.plan, periodStart, periodEnd, amountCents: price, status: "OPEN" } });
      created++;
    }
    if (created) {
      await auditStaff(ctx, { action: "billing.generate", summary: `Generated ${created} subscription invoices for ${ctx.fmt.monthLong(periodStart)}` });
    }
    return {
      message: created
        ? ctx.t("admin.billing.generated", { n: created, month: ctx.fmt.monthLong(periodStart) }) + (skippedCustom ? ` · ${ctx.t("admin.billing.skippedCustom", { n: skippedCustom })}` : "")
        : ctx.t("admin.billing.nothingToGenerate", { month: ctx.fmt.monthLong(periodStart) }),
    };
  });
}
