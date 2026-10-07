"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Role, StaffRole } from "@prisma/client";
import { useI18n } from "@/i18n/client";
import { useAction } from "@/components/client";
import { Icon, type IconName } from "@/components/icon";
import { Pill } from "@/components/ui";
import { ROLES } from "@/lib/permissions";
import { initialsOf, mfaView, relTime, USER_STATUS_TONE } from "@/lib/admin/format";
import type { UserRow } from "@/lib/admin/data";
import { AdminModal, ChoiceChip } from "../ui";
import { InviteModal } from "../invite-modal";
import { addStaff, changeRole, resendInvite, resetTwoFactor, sendStaffSetupLink, setStaffDisabled, setUserDisabled, signOutEverywhere, unlockUser } from "./actions";

const COLS = "minmax(0,1.6fr) minmax(0,1.3fr) 110px 125px 115px 100px 180px";

export function UsersHeader({ clients, canInvite, canAddStaff, q, tab }: { clients: { id: string; name: string }[]; canInvite: boolean; canAddStaff: boolean; q: string; tab: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [invite, setInvite] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [query, setQuery] = useState(q);
  return (
    <div className="page-head" style={{ marginBottom: 18 }}>
      <div>
        <div className="eyebrow">{t("admin.users.eyebrow")}</div>
        <h1>{t("admin.users.title")}</h1>
      </div>
      <div className="page-actions">
        {tab !== "staff" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const p = new URLSearchParams();
              if (tab !== "all") p.set("tab", tab);
              if (query.trim()) p.set("q", query.trim());
              router.push(`/admin/users${p.size ? `?${p}` : ""}`);
            }}
            className="search"
            style={{ width: 240, height: 36 }}
          >
            <Icon name="MagnifyingGlass" size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.users.filter")} aria-label={t("admin.users.filter")} />
          </form>
        ) : null}
        {canAddStaff ? (
          <button className="btn btn-primary" onClick={() => setStaffOpen(true)}>
            <Icon name="UserPlus" size={16} />
            {t("admin.staff.add")}
          </button>
        ) : canInvite ? (
          <button className="btn btn-primary" onClick={() => setInvite(true)}>
            <Icon name="UserPlus" size={16} />
            {t("admin.users.invite")}
          </button>
        ) : null}
      </div>
      {canInvite ? <InviteModal open={invite} onClose={() => setInvite(false)} clients={clients} /> : null}
      {canAddStaff ? <AddStaffModal open={staffOpen} onClose={() => setStaffOpen(false)} /> : null}
    </div>
  );
}

