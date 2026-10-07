"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Plan } from "@prisma/client";
import { useI18n } from "@/i18n/client";
import { Drawer, useAction } from "@/components/client";
import { Icon } from "@/components/icon";
import { ChoiceChip } from "../ui";
import { createClient } from "./actions";
import { PlanCards } from "./client-drawer";
import { COUNTRY_CODES, COUNTRY_FLAGS, COUNTRY_LANGUAGE, VAT_EXAMPLE } from "./shared";

export function NewClientButton() {
  const { t } = useI18n();
  return (
    <Link href="/admin/clients?new=1" scroll={false} className="btn btn-primary">
      <Icon name="Plus" size={16} />
      {t("admin.clients.new")}
    </Link>
  );
}

export function NewClientDrawer({ closeHref }: { closeHref: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [country, setCountry] = useState<string>("NL");
  const [vat, setVat] = useState("");
  const [plan, setPlan] = useState<Plan>("BUSINESS");
  const [trial, setTrial] = useState(true);
  const [owner, setOwner] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [run, pending] = useAction(createClient, {
    onDone: (r) => {
      if (r.ok && typeof r.clientId === "string") router.push(`/admin/clients?id=${r.clientId}`, { scroll: false });
    },
  });
  const close = () => router.push(closeHref, { scroll: false });
  const valid = name.trim().length >= 2 && owner.trim().length >= 2 && /.+@.+\..+/.test(ownerEmail.trim());

  return (
    <Drawer
      open
      onClose={close}
      width={600}
      title={t("admin.new.title")}
      subtitle={t("admin.new.subtitle")}
      footer={
        <>
          <button className="btn" onClick={close}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" disabled={pending || !valid} onClick={() => run({ name, country, vatNumber: vat, plan, trial, ownerName: owner, ownerEmail })}>
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="PaperPlaneTilt" size={16} />}
            {t("admin.new.submit")}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <label className="field">
          {t("admin.new.name")}
          <input className="input" style={{ height: 40 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("admin.new.namePh")} autoFocus />
        </label>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#3a4250", marginBottom: 6 }}>{t("admin.new.country")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {COUNTRY_CODES.map((cc) => (
              <ChoiceChip key={cc} on={country === cc} onClick={() => setCountry(cc)}>
                <span style={{ fontSize: 13.5 }}>
                  {COUNTRY_FLAGS[cc]} {cc}
                </span>
              </ChoiceChip>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, padding: "10px 12px", borderRadius: 9, background: "#fcf5f7", fontSize: 13, color: "#7a1f3d" }}>
            <Icon name="Info" size={18} style={{ flex: "none" }} />
            <span>{t("admin.new.setsUp", { what: t(`admin.new.regime.${country}`) })}</span>
          </div>
        </div>
        <label className="field">
          {t("admin.new.vat")}
          <input className="input" style={{ height: 40 }} value={vat} onChange={(e) => setVat(e.target.value)} placeholder={t("admin.new.vatPh", { example: VAT_EXAMPLE[country] ?? "" })} />
        </label>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#3a4250", marginBottom: 6 }}>{t("admin.new.plan")}</div>
          <PlanCards value={plan} onChange={setPlan} />
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13.5, cursor: "pointer" }}>
            <input type="checkbox" className="checkbox" checked={trial} onChange={() => setTrial((v) => !v)} />
            {t("admin.new.trial")}
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          <label className="field">
            {t("admin.new.owner")}
            <input className="input" style={{ height: 40 }} value={owner} onChange={(e) => setOwner(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            {t("admin.new.ownerEmail")}
            <input className="input" style={{ height: 40 }} type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} autoComplete="off" />
          </label>
        </div>
        <div style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 9, background: "#f5f6f8", fontSize: 13, color: "#3a4250" }}>
          <Icon name="ShieldCheck" size={18} color="#157347" style={{ flex: "none" }} />
          <span>{t("admin.new.ownerNote", { language: t(`admin.lang.${COUNTRY_LANGUAGE[country] ?? "en"}`) })}</span>
        </div>
      </div>
    </Drawer>
  );
}
