import type { Metadata } from "next";
import Link from "next/link";
import { canEditIn, requireApp, tenant } from "@/lib/app-context";
import { getI18n } from "@/i18n/server";
import { Icon } from "@/components/icon";
import { Empty, TabLinks } from "@/components/ui";
import { excisePerUnit, ratesOn } from "@/lib/domain/excise";
import { accountName } from "@/lib/domain/chart";
import { seesFinancials } from "@/lib/permissions";
import { DropZone, MockPreview, ProposalForm, type ProposalData, type ProposalRefsView } from "./client";

export const metadata: Metadata = { title: "Purchase invoices" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ tab?: string; id?: string; upload?: string }> }) {
  const ctx = await requireApp("purchases");
  const { t, fmt } = await getI18n(ctx.locale);
  const sp = await searchParams;
  const tab = sp.tab === "booked" ? "booked" : "todo";
  const A = ctx.administration.id;
  const canEdit = canEditIn(ctx, "purchases");
  const money = seesFinancials(ctx.role);
  const lang = ctx.administration.ledgerLanguage;

  const d = await tenant(ctx, async (tx) => {
    const [todo, booked, countTodo, countBooked] = await Promise.all([
      tx.purchaseInvoice.findMany({ where: { administrationId: A, status: "TO_APPROVE" }, orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }] }),
      tx.purchaseInvoice.findMany({ where: { administrationId: A, status: { in: ["BOOKED", "PAID"] } }, orderBy: [{ bookedAt: "desc" }, { issueDate: "desc" }], take: 60 }),
      tx.purchaseInvoice.count({ where: { administrationId: A, status: "TO_APPROVE" } }),
      tx.purchaseInvoice.count({ where: { administrationId: A, status: { in: ["BOOKED", "PAID"] } } }),
    ]);
    const list = tab === "todo" ? todo : booked;
    const selId = sp.id && list.some((i) => i.id === sp.id) ? sp.id : list[0]?.id;
    const sel = selId ? await tx.purchaseInvoice.findFirst({ where: { id: selId, administrationId: A }, include: { lines: { orderBy: { sort: "asc" } } } }) : null;
    const doc = sel?.documentId ? await tx.document.findFirst({ where: { id: sel.documentId, administrationId: A }, select: { id: true, filename: true, mimeType: true, status: true } }) : null;
    const [suppliers, products, warehouses, accounts, shipments, rates] = await Promise.all([
      tx.relation.findMany({ where: { administrationId: A, kind: { in: ["SUPPLIER", "BOTH"] }, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, country: true } }),
      tx.product.findMany({ where: { administrationId: A, archivedAt: null }, orderBy: { name: "asc" } }),
      tx.warehouse.findMany({ where: { administrationId: A, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
      tx.ledgerAccount.findMany({ where: { administrationId: A, active: true }, orderBy: { code: "asc" }, select: { code: true, nameNl: true, nameEn: true, type: true } }),
      tx.shipment.findMany({ where: { administrationId: A }, orderBy: { createdAt: "desc" }, select: { id: true, ref: true, goods: true } }),
      ratesOn(tx, ctx.administration.country, new Date()),
    ]);
    const entry = sel?.journalEntryId ? await tx.journalEntry.findFirst({ where: { id: sel.journalEntryId, administrationId: A }, include: { lines: true } }) : null;
    return { todo, booked, countTodo, countBooked, list, sel, doc, suppliers, products, warehouses, accounts, shipments, rates, entry };
  });

  const accName = new Map(d.accounts.map((a) => [a.code, accountName(a, lang)]));
  const refs: ProposalRefsView = {
    baseCurrency: ctx.administration.baseCurrency,
    suppliers: d.suppliers,
    products: d.products.map((p) => ({ id: p.id, label: `${p.name} · ${p.volumeMl / 1000} L${p.abvBp ? ` · ${p.abvBp / 100}%` : ""}`, sku: p.sku, exciseUnit: excisePerUnit(p, d.rates.get(p.category)) })),
    warehouses: d.warehouses,
    accounts: d.accounts.filter((a) => a.type === "COST" || a.type === "ASSET").map((a) => ({ code: a.code, name: accountName(a, lang) })),
    shipments: d.shipments.map((s) => ({ id: s.id, label: `${s.ref} · ${s.goods}` })),
  };

  const flagOf = (i: (typeof d.list)[number]) => {
    if (i.status === "PAID") return { text: t("purchases.flag.paid"), color: "#157347" };
    if (i.status === "BOOKED") return { text: i.paymentScheduledAt ? t("purchases.flag.scheduled") : t("purchases.flag.booked"), color: "#5b6474" };
    if (!i.supplierName && !i.number) return { text: t("purchases.flag.fillIn"), color: "#9a5b00" };
    const check = Boolean(i.warning) || (i.ocrConfidence ?? 100) < 90;
    if (!check) return { text: t("purchases.flag.ready"), color: "#157347" };
    return { text: i.currency !== ctx.administration.baseCurrency && i.warning ? t("purchases.flag.checkRate") : t("purchases.flag.check"), color: "#9a5b00" };
  };

  const sel = d.sel;
  const proposal: ProposalData | null = sel
    ? {
        id: sel.id,
        status: sel.status,
        supplierId: sel.supplierId,
        supplierName: sel.supplierName,
        supplierCountry: sel.supplierCountry,
        number: sel.number,
        issueDate: sel.issueDate.toISOString().slice(0, 10),
        dueDate: sel.dueDate ? sel.dueDate.toISOString().slice(0, 10) : null,
        currency: sel.currency,
        fxRate: Number(sel.fxRate),
        fxDate: sel.fxDate ? sel.fxDate.toISOString().slice(0, 10) : null,
        vatTreatment: sel.vatTreatment,
        warehouseId: sel.warehouseId,
        shipmentId: sel.shipmentId,
        orderRef: sel.orderRef,
        ocrConfidence: sel.ocrConfidence,
        warning: sel.warning,
        hasDocument: Boolean(d.doc),
        lines: sel.lines.map((l) => ({ description: l.description, productId: l.productId, accountCode: l.accountCode, qty: l.qty, unitPriceSrcCents: l.unitPriceSrcCents, vatRateBp: l.vatRateBp })),
        journal: d.entry
          ? {
              number: d.entry.number,
              date: d.entry.date.toISOString().slice(0, 10),
              lines: d.entry.lines.map((l) => ({ account: l.accountCode, name: accName.get(l.accountCode) ?? "", debit: l.debitCents, credit: l.creditCents })),
            }
          : null,
        paymentScheduledAt: sel.paymentScheduledAt ? sel.paymentScheduledAt.toISOString().slice(0, 10) : null,
        totalCents: sel.totalCents,
        paidCents: sel.paidCents,
      }
    : null;

  const forward = `inbox+${A.slice(-8)}@in.liquidledger.net`;
  const tabHref = (k: string) => `/purchases?tab=${k}`;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{t("common.group.daily")}</div>
          <h1>{t("common.nav.purchases")}</h1>
        </div>
        <div style={{ fontSize: 13, color: "#5b6474", display: "flex", alignItems: "center", gap: 6 }} title={t("purchases.forwardHint")}>
          {t("purchases.forwardTo")} <span style={{ color: "#14171f", fontWeight: 500 }}>{forward}</span>
          <Icon name="Info" size={14} color="#8a93a3" />
        </div>
      </div>

      {canEdit ? <DropZone autoOpen={sp.upload === "1"} /> : null}

      <style>{`.purch-split{display:grid;grid-template-columns:minmax(260px,320px) minmax(0,1fr);gap:16px;align-items:start}@media (max-width:900px){.purch-split{grid-template-columns:minmax(0,1fr)}}`}</style>
      <div className="purch-split">
        <div className="card card-clip">
          <TabLinks
            active={tab}
            tabs={[
              { key: "todo", label: t("purchases.tabTodo"), count: d.countTodo, href: tabHref("todo") },
              { key: "booked", label: t("purchases.tabBooked"), count: d.countBooked, href: tabHref("booked") },
            ]}
          />
          <div style={{ maxHeight: "calc(100vh - 160px)", minHeight: 120, overflowY: "auto" }}>
          {d.list.map((i) => {
            const on = i.id === sel?.id;
            const f = flagOf(i);
            return (
              <Link
                key={i.id}
                href={`/purchases?tab=${tab}&id=${i.id}`}
                scroll={false}
                style={{ display: "flex", flexDirection: "column", gap: 3, padding: "12px 14px", borderBottom: "1px solid #eef0f3", borderLeft: `3px solid ${on ? "#7a1f3d" : "transparent"}`, background: on ? "#fcf5f7" : "#fff", color: "inherit", textDecoration: "none" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600 }} className="truncate">{i.supplierName || t("purchases.unknownSupplier")}</span>
                  {money ? <span className="n" style={{ fontWeight: 600 }}>{fmt.money(i.totalCents)}</span> : null}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: "#5b6474" }}>
                  <span>{i.number || "—"} · {fmt.dateMed(i.issueDate)}</span>
                  <span style={{ color: f.color, whiteSpace: "nowrap" }}>{f.text}</span>
                </div>
              </Link>
            );
          })}
          </div>
          {!d.list.length ? (
            <div style={{ padding: "28px 14px", textAlign: "center", color: "#5b6474", fontSize: 13 }}>
              <Icon name="CheckCircle" size={26} color="#157347" />
              <div>{tab === "todo" ? t("purchases.emptyTodo") : t("purchases.emptyBooked")}</div>
            </div>
          ) : null}
        </div>

        {proposal && sel ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 16, alignItems: "start", minWidth: 0 }}>
            <div style={{ background: "#e9ecf1", borderRadius: 12, padding: 18, minWidth: 0 }}>
              {d.doc ? (
                <>
                  {d.doc.mimeType === "application/pdf" ? (
                    <iframe title={d.doc.filename} src={`/api/documents/${d.doc.id}#toolbar=0&view=FitH`} style={{ width: "100%", height: 560, border: 0, borderRadius: 4, background: "#fff", boxShadow: "0 2px 10px rgba(20,23,31,0.10)" }} />
                  ) : d.doc.mimeType === "image/heic" ? (
                    <div style={{ background: "#fff", borderRadius: 4, minHeight: 420, display: "grid", placeItems: "center", color: "#5b6474", fontSize: 13, textAlign: "center", padding: 24 }}>
                      <div><Icon name="Image" size={32} color="#8a93a3" /><div>{t("purchases.heicPreview")}</div></div>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/documents/${d.doc.id}`} alt={d.doc.filename} style={{ width: "100%", borderRadius: 4, background: "#fff", boxShadow: "0 2px 10px rgba(20,23,31,0.10)", display: "block" }} />
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 10, fontSize: 12.5, color: "#5b6474" }}>
                    <span style={{ display: "inline-flex", gap: 5, alignItems: "center", minWidth: 0 }} className="truncate">
                      <Icon name={d.doc.mimeType === "application/pdf" ? "FilePdf" : "Image"} size={14} />
                      {d.doc.filename}
                    </span>
                    <a href={`/api/documents/${d.doc.id}`} target="_blank" rel="noopener" style={{ display: "inline-flex", gap: 4, alignItems: "center", whiteSpace: "nowrap" }}>
                      {t("purchases.openDocument")} <Icon name="ArrowSquareOut" size={13} />
                    </a>
                  </div>
                </>
              ) : (
                <MockPreview
                  supplier={sel.supplierName || t("purchases.unknownSupplier")}
                  billTo={{ name: ctx.administration.legalName, address: [ctx.administration.addressLine, ctx.administration.city].filter(Boolean).join(", "), vat: ctx.administration.vatNumber ?? "" }}
                  number={sel.number}
                  date={fmt.dateMed(sel.issueDate)}
                  due={sel.dueDate ? fmt.dateMed(sel.dueDate) : "—"}
                  lines={sel.lines.map((l) => ({ d: l.description, q: fmt.int(l.qty), src: money ? fmt.money(l.amountSrcCents, { currency: sel.currency }) : "" }))}
                  total={money ? fmt.money(sel.totalSourceCents, { currency: sel.currency }) : "—"}
                  file={`${sel.number || "document"}.pdf`}
                />
              )}
            </div>
            <ProposalForm key={`${sel.id}:${sel.status}`} data={proposal} refs={refs} canEdit={canEdit && sel.status === "TO_APPROVE"} showMoney={money} />
          </div>
        ) : d.list.length === 0 ? null : (
          <div className="card">
            <Empty icon="Receipt" title={t("purchases.pickOne")} color="#8a93a3" />
          </div>
        )}
      </div>
    </>
  );
}
