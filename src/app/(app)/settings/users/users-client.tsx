"use client";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { Icon } from "@/components/icon";
import { Dropdown, Modal, useAction } from "@/components/client";
import { changeRole, inviteUser, removeMember, resendInvite } from "./actions";

export type MemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  initials: string;
  role: string;
  mfa: string;
  lastSignIn: string | null;
  status: "INVITED" | "ACTIVE" | "LOCKED" | "DISABLED";
  inviteNote: string | null;
  isYou: boolean;
};

const STATUS_TONE: Record<MemberRow["status"], string> = { ACTIVE: "pill-green", INVITED: "pill-blue", LOCKED: "pill-red", DISABLED: "pill-gray" };
const COLS = "minmax(180px,1.6fr) 124px minmax(110px,1fr) 100px 88px 32px";

export function UsersClient({
  rows,
  canEdit,
  isOwner,
  roles,
  planLabel,
  used,
  limit,
  company,
}: {
  rows: MemberRow[];
  canEdit: boolean;
  isOwner: boolean;
  roles: { key: string; label: string; desc: string }[];
  planLabel: string;
  used: number;
  limit: number | null;
  company: string;
}) {
  const { t } = useI18n();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<MemberRow | null>(null);
  const [setRole, settingRole] = useAction(changeRole);
  const [resend, resending] = useAction(resendInvite);
  const roleLabel = (k: string) => roles.find((r) => r.key === k)?.label ?? k;
  const full = limit !== null && used >= limit;

  return (
    <>
      <section className="card card-clip">
        <div className="card-pad" style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", paddingBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="card-title">{t("settings.users.title")}</div>
            <div className="muted" style={{ fontSize: 13 }}>{t("settings.users.text", { company })}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className={`pill ${full ? "pill-amber" : "pill-gray"}`}>
              {limit === null ? t("settings.users.seatsUnlimited", { n: used, plan: planLabel }) : t("settings.users.seats", { n: used, limit, plan: planLabel })}
            </span>
            {canEdit ? (
              <button className="btn btn-primary" onClick={() => setInviteOpen(true)}>
                <Icon name="UserPlus" size={16} />
                {t("settings.users.invite")}
              </button>
            ) : null}
          </div>
        </div>
        <div className="tbl">
          <div className="tbl-head" style={{ gridTemplateColumns: COLS, minWidth: 700 }}>
            <span>{t("settings.users.user")}</span>
            <span>{t("settings.users.role")}</span>
            <span>{t("settings.users.twoFactor")}</span>
            <span>{t("settings.users.lastSignIn")}</span>
            <span>{t("common.status")}</span>
            <span />
          </div>
          {rows.map((r) => {
            const lockedOwner = r.role === "OWNER" && !isOwner;
            return (
              <div key={r.id} className="tbl-row" style={{ gridTemplateColumns: COLS, minWidth: 700 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span className="avatar">{r.initials}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="cell-main truncate" style={{ display: "block" }}>
                      {r.name}
                      {r.isYou ? <span className="muted" style={{ fontWeight: 400 }}> · {t("settings.users.you")}</span> : null}
                    </span>
                    <span className="cell-sub truncate" style={{ display: "block" }}>{r.email}</span>
                  </span>
                </span>
                <span>
                  {canEdit && !lockedOwner ? (
                    <select
                      className="select"
                      aria-label={t("settings.users.role")}
                      value={r.role}
                      disabled={settingRole}
                      style={{ height: 32, fontSize: 13 }}
                      onChange={(e) => setRole({ membershipId: r.id, role: e.target.value })}
                    >
                      {roles
                        .filter((o) => o.key !== "OWNER" || isOwner)
                        .map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <span className="pill pill-wine">{roleLabel(r.role)}</span>
                  )}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  {r.mfa ? (
                    <>
                      <Icon name="ShieldCheck" size={15} color="#157347" />
                      <span className="truncate">{r.mfa}</span>
                    </>
                  ) : (
                    <>
                      <Icon name="ShieldWarning" size={15} color="#9a5b00" />
                      <span style={{ color: "#9a5b00" }}>{t("settings.users.mfaNone")}</span>
                    </>
                  )}
                </span>
                <span className="n muted" style={{ fontSize: 13 }}>{r.lastSignIn ?? "—"}</span>
                <span>
                  <span className={`pill ${STATUS_TONE[r.status]}`}>{t(`settings.users.status.${r.status}`)}</span>
                </span>
                <span style={{ display: "flex", justifyContent: "flex-end" }}>
                  {canEdit && ((!r.isYou && !lockedOwner) || r.status === "INVITED") ? (
                    <Dropdown
                      width={220}
                      trigger={(_, toggle) => (
                        <button className="btn btn-icon" onClick={toggle} aria-label={t("common.actions")} style={{ width: 30, height: 30 }}>
                          <Icon name="DotsThreeVertical" size={18} />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          {r.status === "INVITED" ? (
                            <button
                              className="menu-item"
                              disabled={resending}
                              onClick={() => {
                                close();
                                resend({ membershipId: r.id });
                              }}
                            >
                              <Icon name="PaperPlaneTilt" size={16} color="#5b6474" />
                              <span style={{ flex: 1 }}>
                                {t("settings.users.resend")}
                                {r.inviteNote ? <span style={{ display: "block", fontSize: 12, color: "#8a93a3" }}>{r.inviteNote}</span> : null}
                              </span>
                            </button>
                          ) : null}
                          {!r.isYou && !lockedOwner ? (
                            <button
                              className="menu-item"
                              style={{ color: "#b42318" }}
                              onClick={() => {
                                close();
                                setConfirmRemove(r);
                              }}
                            >
                              <Icon name="Trash" size={16} />
                              {t("settings.users.remove")}
                            </button>
                          ) : null}
                        </>
                      )}
                    </Dropdown>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card card-pad">
        <div className="card-title" style={{ marginBottom: 10 }}>{t("settings.users.rolesTitle")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
          {roles.map((r) => (
            <div key={r.key} className="infobox" style={{ padding: "10px 12px" }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{r.label}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{r.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {inviteOpen ? <InviteModal roles={roles.filter((r) => r.key !== "OWNER" || isOwner)} company={company} full={full} limit={limit} onClose={() => setInviteOpen(false)} /> : null}
      {confirmRemove ? <RemoveModal row={confirmRemove} onClose={() => setConfirmRemove(null)} /> : null}
    </>
  );
}

function InviteModal({ roles, company, full, limit, onClose }: { roles: { key: string; label: string; desc: string }[]; company: string; full: boolean; limit: number | null; onClose: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("BOOKKEEPER");
  const [run, pending] = useAction(inviteUser, { onDone: (r) => r.ok && onClose() });
  const desc = roles.find((r) => r.key === role)?.desc;
  return (
    <Modal
      open
      onClose={onClose}
      title={t("settings.users.inviteTitle")}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" type="submit" form="invite-form" disabled={pending || !email.trim()}>
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="PaperPlaneTilt" size={16} />}
            {t("settings.users.sendInvite")}
          </button>
        </>
      }
    >
      <form
        id="invite-form"
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          run({ email, role });
        }}
      >
        <label className="field">
          {t("common.email")}
          <input className="input" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus style={{ height: 40 }} />
        </label>
        <div style={{ fontSize: 13, color: "#3a4250" }}>
          {t("settings.users.administration")}: <b style={{ fontWeight: 600 }}>{company}</b>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#3a4250", marginBottom: 6 }}>{t("settings.users.role")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="radiogroup">
            {roles.map((r) => (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={role === r.key}
                onClick={() => setRole(r.key)}
                style={{
                  height: 32,
                  padding: "0 11px",
                  borderRadius: 8,
                  border: `1px solid ${role === r.key ? "#7a1f3d" : "#d5d9e0"}`,
                  background: role === r.key ? "#7a1f3d" : "#fff",
                  color: role === r.key ? "#fff" : "#14171f",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: "#5b6474", marginTop: 8 }}>{desc}</div>
        </div>
        {full ? (
          <div className="banner banner-warn">
            <Icon name="Warning" size={17} />
            {t("settings.users.limitReached", { n: limit ?? 0 })}
          </div>
        ) : (
          <div className="banner banner-info" style={{ background: "#f5f6f8", color: "#3a4250" }}>
            <Icon name="ShieldCheck" size={17} color="#157347" />
            {t("settings.users.inviteNote")}
          </div>
        )}
      </form>
    </Modal>
  );
}

function RemoveModal({ row, onClose }: { row: MemberRow; onClose: () => void }) {
  const { t } = useI18n();
  const [run, pending] = useAction(removeMember, { onDone: (r) => r.ok && onClose() });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("settings.users.removeTitle", { name: row.name })}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" style={{ background: "#b42318", borderColor: "#b42318" }} disabled={pending} onClick={() => run({ membershipId: row.id })}>
            <Icon name="Trash" size={16} />
            {t("settings.users.remove")}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 13.5, color: "#3a4250" }}>{t("settings.users.removeText", { email: row.email })}</p>
    </Modal>
  );
}