/** Small fixed-position menu (escapes the table's overflow clipping). */
function RowMenu({ items, label }: { items: { label: string; icon: IconName; onClick: () => void; danger?: boolean }[]; label: string }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const h = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null);
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    const s = () => setPos(null);
    document.addEventListener("mousedown", h);
    window.addEventListener("keydown", k);
    window.addEventListener("scroll", s, true);
    return () => {
      document.removeEventListener("mousedown", h);
      window.removeEventListener("keydown", k);
      window.removeEventListener("scroll", s, true);
    };
  }, [pos]);
  if (!items.length) return <span style={{ width: 30 }} />;
  return (
    <>
      <button
        ref={btn}
        aria-label={label}
        title={label}
        className="btn btn-icon"
        style={{ width: 30, height: 30, color: "#5b6474" }}
        onClick={() => {
          if (pos) return setPos(null);
          const r = btn.current!.getBoundingClientRect();
          setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
        }}
      >
        <Icon name="DotsThreeVertical" size={17} />
      </button>
      {pos ? (
        <div ref={menu} className="menu" style={{ position: "fixed", top: pos.top, right: pos.right, width: 230 }}>
          {items.map((it) => (
            <button
              key={it.label}
              className="menu-item"
              style={it.danger ? { color: "#b42318" } : undefined}
              onClick={() => {
                setPos(null);
                it.onClick();
              }}
            >
              <Icon name={it.icon} size={16} color={it.danger ? "#b42318" : "#5b6474"} />
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function UsersTable({ rows, caps }: { rows: UserRow[]; caps: { support: boolean; write: boolean } }) {
  const { t, fmt } = useI18n();
  const [roleFor, setRoleFor] = useState<UserRow | null>(null);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [resend, resending] = useAction(resendInvite);
  const [unlock, unlocking] = useAction(unlockUser);
  const [reset, resetting] = useAction(resetTwoFactor, { onDone: (r) => r.ok && setResetFor(null) });
  const [signOut] = useAction(signOutEverywhere);
  const [disable] = useAction(setUserDisabled);
  const busy = resending || unlocking || resetting;

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 960 }}>
        <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 12 }}>
          <div>{t("admin.users.col.user")}</div>
          <div>{t("admin.users.col.client")}</div>
          <div>{t("admin.users.col.role")}</div>
          <div>{t("admin.users.col.mfa")}</div>
          <div>{t("admin.users.col.last")}</div>
          <div>{t("admin.users.col.status")}</div>
          <div />
        </div>
        {rows.length === 0 ? <div className="empty">{t("admin.users.empty")}</div> : null}
        {rows.map((u) => {
          const m = mfaView(u.mfa, t);
          const first = u.memberships[0];
          const status = u.locked ? "LOCKED" : u.status;
          const more: { label: string; icon: IconName; onClick: () => void; danger?: boolean }[] = [];
          if (caps.write && u.memberships.length) more.push({ label: t("admin.users.changeRole"), icon: "Key", onClick: () => setRoleFor(u) });
          if (caps.support && u.status !== "INVITED") more.push({ label: t("admin.users.signOutAll"), icon: "SignOut", onClick: () => signOut(u.id) });
          if (caps.write)
            more.push(
              u.status === "DISABLED"
                ? { label: t("admin.users.enable"), icon: "CheckCircle", onClick: () => disable(u.id, false) }
                : { label: t("admin.users.disable"), icon: "Prohibit", onClick: () => disable(u.id, true), danger: true },
            );
          return (
            <div key={u.id} className="adm-hover" style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "10px 16px", alignItems: "center", fontSize: 13.5, borderBottom: "1px solid #eef0f3" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={{ width: 30, height: 30, flex: "none", borderRadius: "50%", background: "#f0f2f5", display: "grid", placeItems: "center", fontWeight: 600, fontSize: 11.5, color: "#3a4250" }}>{initialsOf(u.name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{u.name}</div>
                  <div className="truncate" style={{ fontSize: 12.5, color: "#5b6474" }}>{u.email}</div>
                </div>
              </div>
              <div className="truncate" title={u.memberships.map((x) => x.clientName).join(", ")}>
                {first ? first.clientName : "—"}
                {u.memberships.length > 1 ? <span style={{ color: "#8a93a3" }}> +{u.memberships.length - 1}</span> : null}
              </div>
              <div>
                {first ? <span style={{ fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 6, background: "#f0f2f5", color: "#3a4250" }}>{t(`admin.role.${first.role}`)}</span> : "—"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: m.color }}>
                <Icon name={m.icon} size={16} />
                {m.label}
              </div>
              <div style={{ color: "#5b6474" }}>{relTime(u.lastSignInAt, t, fmt)}</div>
              <div title={u.locked && u.lockReason ? u.lockReason : undefined}>
                <Pill tone={USER_STATUS_TONE[status]}>{t(`admin.userStatus.${status}`)}</Pill>
              </div>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                {caps.support && u.status === "INVITED" ? (
                  <button className="btn btn-sm" disabled={busy} onClick={() => resend(u.id)} style={{ fontSize: 12.5, padding: "0 10px" }}>
                    {t("admin.users.resend")}
                  </button>
                ) : null}
                {caps.support && u.locked ? (
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => unlock(u.id)} style={{ fontSize: 12.5, padding: "0 10px" }}>
                    {t("admin.users.unlock")}
                  </button>
                ) : null}
                {caps.support && u.status === "ACTIVE" && !u.locked && u.mfa !== "none" ? (
                  <button className="btn btn-sm" disabled={busy} onClick={() => setResetFor(u)} style={{ fontSize: 12.5, padding: "0 10px" }}>
                    {t("admin.users.reset2fa")}
                  </button>
                ) : null}
                <RowMenu items={more} label={t("admin.users.more")} />
              </div>
            </div>
          );
        })}
      </div>
      {roleFor ? <RoleModal user={roleFor} onClose={() => setRoleFor(null)} /> : null}
      <AdminModal
        open={!!resetFor}
        onClose={() => setResetFor(null)}
        title={t("admin.users.resetTitle", { name: resetFor?.name ?? "" })}
        footer={
          <>
            <button className="btn" onClick={() => setResetFor(null)}>
              {t("common.cancel")}
            </button>
            <button className="btn btn-primary" disabled={resetting} onClick={() => resetFor && reset(resetFor.id)}>
              {t("admin.users.reset2fa")}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, color: "#3a4250", fontSize: 13.5 }}>{t("admin.users.resetText")}</p>
      </AdminModal>
    </div>
  );
}

function RoleModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { t } = useI18n();
  const [adminId, setAdminId] = useState(user.memberships[0]!.administrationId);
  const current = user.memberships.find((m) => m.administrationId === adminId)!;
  const [role, setRole] = useState<Role>(current.role);
  const [run, pending] = useAction(changeRole, { onDone: (r) => r.ok && onClose() });
  return (
    <AdminModal
      open
      onClose={onClose}
      title={t("admin.users.changeRoleFor", { name: user.name })}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" disabled={pending || role === current.role} onClick={() => run(user.id, adminId, role)}>
            {t("common.save")}
          </button>
        </>
      }
    >
      {user.memberships.length > 1 ? (
        <label className="field">
          {t("admin.invite.client")}
          <select
            className="select"
            value={adminId}
            onChange={(e) => {
              setAdminId(e.target.value);
              setRole(user.memberships.find((m) => m.administrationId === e.target.value)!.role);
            }}
          >
            {user.memberships.map((m) => (
              <option key={m.administrationId} value={m.administrationId}>
                {m.clientName}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div style={{ fontSize: 13, color: "#3a4250" }}>
          {t("admin.invite.client")}: <b style={{ fontWeight: 600 }}>{current.clientName}</b>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ROLES.map((r) => (
          <ChoiceChip key={r} on={role === r} onClick={() => setRole(r)}>
            {t(`admin.role.${r}`)}
          </ChoiceChip>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: "#5b6474" }}>{t(`admin.roleDesc.${role}`)}</div>
    </AdminModal>
  );
}

// ── Platform staff ──────────────────────────────────────────────────────────

type StaffRow = { id: string; name: string; email: string; role: StaffRole; passkey: boolean; status: string; lastSignInAt: string | null };

export function StaffTable({ rows, canManage, meId }: { rows: StaffRow[]; canManage: boolean; meId: string }) {
  const { t, fmt } = useI18n();
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [send, sending] = useAction(sendStaffSetupLink);
  const [disable] = useAction(setStaffDisabled);
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 960 }}>
        <div className="tbl-head" style={{ gridTemplateColumns: COLS, gap: 12 }}>
          <div>{t("admin.users.col.user")}</div>
          <div>{t("admin.users.col.client")}</div>
          <div>{t("admin.users.col.role")}</div>
          <div>{t("admin.users.col.mfa")}</div>
          <div>{t("admin.users.col.last")}</div>
          <div>{t("admin.users.col.status")}</div>
          <div />
        </div>
        {rows.map((s) => {
          const m = mfaView(s.passkey ? "passkey" : "none", t);
          return (
            <div key={s.id} className="adm-hover" style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "10px 16px", alignItems: "center", fontSize: 13.5, borderBottom: "1px solid #eef0f3" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={{ width: 30, height: 30, flex: "none", borderRadius: "50%", background: "#f9eef2", color: "#7a1f3d", display: "grid", placeItems: "center", fontWeight: 600, fontSize: 11.5 }}>{initialsOf(s.name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>
                    {s.name}
                    {s.id === meId ? <span style={{ color: "#8a93a3", fontWeight: 400 }}> · {t("admin.staff.you")}</span> : null}
                  </div>
                  <div className="truncate" style={{ fontSize: 12.5, color: "#5b6474" }}>{s.email}</div>
                </div>
              </div>
              <div className="truncate">{t("admin.staff.org")}</div>
              <div>
                <span style={{ fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 6, background: "#f9eef2", color: "#7a1f3d" }}>{t(`admin.staffRole.${s.role}`)}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: m.color }}>
                <Icon name={m.icon} size={16} />
                {m.label}
              </div>
              <div style={{ color: "#5b6474" }}>{relTime(s.lastSignInAt, t, fmt)}</div>
              <div>
                <Pill tone={USER_STATUS_TONE[s.status] ?? "gray"}>{t(`admin.userStatus.${s.status}`)}</Pill>
              </div>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                {canManage ? (
                  <button
                    className="btn btn-sm"
                    disabled={sending}
                    style={{ fontSize: 12.5, padding: "0 10px" }}
                    onClick={async () => {
                      const r = await send(s.id);
                      if (r.ok && typeof r.link === "string") setLink({ email: s.email, url: r.link });
                    }}
                  >
                    {t("admin.staff.sendLink")}
                  </button>
                ) : null}
                <RowMenu
                  label={t("admin.users.more")}
                  items={
                    canManage && s.id !== meId
                      ? [s.status === "DISABLED" ? { label: t("admin.users.enable"), icon: "CheckCircle" as IconName, onClick: () => disable(s.id, false) } : { label: t("admin.users.disable"), icon: "Prohibit" as IconName, onClick: () => disable(s.id, true), danger: true }]
                      : []
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
      <LinkModal link={link} onClose={() => setLink(null)} />
    </div>
  );
}

function LinkModal({ link, onClose }: { link: { email: string; url: string } | null; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <AdminModal
      open={!!link}
      onClose={onClose}
      width={520}
      title={t("admin.staff.linkTitle")}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      <p style={{ margin: 0, fontSize: 13.5, color: "#3a4250" }}>{t("admin.staff.linkText", { email: link?.email ?? "" })}</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input n" readOnly value={link?.url ?? ""} onFocus={(e) => e.target.select()} style={{ flex: 1, fontSize: 12.5 }} aria-label={t("admin.staff.linkTitle")} />
        <button
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link?.url ?? "");
              setCopied(true);
            } catch {}
          }}
        >
          <Icon name={copied ? "Check" : "Copy"} size={16} />
          {copied ? t("admin.staff.copied") : t("admin.staff.copy")}
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "#9a5b00", display: "flex", gap: 6 }}>
        <Icon name="Warning" size={15} style={{ marginTop: 1 }} />
        {t("admin.staff.linkOnce")}
      </div>
    </AdminModal>
  );
}

function AddStaffModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("SUPPORT");
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [run, pending] = useAction(addStaff, {
    onDone: (r) => {
      if (r.ok) {
        if (typeof r.link === "string") setLink({ email, url: r.link });
        setName("");
        setEmail("");
        onClose();
      }
    },
  });
  return (
    <>
      <AdminModal
        open={open}
        onClose={onClose}
        title={t("admin.staff.add")}
        footer={
          <>
            <button className="btn" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button className="btn btn-primary" disabled={pending || name.trim().length < 2 || !email.includes("@")} onClick={() => run({ name, email, role })}>
              {t("admin.staff.addSubmit")}
            </button>
          </>
        }
      >
        <label className="field">
          {t("common.name")}
          <input className="input" style={{ height: 40 }} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          {t("admin.invite.email")}
          <input className="input" style={{ height: 40 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@liquidledger.net" />
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["SUPER_ADMIN", "SUPPORT", "FINANCE"] as StaffRole[]).map((r) => (
            <ChoiceChip key={r} on={role === r} onClick={() => setRole(r)}>
              {t(`admin.staffRole.${r}`)}
            </ChoiceChip>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: "#5b6474" }}>{t(`admin.staffRoleDesc.${role}`)}</div>
      </AdminModal>
      <LinkModal link={link} onClose={() => setLink(null)} />
    </>
  );
}
