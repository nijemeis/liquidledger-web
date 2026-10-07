"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useI18n } from "@/i18n/client";
import { Icon, type IconName } from "@/components/icon";
import { Modal, useAction, useToast } from "@/components/client";
import { CodeBoxes, type CodeBoxesHandle } from "@/components/code-boxes";
import { RecoveryCodes } from "@/components/recovery-codes";
import {
  changePassword,
  regenerateCodes,
  removePasskey,
  renamePasskey,
  revokeOtherSessions,
  revokeSession,
  smsConfirm,
  smsRemove,
  smsStart,
  totpConfirm,
  totpRemove,
  totpStart,
  untrustDevice,
} from "./actions";

type Passkey = { id: string; name: string; created: string; lastUsed: string | null; synced: boolean };
type SessionRow = { id: string; device: string; mobile: boolean; ip: string; lastSeen: string; started: string; method: string; current: boolean };
type DeviceRow = { id: string; device: string; mobile: boolean; ip: string; lastSeen: string; until: string; current: boolean };

type Dialog =
  | { kind: "password" }
  | { kind: "totp" }
  | { kind: "totpRemove" }
  | { kind: "passkeyAdd" }
  | { kind: "passkeyRemove"; key: Passkey }
  | { kind: "passkeyRename"; key: Passkey }
  | { kind: "sms" }
  | { kind: "codes" }
  | null;

