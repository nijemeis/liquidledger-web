"use client";
import { useI18n } from "@/i18n/client";
import { useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { generateMonthInvoices, markInvoice } from "./actions";

export function GenerateButton() {
  const { t } = useI18n();
  const [run, pending] = useAction(generateMonthInvoices);
  return (
    <button className="btn btn-primary" disabled={pending} onClick={() => run()}>
      {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Receipt" size={16} />}
      {t("admin.billing.generate")}
    </button>
  );
}

export function InvoiceActions({ id, status }: { id: string; status: string }) {
  const { t } = useI18n();
  const [run, pending] = useAction(markInvoice);
  return (
    <span style={{ display: "flex", gap: 6 }}>
      {status !== "PAID" ? (
        <button className="btn btn-sm" disabled={pending} onClick={() => run(id, "PAID")} style={{ fontSize: 12.5, padding: "0 10px" }}>
          {t("admin.billing.markPaid")}
        </button>
      ) : null}
      {status === "OPEN" ? (
        <button className="btn btn-sm btn-ghost btn-danger" disabled={pending} onClick={() => run(id, "FAILED")} style={{ fontSize: 12.5, padding: "0 10px" }}>
          {t("admin.billing.markFailed")}
        </button>
      ) : null}
    </span>
  );
}
