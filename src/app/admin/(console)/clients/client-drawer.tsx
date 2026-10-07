"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientStatus, Plan, Role, UserStatus } from "@prisma/client";
import { useI18n } from "@/i18n/client";
import { Drawer, useAction, useToast } from "@/components/client";
import { Icon, type IconName } from "@/components/icon";
import { Pill } from "@/components/ui";
import { CLIENT_STATUS_TONE, mfaView, type MfaKind } from "@/lib/admin/format";
import { AdminModal, ChoiceChip } from "../ui";
import { InviteModal } from "../invite-modal";
import { changePlan, endSupport, openClientApp, openSupport, setClientSuspended, setModule, updateClient } from "./actions";
import { COUNTRY_CODES, COUNTRY_FLAGS, PLAN_KEYS } from "./shared";

export type ClientDetail = {
  id: string;
  name: string;
  initials: string;
  country: string;
  countryLine: string;
  vatNumber: string;
  since: string;
  status: ClientStatus;
  statusLabel: string;
  plan: Plan;
  modules: string[];
  facts: [string, string][];
  users: { id: string; name: string; email: string; role: Role; status: UserStatus; mfa: MfaKind }[];
  support: { id: string; staffName: string; mine: boolean; reason: string; until: string; expiresAt: string } | null;
};

const MODULES: [string, IconName][] = [
  ["excise", "SealCheck"],
  ["customs", "Anchor"],
  ["emcs", "ArrowsLeftRight"],
  ["fx", "CurrencyCircleDollar"],
  ["payroll", "UsersThree"],
  ["api", "Plugs"],
];

