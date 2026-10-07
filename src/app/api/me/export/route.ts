import { NextResponse } from "next/server";
import { getAppContext, tenant, auditApp } from "@/lib/app-context";
import { prisma } from "@/lib/db";
import { canView } from "@/lib/permissions";
import { assertSameOrigin, HttpError } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * GDPR export: every tenant table of the current administration as one JSON
 * file. Owner only. Uploaded file contents are left out (metadata only).
 * POST (from a same-origin form) so it can't be triggered cross-site.
 */
export async function POST() {
  try {
    await assertSameOrigin();
    const ctx = await getAppContext();
    if (!ctx) return NextResponse.json({ ok: false, error: "Your session has ended. Sign in again." }, { status: 401 });
    if (ctx.kind !== "user" || !canView(ctx.role, "billing")) return NextResponse.json({ ok: false, error: "Only the owner can export all data." }, { status: 403 });
    const A = ctx.administration.id;
    const where = { administrationId: A };
    const data = await tenant(ctx, async (tx) => ({
      ledgerAccounts: await tx.ledgerAccount.findMany({ where, orderBy: { code: "asc" } }),
      relations: await tx.relation.findMany({ where }),
      products: await tx.product.findMany({ where }),
      productPrices: await tx.productPrice.findMany({ where }),
      warehouses: await tx.warehouse.findMany({ where }),
      stockMovements: await tx.stockMovement.findMany({ where, orderBy: { at: "asc" } }),
      salesInvoices: await tx.salesInvoice.findMany({ where, orderBy: { issueDate: "asc" } }),
      salesInvoiceLines: await tx.salesInvoiceLine.findMany({ where }),
      purchaseInvoices: await tx.purchaseInvoice.findMany({ where, orderBy: { issueDate: "asc" } }),
      purchaseInvoiceLines: await tx.purchaseInvoiceLine.findMany({ where }),
      documents: await tx.document.findMany({ where, omit: { data: true } }),
      receipts: await tx.receipt.findMany({ where, orderBy: { date: "asc" } }),
      bookingRules: await tx.bookingRule.findMany({ where }),
      bankAccounts: await tx.bankAccount.findMany({ where }),
      bankTransactions: await tx.bankTransaction.findMany({ where, orderBy: { date: "asc" } }),
      shipments: await tx.shipment.findMany({ where }),
      customsDocuments: await tx.customsDocument.findMany({ where }),
      journalEntries: await tx.journalEntry.findMany({ where, orderBy: { number: "asc" } }),
      journalLines: await tx.journalLine.findMany({ where }),
      taxReturns: await tx.taxReturn.findMany({ where }),
      sequences: await tx.sequence.findMany({ where }),
    }));
    const [administration, members, auditEvents] = await Promise.all([
      prisma.administration.findUnique({ where: { id: A } }),
      prisma.membership.findMany({ where, select: { role: true, createdAt: true, user: { select: { name: true, email: true, status: true, locale: true, lastSignInAt: true } } } }),
      prisma.auditEvent.findMany({ where, orderBy: { at: "asc" } }),
    ]);
    const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
    const body = JSON.stringify(
      {
        format: "liquid-ledger-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        exportedBy: ctx.user?.email,
        note: "All amounts are integer cents. Uploaded file contents are not included; download them from the app.",
        administration,
        members,
        counts,
        ...data,
        auditEvents,
      },
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );
    await auditApp(ctx, "administration.export", `Exported all data (GDPR) · ${Object.values(counts).reduce((a, b) => a + b, 0)} records`, { targetType: "administration", targetId: A });
    const slug = ctx.administration.legalName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "administration";
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="liquid-ledger-${slug}-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    console.error("[me/export]", e);
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
