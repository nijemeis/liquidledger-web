import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { seesFinancials } from "@/lib/permissions";
import { isCreditNote } from "@/lib/domain/sales";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

const COUNTRY: Record<string, string> = {
  NL: "Nederland / The Netherlands", BE: "Belgium", DE: "Germany", FR: "France", SE: "Sweden", NG: "Nigeria", GB: "United Kingdom",
  ES: "Spain", IT: "Italy", PT: "Portugal", DK: "Denmark", PL: "Poland", US: "United States", MX: "Mexico", CH: "Switzerland",
};

/** Clean A4 invoice / credit note, printable or saved as PDF from the browser. */
export default async function PrintInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const ctx = await requireApp("sales");
  if (!seesFinancials(ctx.role)) redirect("/sales");
  const { id } = await params;
  const sp = await searchParams;
  const { t, fmt } = await getI18n(ctx.locale);
  const A = ctx.administration.id;
  const d = await tenant(ctx, async (tx) => {
    const inv = await tx.salesInvoice.findFirst({ where: { id, administrationId: A }, include: { lines: { orderBy: { sort: "asc" } } } });
    if (!inv) return null;
    const customer = await tx.relation.findUniqueOrThrow({ where: { id: inv.customerId } });
    const products = await tx.product.findMany({ where: { id: { in: inv.lines.map((l) => l.productId).filter((x): x is string => Boolean(x)) } }, select: { id: true, sku: true, unitsPerCase: true, volumeMl: true, abvBp: true } });
    return { inv, customer, products };
  });
  if (!d) notFound();
  const { inv, customer } = d;
  const a = ctx.administration;
  const cn = isCreditNote(inv);
  const draft = inv.status === "DRAFT";
  const prod = new Map(d.products.map((p) => [p.id, p]));

  // VAT breakdown per rate (base = net + excise + deposit).
  const vatRows = new Map<number, { base: number; vat: number }>();
  for (const l of inv.lines) {
    const r = vatRows.get(l.vatRateBp) ?? { base: 0, vat: 0 };
    r.base += l.netCents + l.exciseCents + l.depositCents;
    r.vat += l.vatCents;
    vatRows.set(l.vatRateBp, r);
  }
  const outstanding = inv.totalCents - inv.paidCents;
  const cell: React.CSSProperties = { padding: "7px 8px", borderBottom: "1px solid #eef0f3", verticalAlign: "top" };
  const head: React.CSSProperties = { ...cell, fontSize: 11, fontWeight: 600, color: "#5b6474", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1.5px solid #14171f", textAlign: "left" };
  const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

  return (
    <div className="print-wrap">
      <style>{`
        .print-wrap { min-height: 100vh; background: #e9ecf1; padding: 24px 16px 48px; }
        .sheet { width: 210mm; max-width: 100%; min-height: 297mm; margin: 0 auto; background: #fff; box-shadow: 0 2px 14px rgba(20,23,31,.12); padding: 18mm 16mm; font-size: 12.5px; color: #14171f; display: flex; flex-direction: column; gap: 22px; }
        .bar { width: 210mm; max-width: 100%; margin: 0 auto 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        @page { size: A4; margin: 0; }
        @media print {
          .print-wrap { background: #fff; padding: 0; }
          .sheet { box-shadow: none; width: auto; min-height: auto; margin: 0; padding: 14mm 14mm; }
        }
      `}</style>
      <div className="bar no-print">
        <Link className="btn" href={`/sales?id=${inv.id}`}>{t("sales.print.back")}</Link>
        <PrintButton label={t("sales.print.printBtn")} auto={sp.auto === "1"} />
      </div>
      <article className="sheet">
        <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "flex-start" }}>
          <div style={{ lineHeight: 1.5 }}>
            <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em" }}>{a.legalName}</div>
            {a.addressLine ? <div>{a.addressLine}</div> : null}
            {a.postcode || a.city ? <div>{[a.postcode, a.city].filter(Boolean).join(" ")}</div> : null}
            <div>{COUNTRY[a.country] ?? a.country}</div>
            {a.email ? <div style={{ color: "#5b6474" }}>{a.email}</div> : null}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.06em", color: "#7a1f3d", textTransform: "uppercase" }}>
              {cn ? t("sales.print.creditNote") : t("sales.print.invoice")}
            </div>
            {draft ? <div style={{ marginTop: 4, fontWeight: 600, color: "#9a5b00" }}>{t("sales.draftNo").toUpperCase()}</div> : null}
          </div>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div style={{ lineHeight: 1.5 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#5b6474", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{t("sales.print.billTo")}</div>
            <div style={{ fontWeight: 600 }}>{customer.name}</div>
            {customer.addressLine ? <div>{customer.addressLine}</div> : null}
            {customer.postcode || customer.city ? <div>{[customer.postcode, customer.city].filter(Boolean).join(" ")}</div> : null}
            <div>{COUNTRY[customer.country] ?? customer.country}</div>
            {customer.vatNumber ? <div>{t("sales.print.vatNo")} {customer.vatNumber}</div> : null}
            {customer.exciseNumber ? <div>{t("sales.print.exciseNo")} {customer.exciseNumber}</div> : null}
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", margin: 0, alignContent: "start" }}>
            <dt style={{ color: "#5b6474" }}>{cn ? t("sales.print.cnNumber") : t("sales.print.number")}</dt>
            <dd style={{ margin: 0, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{inv.number ?? "—"}</dd>
            <dt style={{ color: "#5b6474" }}>{t("sales.print.date")}</dt>
            <dd style={{ margin: 0 }}>{fmt.dateMed(inv.issueDate)}</dd>
            {!cn ? (
              <>
                <dt style={{ color: "#5b6474" }}>{t("sales.print.due")}</dt>
                <dd style={{ margin: 0 }}>{fmt.dateMed(inv.dueDate)}</dd>
              </>
            ) : null}
            {inv.reference ? (
              <>
                <dt style={{ color: "#5b6474" }}>{cn ? t("sales.print.creditFor") : t("sales.print.reference")}</dt>
                <dd style={{ margin: 0 }}>{inv.reference}</dd>
              </>
            ) : null}
          </dl>
        </section>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={head}>{t("sales.print.description")}</th>
              <th style={{ ...head, ...num }}>{t("sales.print.qty")}</th>
              <th style={{ ...head, ...num }}>{t("sales.print.price")}</th>
              <th style={{ ...head, ...num }}>{t("sales.print.net")}</th>
              <th style={{ ...head, ...num }}>{t("sales.print.excise")}</th>
              <th style={{ ...head, ...num }}>{t("sales.print.vat")}</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => {
              const p = l.productId ? prod.get(l.productId) : undefined;
              const n = Math.abs(l.qtyUnits);
              const cs = p && p.unitsPerCase > 1 && n % p.unitsPerCase === 0 ? ` (${n / p.unitsPerCase} × ${p.unitsPerCase})` : "";
              return (
                <tr key={l.id}>
                  <td style={cell}>
                    <div style={{ fontWeight: 500 }}>{l.description}</div>
                    <div style={{ color: "#5b6474", fontSize: 11 }}>
                      {[p?.sku, p ? `${p.volumeMl / 1000} L` : null, p && p.abvBp ? `${p.abvBp / 100}%` : null].filter(Boolean).join(" · ")}
                      {l.depositCents ? ` · ${t("sales.print.deposit")} ${fmt.money(l.depositCents)}` : ""}
                    </div>
                  </td>
                  <td style={{ ...cell, ...num }}>
                    {fmt.int(l.qtyUnits)}
                    <span style={{ color: "#5b6474", fontSize: 11 }}>{cs}</span>
                  </td>
                  <td style={{ ...cell, ...num }}>{fmt.money(l.unitPriceCents)}</td>
                  <td style={{ ...cell, ...num }}>{fmt.money(l.netCents)}</td>
                  <td style={{ ...cell, ...num }}>
                    {l.exciseCents ? fmt.money(l.exciseCents) : "—"}
                    {l.exciseCents && l.exciseFormula ? <div style={{ color: "#5b6474", fontSize: 10.5 }}>{l.exciseFormula}</div> : null}
                  </td>
                  <td style={{ ...cell, ...num }}>{fmt.pct(l.vatRateBp)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <section style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 144px", gap: "5px 0", minWidth: 300, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: "#5b6474" }}>{t("sales.print.subtotal")}</span>
            <span style={{ textAlign: "right" }}>{fmt.money(inv.netCents)}</span>
            {inv.exciseCents ? (
              <>
                <span style={{ color: "#5b6474" }}>{t("sales.print.exciseTotal")}</span>
                <span style={{ textAlign: "right" }}>{fmt.money(inv.exciseCents)}</span>
              </>
            ) : null}
            {inv.depositCents ? (
              <>
                <span style={{ color: "#5b6474" }}>{t("sales.print.deposit")}</span>
                <span style={{ textAlign: "right" }}>{fmt.money(inv.depositCents)}</span>
              </>
            ) : null}
            {[...vatRows].sort((x, y) => y[0] - x[0]).map(([rate, r]) => (
              <span key={rate} style={{ display: "contents" }}>
                <span style={{ color: "#5b6474" }}>{t("sales.print.vatOn", { pct: fmt.pct(rate), base: fmt.money(r.base) })}</span>
                <span style={{ textAlign: "right" }}>{fmt.money(r.vat)}</span>
              </span>
            ))}
            <span style={{ fontWeight: 700, fontSize: 15, paddingTop: 7, borderTop: "1.5px solid #14171f" }}>{t("sales.print.total")}</span>
            <span style={{ fontWeight: 700, fontSize: 15, paddingTop: 7, borderTop: "1.5px solid #14171f", textAlign: "right" }}>{fmt.money(inv.totalCents)}</span>
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
          {inv.taxRegime === "EU_B2B" ? (
            <>
              <div style={{ fontWeight: 600 }}>{t("sales.print.reverse", { ours: a.vatNumber ?? "—", theirs: customer.vatNumber ?? "—" })}</div>
              <div style={{ color: "#5b6474" }}>{t("sales.print.emcs")}</div>
            </>
          ) : inv.taxRegime === "EXPORT" ? (
            <div style={{ fontWeight: 600 }}>{t("sales.print.export")}</div>
          ) : inv.exciseCents ? (
            <div style={{ color: "#5b6474" }}>{t("sales.print.exciseNote")}</div>
          ) : null}
          {inv.notes ? <div>{inv.notes}</div> : null}
        </section>

        <section style={{ border: "1px solid #e4e7ec", borderRadius: 8, padding: "12px 14px", background: "#f9fafb" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("sales.print.payTitle")}</div>
          {cn ? (
            <div>{t("sales.print.cnText")}</div>
          ) : inv.status === "PAID" ? (
            <div>{t("sales.print.paidText")}</div>
          ) : (
            <div>
              {t("sales.print.payText", { amount: fmt.money(outstanding), date: fmt.dateMed(inv.dueDate), iban: a.iban ?? "—", name: a.legalName, number: inv.number ?? "—" })}
            </div>
          )}
        </section>

        <footer style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid #e4e7ec", color: "#5b6474", fontSize: 10.5, display: "flex", flexWrap: "wrap", gap: "2px 14px" }}>
          <span>{a.legalName}</span>
          {a.vatNumber ? <span>{t("sales.print.vatNo")} {a.vatNumber}</span> : null}
          {a.cocNumber ? <span>{t("sales.print.coc")} {a.cocNumber}</span> : null}
          {a.iban ? <span>IBAN {a.iban}</span> : null}
          {a.exciseLicenceNo ? <span>{t("sales.print.exciseNo")} {a.exciseLicenceNo}</span> : null}
        </footer>
      </article>
    </div>
  );
}
