"use client";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { useAction } from "@/components/client";
import { ROLES } from "@/lib/permissions";
import { AdminModal, ChoiceChip } from "./ui";
import { inviteUser } from "./clients/actions";

/** "Invite a user": email, client (fixed or chosen), role chips with descriptions. */
export function InviteModal({
  open,
  onClose,
  client,
  clients,
}: {
  open: boolean;
  onClose: () => void;
  client?: { id: string; name: string };
  clients?: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("BOOKKEEPER");
  const [clientId, setClientId] = useState(client?.id ?? clients?.[0]?.id ?? "");
  const [run, pending] = useAction(inviteUser, {
    onDone: (r) => {
      if (r.ok) {
        setEmail("");
        setRole("BOOKKEEPER");
        onClose();
      }
    },
  });
  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={t("admin.invite.title")}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" disabled={pending || !email.trim() || !clientId} onClick={() => run({ clientId, email, role })}>
            {t("admin.invite.send")}
          </button>
        </>
      }
    >
      <label className="field">
        {t("admin.invite.email")}
        <input className="input" style={{ height: 40 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoFocus />
      </label>
      {client ? (
        <div style={{ fontSize: 13, color: "#3a4250" }}>
          {t("admin.invite.client")}: <b style={{ fontWeight: 600 }}>{client.name}</b>
        </div>
      ) : (
        <label className="field">
          {t("admin.invite.client")}
          <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#3a4250", marginBottom: 6 }}>{t("admin.invite.role")}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ROLES.map((r) => (
            <ChoiceChip key={r} on={role === r} onClick={() => setRole(r)}>
              {t(`admin.role.${r}`)}
            </ChoiceChip>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: "#5b6474", marginTop: 8 }}>{t(`admin.roleDesc.${role}`)}</div>
      </div>
    </AdminModal>
  );
}