export function ClientDrawer({ c, closeHref, caps }: { c: ClientDetail; closeHref: string; caps: { write: boolean; billing: boolean; support: boolean } }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const close = () => router.push(closeHref, { scroll: false });
  const [reason, setReason] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);

  const [toggleModule, togglingModule] = useAction(setModule);
  const [suspend, suspending] = useAction(setClientSuspended, { onDone: (r) => r.ok && setConfirmSuspend(false) });
  const [open, opening] = useAction(openSupport, { onDone: (r) => r.ok && setReason("") });
  const [end, ending] = useAction(endSupport);
  const [enter, entering] = useAction(openClientApp, {
    refresh: false,
    onDone: (r) => {
      if (r.ok && typeof r.url === "string") window.location.href = r.url;
    },
  });

  const suspended = c.status === "SUSPENDED";
  const header = (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 0, flex: 1 }}>
      <div style={{ width: 46, height: 46, flex: "none", borderRadius: 10, background: "#f9eef2", color: "#7a1f3d", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 15 }}>{c.initials}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 18 }}>{c.name}</div>
        <div className="n" style={{ fontSize: 13, color: "#5b6474" }}>
          {c.countryLine} · {c.vatNumber || "—"} · {t("admin.clients.since", { date: c.since })}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <Pill tone={CLIENT_STATUS_TONE[c.status]}>{c.statusLabel}</Pill>
          <span style={{ fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 6, background: "#f0f2f5", color: "#3a4250" }}>{t(`admin.plan.${c.plan}`)}</span>
        </div>
      </div>
    </div>
  );

  const footer = (
    <div style={{ display: "flex", gap: 8, justifyContent: "space-between", width: "100%", flexWrap: "wrap" }}>
      {caps.billing ? (
        <button className="btn btn-ghost btn-danger" style={{ color: suspended ? "#157347" : "#b42318" }} onClick={() => (suspended ? suspend(c.id, false) : setConfirmSuspend(true))} disabled={suspending}>
          {suspended ? t("admin.clients.reactivate") : t("admin.clients.suspend")}
        </button>
      ) : (
        <span />
      )}
      <div style={{ display: "flex", gap: 8 }}>
        {caps.billing ? (
          <button className="btn" onClick={() => setPlanOpen(true)}>
            {t("admin.clients.changePlan")}
          </button>
        ) : null}
        {caps.write ? (
          <button className="btn btn-primary" onClick={() => setEditOpen(true)}>
            <Icon name="PencilSimple" size={16} />
            {t("admin.clients.edit")}
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      <Drawer open onClose={close} width={680} header={header} footer={caps.billing || caps.write ? footer : undefined}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: "12px 18px" }}>
          {c.facts.map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: 12, color: "#5b6474" }}>{l}</div>
              <div className="n" style={{ fontSize: 14, fontWeight: 500 }}>{v}</div>
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{t("admin.clients.modules")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {MODULES.map(([k, icon]) => {
              const on = c.modules.includes(k);
              return (
                <button
                  key={k}
                  aria-pressed={on}
                  disabled={!caps.write || togglingModule}
                  onClick={() => toggleModule(c.id, k, !on)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 11px", borderRadius: 8, border: `1px solid ${on ? "#7a1f3d" : "#d5d9e0"}`, background: on ? "#f9eef2" : "#fff", color: on ? "#7a1f3d" : "#5b6474", fontSize: 13, fontWeight: 500, cursor: caps.write ? "pointer" : "default" }}
                >
                  <Icon name={icon} size={15} />
                  {t(`admin.module.${k}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{t("admin.clients.users")}</div>
            {caps.write ? (
              <button onClick={() => setInviteOpen(true)} style={{ border: 0, background: "none", fontSize: 13, fontWeight: 500, color: "#7a1f3d" }}>
                + {t("admin.users.invite")}
              </button>
            ) : null}
          </div>
          <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
            {c.users.length === 0 ? <div style={{ padding: "12px", color: "#5b6474", fontSize: 13.5 }}>{t("admin.clients.noUsers")}</div> : null}
            {c.users.map((u) => {
              const m = mfaView(u.mfa, t);
              return (
                <div key={u.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px 120px", gap: 10, padding: "9px 12px", fontSize: 13.5, borderBottom: "1px solid #f0f2f5", alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>
                      {u.name}
                      {u.status !== "ACTIVE" ? (
                        <span style={{ marginLeft: 6 }}>
                          <Pill tone={u.status === "INVITED" ? "blue" : u.status === "LOCKED" ? "red" : "gray"}>{t(`admin.userStatus.${u.status}`)}</Pill>
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate" style={{ fontSize: 12, color: "#5b6474" }}>{u.email}</div>
                  </div>
                  <span style={{ fontSize: 12.5 }}>{t(`admin.role.${u.role}`)}</span>
                  <span style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12.5, color: m.color }}>
                    <Icon name={m.icon} size={15} />
                    {m.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {caps.support ? (
          <div style={{ padding: 14, borderRadius: 10, background: "#fcf5f7", border: "1px solid #f1d5df", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <Icon name="Headset" size={20} color="#7a1f3d" />
              <div>
                <div style={{ fontWeight: 600 }}>{t("admin.support.title")}</div>
                <div style={{ fontSize: 13, color: "#5b6474" }}>{t("admin.support.text")}</div>
              </div>
            </div>
            {c.support ? (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#7a1f3d", background: "#fff", border: "1px dashed #e3b8c6", borderRadius: 8, padding: "8px 10px" }}>
                  <Icon name="ClockCountdown" size={16} />
                  <span>{t("admin.support.active", { name: c.support.staffName, time: c.support.until, reason: c.support.reason })}</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {c.support.mine ? (
                    <button className="btn btn-primary" onClick={() => enter(c.support!.id)} disabled={entering}>
                      <Icon name="SignIn" size={16} />
                      {t("admin.support.openApp")}
                    </button>
                  ) : null}
                  {c.support.mine || caps.write ? (
                    <button className="btn" onClick={() => end(c.support!.id)} disabled={ending}>
                      <Icon name="Stop" size={16} />
                      {t("admin.support.end")}
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  className="input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("admin.support.reasonPh")}
                  aria-label={t("admin.support.reason")}
                  style={{ flex: 1, minWidth: 220, background: "#fff" }}
                  maxLength={300}
                />
                <button
                  className="btn btn-primary"
                  disabled={opening}
                  onClick={() => (reason.trim() ? open(c.id, reason) : toast(t("admin.err.reason"), "error"))}
                >
                  <Icon name="SignIn" size={16} />
                  {t("admin.support.open")}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </Drawer>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} client={{ id: c.id, name: c.name }} />
      <PlanModal open={planOpen} onClose={() => setPlanOpen(false)} clientId={c.id} current={c.plan} />
      <EditModal open={editOpen} onClose={() => setEditOpen(false)} c={c} />
      <AdminModal
        open={confirmSuspend}
        onClose={() => setConfirmSuspend(false)}
        title={t("admin.clients.suspendTitle", { name: c.name })}
        footer={
          <>
            <button className="btn" onClick={() => setConfirmSuspend(false)}>
              {t("common.cancel")}
            </button>
            <button className="btn btn-primary" style={{ background: "#b42318", borderColor: "#b42318" }} disabled={suspending} onClick={() => suspend(c.id, true)}>
              {t("admin.clients.suspend")}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, color: "#3a4250", fontSize: 13.5 }}>{t("admin.clients.suspendText")}</p>
      </AdminModal>
    </>
  );
}

function PlanModal({ open, onClose, clientId, current }: { open: boolean; onClose: () => void; clientId: string; current: Plan }) {
  const { t } = useI18n();
  const [plan, setPlan] = useState<Plan>(current);
  const [run, pending] = useAction(changePlan, { onDone: (r) => r.ok && onClose() });
  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={t("admin.clients.changePlan")}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" disabled={pending || plan === current} onClick={() => run(clientId, plan)}>
            {t("admin.clients.savePlan")}
          </button>
        </>
      }
    >
      <PlanCards value={plan} onChange={setPlan} />
      <div style={{ fontSize: 12.5, color: "#5b6474" }}>{t("admin.clients.planNote")}</div>
    </AdminModal>
  );
}

export function PlanCards({ value, onChange }: { value: Plan; onChange: (p: Plan) => void }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8 }}>
      {PLAN_KEYS.map((p) => {
        const on = value === p;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(p)}
            style={{ textAlign: "left", padding: "10px 12px", borderRadius: 9, border: `1px solid ${on ? "#7a1f3d" : "#e4e7ec"}`, background: on ? "#fcf5f7" : "#fff", boxShadow: on ? "0 0 0 3px #f1d5df" : "none", color: "#14171f" }}
          >
            <div style={{ fontWeight: 600 }}>{t(`admin.plan.${p}`)}</div>
            <div className="n" style={{ fontSize: 12.5, color: "#5b6474" }}>{t(`admin.plans.short.${p}`)}</div>
          </button>
        );
      })}
    </div>
  );
}

function EditModal({ open, onClose, c }: { open: boolean; onClose: () => void; c: ClientDetail }) {
  const { t } = useI18n();
  const [name, setName] = useState(c.name);
  const [vat, setVat] = useState(c.vatNumber);
  const [country, setCountry] = useState(c.country);
  const [run, pending] = useAction(updateClient, { onDone: (r) => r.ok && onClose() });
  return (
    <AdminModal
      open={open}
      onClose={onClose}
      width={520}
      title={t("admin.clients.edit")}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" disabled={pending || name.trim().length < 2} onClick={() => run(c.id, { name, vatNumber: vat, country })}>
            {t("common.save")}
          </button>
        </>
      }
    >
      <label className="field">
        {t("admin.new.name")}
        <input className="input" style={{ height: 40 }} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#3a4250", marginBottom: 6 }}>{t("admin.new.country")}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {COUNTRY_CODES.map((cc) => (
            <ChoiceChip key={cc} on={country === cc} onClick={() => setCountry(cc)}>
              {COUNTRY_FLAGS[cc]} {cc}
            </ChoiceChip>
          ))}
        </div>
      </div>
      <label className="field">
        {t("admin.new.vat")}
        <input className="input" style={{ height: 40 }} value={vat} onChange={(e) => setVat(e.target.value)} />
      </label>
    </AdminModal>
  );
}