export function SecurityClient(props: {
  passwordChanged: string | null;
  totp: string | null;
  sms: string | null;
  smsAvailable: boolean;
  passkeys: Passkey[];
  codesLeft: number;
  sessions: SessionRow[];
  devices: DeviceRow[];
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const [revoke, revoking] = useAction(revokeSession);
  const [revokeOthers, revokingOthers] = useAction(revokeOtherSessions);
  const [untrust, untrusting] = useAction(untrustDevice);
  const [removeSms, removingSms] = useAction(smsRemove);
  const others = props.sessions.filter((s) => !s.current).length;
  const strong = (props.totp ? 1 : 0) + props.passkeys.length;

  return (
    <>
      {/* Password */}
      <section className="card card-pad">
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <MethodTile icon="Password" />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="card-title">{t("settings.security.password")}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {props.passwordChanged ? t("settings.security.passwordChangedOn", { date: props.passwordChanged }) : t("settings.security.passwordText")}
            </div>
          </div>
          <button className="btn" onClick={() => setDialog({ kind: "password" })}>
            <Icon name="PencilSimple" size={16} />
            {t("settings.security.changePassword")}
          </button>
        </div>
      </section>

      {/* Two-factor */}
      <section className="card card-clip">
        <div className="card-pad" style={{ paddingBottom: 12, borderBottom: "1px solid #eef0f3" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div className="card-title">{t("settings.security.twoFactor")}</div>
            <span className="pill pill-green">
              <Icon name="ShieldCheck" size={13} />
              {t("settings.security.required")}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{t("settings.security.twoFactorText")}</div>
        </div>

        {/* Passkeys */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #eef0f3" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <MethodTile icon="Fingerprint" />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {t("settings.security.passkeys")}
                <span className="pill pill-wine">{t("settings.security.recommended")}</span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>{t("settings.security.passkeysText")}</div>
            </div>
            <button className="btn" onClick={() => setDialog({ kind: "passkeyAdd" })}>
              <Icon name="Plus" size={16} />
              {t("settings.security.addPasskey")}
            </button>
          </div>
          {props.passkeys.length ? (
            <div className="tbl" style={{ marginTop: 12, border: "1px solid #e4e7ec", borderRadius: 10 }}>
              <div className="tbl-head" style={{ gridTemplateColumns: "minmax(160px,1.4fr) 1fr 1fr 150px", minWidth: 560 }}>
                <span>{t("settings.security.name")}</span>
                <span>{t("settings.security.added")}</span>
                <span>{t("settings.security.lastUsed")}</span>
                <span />
              </div>
              {props.passkeys.map((k) => (
                <div key={k.id} className="tbl-row" style={{ gridTemplateColumns: "minmax(160px,1.4fr) 1fr 1fr 150px", minWidth: 560 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <Icon name="Key" size={16} color="#7a1f3d" />
                    <span className="cell-main truncate">{k.name}</span>
                    {k.synced ? <span className="pill pill-gray">{t("settings.security.synced")}</span> : null}
                  </span>
                  <span className="n muted">{k.created}</span>
                  <span className="n muted">{k.lastUsed ?? t("common.never")}</span>
                  <span style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setDialog({ kind: "passkeyRename", key: k })}>
                      {t("settings.security.rename")}
                    </button>
                    <button
                      className="btn btn-sm btn-ghost btn-danger"
                      onClick={() => setDialog({ kind: "passkeyRemove", key: k })}
                      disabled={strong <= 1}
                      title={strong <= 1 ? t("settings.security.lastFactor") : undefined}
                    >
                      {t("settings.security.remove")}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Authenticator app */}
        <MethodRow
          icon="DeviceMobile"
          title={t("settings.security.app")}
          text={props.totp ? t("settings.security.appOn", { date: props.totp }) : t("settings.security.appText")}
          status={props.totp ? <span className="pill pill-green">{t("settings.security.on")}</span> : <span className="pill pill-gray">{t("settings.security.off")}</span>}
        >
          {props.totp && props.passkeys.length ? (
            <button className="btn btn-ghost btn-danger" onClick={() => setDialog({ kind: "totpRemove" })}>
              {t("settings.security.remove")}
            </button>
          ) : null}
          <button className="btn" onClick={() => setDialog({ kind: "totp" })}>
            <Icon name="QrCode" size={16} />
            {props.totp ? t("settings.security.replace") : t("settings.security.setUp")}
          </button>
        </MethodRow>

        {/* SMS */}
        <MethodRow
          icon="ChatText"
          title={t("settings.security.sms")}
          text={props.sms ? t("settings.security.smsOn", { phone: props.sms }) : t("settings.security.smsText")}
          status={props.sms ? <span className="pill pill-green">{t("settings.security.on")}</span> : <span className="pill pill-gray">{t("settings.security.fallback")}</span>}
        >
          {props.sms ? (
            <button className="btn btn-ghost btn-danger" disabled={removingSms} onClick={() => removeSms()}>
              {t("settings.security.remove")}
            </button>
          ) : null}
          <button className="btn" disabled={!props.smsAvailable} onClick={() => setDialog({ kind: "sms" })}>
            <Icon name="Phone" size={16} />
            {props.sms ? t("settings.security.changePhone") : t("settings.security.addPhone")}
          </button>
        </MethodRow>

        {/* Recovery codes */}
        <MethodRow
          icon="Key"
          title={t("settings.security.codes")}
          text={t("settings.security.codesText")}
          status={<span className={`pill ${props.codesLeft <= 2 ? "pill-amber" : "pill-gray"}`}>{t("settings.security.codesLeft", { n: props.codesLeft })}</span>}
          last
        >
          <button className="btn" onClick={() => setDialog({ kind: "codes" })}>
            <Icon name="ArrowsClockwise" size={16} />
            {t("settings.security.regenerate")}
          </button>
        </MethodRow>
      </section>

      {/* Sessions */}
      <section className="card card-clip">
        <div className="card-pad" style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", paddingBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="card-title">{t("settings.security.sessions")}</div>
            <div className="muted" style={{ fontSize: 13 }}>{t("settings.security.sessionsText")}</div>
          </div>
          <button className="btn" disabled={!others || revokingOthers} onClick={() => revokeOthers()}>
            <Icon name="SignOut" size={16} />
            {t("settings.security.signOutOthers")}
          </button>
        </div>
        <div className="tbl">
          <div className="tbl-head" style={{ gridTemplateColumns: "minmax(250px,2fr) 110px 1fr 1fr 100px", minWidth: 680 }}>
            <span>{t("settings.security.device")}</span>
            <span>{t("settings.security.ip")}</span>
            <span>{t("settings.security.signedIn")}</span>
            <span>{t("settings.security.lastActive")}</span>
            <span />
          </div>
          {props.sessions.map((s) => (
            <div key={s.id} className="tbl-row" style={{ gridTemplateColumns: "minmax(250px,2fr) 110px 1fr 1fr 100px", minWidth: 680 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <Icon name={s.mobile ? "DeviceMobile" : "Laptop"} size={18} color="#5b6474" />
                <span style={{ minWidth: 0 }}>
                  <span className="cell-main" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ whiteSpace: "nowrap" }}>{s.device}</span>
                    {s.current ? <span className="pill pill-green">{t("settings.security.thisDevice")}</span> : null}
                  </span>
                  <span className="cell-sub truncate" style={{ display: "block" }}>{s.method}</span>
                </span>
              </span>
              <span className="n muted">{s.ip}</span>
              <span className="n muted">{s.started}</span>
              <span className="n muted">{s.lastSeen}</span>
              <span style={{ textAlign: "right" }}>
                {!s.current ? (
                  <button className="btn btn-sm" disabled={revoking} onClick={() => revoke({ id: s.id })}>
                    {t("settings.security.signOut")}
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Trusted devices */}
      <section className="card card-clip">
        <div className="card-pad" style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", paddingBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="card-title">{t("settings.security.trusted")}</div>
            <div className="muted" style={{ fontSize: 13 }}>{t("settings.security.trustedText")}</div>
          </div>
          {props.devices.length > 1 ? (
            <button className="btn" disabled={untrusting} onClick={() => untrust({ id: "all" })}>
              {t("settings.security.forgetAll")}
            </button>
          ) : null}
        </div>
        {props.devices.length ? (
          <div className="tbl">
            <div className="tbl-head" style={{ gridTemplateColumns: "minmax(250px,2fr) 110px 1fr 1fr 100px", minWidth: 680 }}>
              <span>{t("settings.security.device")}</span>
              <span>{t("settings.security.ip")}</span>
              <span>{t("settings.security.lastActive")}</span>
              <span>{t("settings.security.trustedUntil")}</span>
              <span />
            </div>
            {props.devices.map((d) => (
              <div key={d.id} className="tbl-row" style={{ gridTemplateColumns: "minmax(250px,2fr) 110px 1fr 1fr 100px", minWidth: 680 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Icon name={d.mobile ? "DeviceMobile" : "Laptop"} size={18} color="#5b6474" />
                  <span className="cell-main" style={{ whiteSpace: "nowrap" }}>{d.device}</span>
                  {d.current ? <span className="pill pill-green">{t("settings.security.thisDevice")}</span> : null}
                </span>
                <span className="n muted">{d.ip}</span>
                <span className="n muted">{d.lastSeen}</span>
                <span className="n muted">{d.until}</span>
                <span style={{ textAlign: "right" }}>
                  <button className="btn btn-sm" disabled={untrusting} onClick={() => untrust({ id: d.id })}>
                    {t("settings.security.forget")}
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted" style={{ padding: "4px 20px 18px", fontSize: 13.5 }}>{t("settings.security.noTrusted")}</div>
        )}
      </section>

      {dialog?.kind === "password" ? <PasswordDialog onClose={close} /> : null}
      {dialog?.kind === "totp" ? <TotpDialog replace={Boolean(props.totp)} onClose={close} /> : null}
      {dialog?.kind === "totpRemove" ? (
        <ConfirmWithPassword title={t("settings.security.removeApp")} text={t("settings.security.removeAppText")} cta={t("settings.security.remove")} danger action={(password) => totpRemove({ password })} onClose={close} />
      ) : null}
      {dialog?.kind === "passkeyRemove" ? (
        <ConfirmWithPassword
          title={t("settings.security.removePasskey", { name: dialog.key.name })}
          text={t("settings.security.removePasskeyText")}
          cta={t("settings.security.remove")}
          danger
          action={(password) => removePasskey({ id: dialog.key.id, password })}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "passkeyRename" ? <RenameDialog k={dialog.key} onClose={close} /> : null}
      {dialog?.kind === "passkeyAdd" ? <PasskeyDialog onClose={close} /> : null}
      {dialog?.kind === "sms" ? <SmsDialog onClose={close} /> : null}
      {dialog?.kind === "codes" ? <CodesDialog onClose={close} /> : null}
    </>
  );
}

function MethodTile({ icon }: { icon: IconName }) {
  return (
    <div style={{ width: 40, height: 40, borderRadius: 10, background: "#f9eef2", color: "#7a1f3d", display: "grid", placeItems: "center", flex: "none" }}>
      <Icon name={icon} size={21} />
    </div>
  );
}

function MethodRow({ icon, title, text, status, children, last }: { icon: IconName; title: string; text: string; status: React.ReactNode; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "16px 20px", borderBottom: last ? 0 : "1px solid #eef0f3" }}>
      <MethodTile icon={icon} />
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 600, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {title}
          {status}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>{text}</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>{children}</div>
    </div>
  );
}

function PwField({ value, onChange, label, autoFocus, autoComplete = "current-password" }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean; autoComplete?: string }) {
  return (
    <label className="field">
      {label}
      <input className="input" type="password" autoComplete={autoComplete} value={value} autoFocus={autoFocus} maxLength={200} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Err({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="banner banner-error" role="alert">
      <Icon name="WarningCircle" size={17} />
      {children}
    </div>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ current: "", next: "", repeat: "" });
  const [error, setError] = useState<string | null>(null);
  const [run, pending] = useAction(changePassword, { onDone: (r) => (r.ok ? onClose() : setError(r.error)) });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("settings.security.changePassword")}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" form="pw-form" type="submit" disabled={pending || !f.current || !f.next || !f.repeat}>
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : null}
            {t("settings.security.changePassword")}
          </button>
        </>
      }
    >
      <form
        id="pw-form"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (f.next !== f.repeat) return setError(t("auth.passwordsDiffer"));
          run(f);
        }}
      >
        <PwField label={t("settings.security.currentPassword")} value={f.current} onChange={(v) => setF({ ...f, current: v })} autoFocus />
        <PwField label={t("auth.newPassword")} value={f.next} onChange={(v) => setF({ ...f, next: v })} autoComplete="new-password" />
        <PwField label={t("auth.confirmPassword")} value={f.repeat} onChange={(v) => setF({ ...f, repeat: v })} autoComplete="new-password" />
        <div className="field-label">{t("auth.resetText")} {t("settings.security.othersSignedOut")}</div>
        <Err>{error}</Err>
      </form>
    </Modal>
  );
}

/** Ask for the password, then run a sensitive action. */
function ConfirmWithPassword({ title, text, cta, danger, action, onClose }: { title: string; text: string; cta: string; danger?: boolean; action: (password: string) => Promise<{ ok: true; message?: string } | { ok: false; error: string }>; onClose: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [run, pending] = useAction(action, { onDone: (r) => (r.ok ? onClose() : setError(r.error)) });
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" form="confirm-pw" type="submit" disabled={pending || !password} style={danger ? { background: "#b42318", borderColor: "#b42318" } : undefined}>
            {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : null}
            {cta}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{text}</p>
      <form
        id="confirm-pw"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          run(password);
        }}
      >
        <PwField label={t("settings.security.confirmWithPassword")} value={password} onChange={setPassword} autoFocus />
      </form>
      <Err>{error}</Err>
    </Modal>
  );
}

function RenameDialog({ k, onClose }: { k: Passkey; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(k.name);
  const [run, pending] = useAction(renamePasskey, { onDone: (r) => r.ok && onClose() });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("settings.security.renamePasskey")}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" form="rename-pk" type="submit" disabled={pending || !name.trim()}>
            {t("common.save")}
          </button>
        </>
      }
    >
      <form
        id="rename-pk"
        onSubmit={(e) => {
          e.preventDefault();
          run({ id: k.id, name });
        }}
      >
        <label className="field">
          {t("settings.security.name")}
          <input className="input" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
          <span className="field-label">{t("settings.security.passkeyNameHint")}</span>
        </label>
      </form>
    </Modal>
  );
}

async function postJson<T>(body: object): Promise<T> {
  const res = await fetch("/api/me/passkeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  return (await res.json()) as T;
}

function PasskeyDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const go = () =>
    start(async () => {
      setError(null);
      if (!browserSupportsWebAuthn()) return setError(t("auth.passkeyUnsupported"));
      try {
        const o = await postJson<{ ok: boolean; options?: Parameters<typeof startRegistration>[0]["optionsJSON"]; pending?: string; error?: string }>({ step: "options", password });
        if (!o.ok || !o.options) return setError(o.error ?? t("settings.err.generic"));
        const response = await startRegistration({ optionsJSON: o.options });
        const r = await postJson<{ ok: boolean; message?: string; error?: string }>({ step: "verify", pending: o.pending, response, name: name.trim() || undefined });
        if (!r.ok) return setError(r.error ?? t("settings.security.passkeyFailed"));
        toast(r.message ?? "");
        router.refresh();
        onClose();
      } catch {
        setError(t("settings.security.passkeyFailed"));
      }
    });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("settings.security.addPasskey")}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn btn-primary" form="add-pk" type="submit" disabled={busy || !password}>
            {busy ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="Fingerprint" size={16} />}
            {t("settings.security.createPasskey")}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t("settings.security.addPasskeyText")}</p>
      <form
        id="add-pk"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <label className="field">
          {t("settings.security.name")} <span className="field-label">({t("settings.security.optional")})</span>
          <input className="input" value={name} maxLength={60} placeholder={t("settings.security.passkeyNamePlaceholder")} onChange={(e) => setName(e.target.value)} />
        </label>
        <PwField label={t("settings.security.confirmWithPassword")} value={password} onChange={setPassword} autoFocus />
      </form>
      <Err>{error}</Err>
    </Modal>
  );
}

function TotpDialog({ replace, onClose }: { replace: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ qr: string; secret: string; pending: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const boxes = useRef<CodeBoxesHandle>(null);
  const [start, starting] = useAction(totpStart, { refresh: false, onDone: (r) => (r.ok ? setSetup({ qr: r.qr as string, secret: r.secret as string, pending: r.pending as string }) : setError(r.error)) });
  const [confirm, confirming] = useAction(totpConfirm, {
    onDone: (r) => {
      if (r.ok) onClose();
      else {
        setError(r.error);
        setShake((s) => s + 1);
        boxes.current?.clear();
      }
    },
  });
  return (
    <Modal open onClose={onClose} title={replace ? t("settings.security.replaceApp") : t("settings.security.setUpApp")} width={500}>
      {!setup ? (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{replace ? t("settings.security.replaceAppText") : t("settings.security.setUpAppText")}</p>
          <form
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start({ password });
            }}
          >
            <PwField label={t("settings.security.confirmWithPassword")} value={password} onChange={setPassword} autoFocus />
            <Err>{error}</Err>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
              <button type="submit" className="btn btn-primary" disabled={starting || !password}>
                {starting ? <Icon name="CircleNotch" size={16} className="spin" /> : null}
                {t("common.next")}
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t("auth.scanText")}</p>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code" width={164} height={164} style={{ border: "1px solid #e4e7ec", borderRadius: 10 }} />
            <div style={{ flex: 1, minWidth: 160, fontSize: 12.5, color: "#5b6474" }}>
              {t("auth.manualKey")}
              <div className="n" data-testid="totp-secret" style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#14171f", wordBreak: "break-all", userSelect: "all" }}>
                {setup.secret}
              </div>
            </div>
          </div>
          <CodeBoxes ref={boxes} label={t("auth.digit")} error={Boolean(error)} shakeKey={shake} disabled={confirming} onChange={() => setError(null)} onComplete={(code) => confirm({ pending: setup.pending, code })} />
          <Err>{error}</Err>
        </>
      )}
    </Modal>
  );
}

function SmsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState("+31 ");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState<{ pending: string; masked: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const boxes = useRef<CodeBoxesHandle>(null);
  const [start, starting] = useAction(smsStart, { refresh: false, onDone: (r) => (r.ok ? setSent({ pending: r.pending as string, masked: r.masked as string }) : setError(r.error)) });
  const [confirm, confirming] = useAction(smsConfirm, {
    onDone: (r) => {
      if (r.ok) onClose();
      else {
        setError(r.error);
        setShake((s) => s + 1);
        boxes.current?.clear();
      }
    },
  });
  return (
    <Modal open onClose={onClose} title={t("settings.security.addPhone")}>
      {!sent ? (
        <form
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start({ phone, password });
          }}
        >
          <div className="banner banner-warn">
            <Icon name="Warning" size={17} />
            {t("settings.security.smsWarning")}
          </div>
          <label className="field">
            {t("settings.security.phone")}
            <input className="input" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} autoFocus />
            <span className="field-label">{t("settings.security.phoneHint")}</span>
          </label>
          <PwField label={t("settings.security.confirmWithPassword")} value={password} onChange={setPassword} />
          <Err>{error}</Err>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
            <button type="submit" className="btn btn-primary" disabled={starting || !password || phone.replace(/\D/g, "").length < 8}>
              {starting ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="PaperPlaneTilt" size={16} />}
              {t("settings.security.sendCode")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t("auth.sms", { phone: sent.masked })}</p>
          <CodeBoxes ref={boxes} label={t("auth.digit")} error={Boolean(error)} shakeKey={shake} disabled={confirming} onChange={() => setError(null)} onComplete={(code) => confirm({ pending: sent.pending, code })} />
          <Err>{error}</Err>
        </>
      )}
    </Modal>
  );
}

function CodesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, pending] = useAction(regenerateCodes, { onDone: (r) => (r.ok ? setCodes(r.codes as string[]) : setError(r.error)) });
  return (
    <Modal open onClose={onClose} title={codes ? t("auth.codesTitle") : t("settings.security.regenerateTitle")} width={500}>
      {codes ? (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t("auth.codesText")}</p>
          <RecoveryCodes codes={codes} />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={onClose}>{t("auth.codesSaved")}</button>
          </div>
        </>
      ) : (
        <form
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            run({ password });
          }}
        >
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{t("settings.security.regenerateText")}</p>
          <PwField label={t("settings.security.confirmWithPassword")} value={password} onChange={setPassword} autoFocus />
          <Err>{error}</Err>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
            <button type="submit" className="btn btn-primary" disabled={pending || !password}>
              {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : <Icon name="ArrowsClockwise" size={16} />}
              {t("settings.security.regenerate")}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
