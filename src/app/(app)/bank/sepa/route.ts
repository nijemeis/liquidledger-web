import { NextResponse, type NextRequest } from "next/server";
import { auditApp, canEditIn, getAppContext, tenant } from "@/lib/app-context";
import { buildPain001, compactIban, isValidIban, sepaCandidates } from "@/lib/domain/bank";

export const dynamic = "force-dynamic";

/**
 * SEPA credit transfer batch (pain.001.001.03) for booked purchase invoices
 * that are due within 7 days or have a scheduled payment. Upload the file in
 * the bank's business portal; the payments are reconciled when the statement
 * comes back.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!canEditIn(ctx, "bank")) return NextResponse.json({ error: "Your role doesn't allow payments." }, { status: 403 });
  const A = ctx.administration.id;
  const accountId = req.nextUrl.searchParams.get("account");

  const result = await tenant(ctx, async (tx) => {
    const accounts = await tx.bankAccount.findMany({ where: { administrationId: A, archivedAt: null, currency: "EUR" }, orderBy: { createdAt: "asc" } });
    const debtor = accountId ? accounts.find((a) => a.id === accountId) : accounts.find((a) => a.iban && isValidIban(a.iban));
    if (!debtor?.iban || !isValidIban(debtor.iban)) return { error: "Add a euro bank account with a valid IBAN first." } as const;
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const { pay, skipped } = await sepaCandidates(tx, A, today);
    if (!pay.length) return { error: "Nothing to pay: no invoices with a supplier IBAN are due within 7 days." } as const;
    const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
    const xml = buildPain001({
      messageId: `LL-${stamp}`,
      createdAt: now,
      executionDate: today,
      debtorName: ctx.administration.legalName,
      debtorIban: debtor.iban,
      payments: pay.map((p) => ({
        endToEndId: p.invoice.number,
        amountCents: p.amountCents,
        creditorName: p.name,
        creditorIban: p.iban,
        remittance: `${p.invoice.number} ${ctx.administration.legalName}`,
      })),
    });
    const total = pay.reduce((a, p) => a + p.amountCents, 0);
    await auditApp(
      ctx,
      "bank.sepa_export",
      `SEPA batch from ${compactIban(debtor.iban)}: ${pay.length} payments, €${(total / 100).toFixed(2)}${skipped.length ? `, ${skipped.length} skipped` : ""}`,
      { targetType: "bank_account", targetId: debtor.id },
      tx,
    );
    return { xml, stamp } as const;
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 422 });
  return new NextResponse(result.xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="sepa-${result.stamp.slice(0, 8)}.xml"`,
      "Cache-Control": "no-store",
    },
  });
}
