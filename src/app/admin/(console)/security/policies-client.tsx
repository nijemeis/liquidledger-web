"use client";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { Toggle, useAction, useToast } from "@/components/client";
import { Icon } from "@/components/icon";
import { saveIpAllowList, setPolicy } from "./actions";

export function PolicyToggles({ items }: { items: { key: string; title: string; desc: string; on: boolean; locked: boolean }[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const [run, pending] = useAction(setPolicy);
  return (
    <>
      {items.map((p) => (
        <div key={p.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 16, alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #eef0f3" }}>
          <div>
            <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              {p.title}
              {p.locked ? <Icon name="LockSimple" size={14} color="#8a93a3" /> : null}
            </div>
            <div style={{ fontSize: 13, color: "#5b6474" }}>{p.desc}</div>
          </div>
          <span style={{ display: "inline-flex", opacity: p.locked ? 0.75 : 1, cursor: p.locked ? "not-allowed" : "pointer" }}>
            <Toggle on={p.on} label={p.title} disabled={pending} onChange={(v) => (p.locked ? toast(t("admin.security.required"), "info") : run(p.key, v))} />
          </span>
        </div>
      ))}
    </>
  );
}

export function IpAllowList({ initial, myIp, enforced }: { initial: string; myIp: string | null; enforced: boolean }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const [run, pending] = useAction(saveIpAllowList);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div className="card-title">{t("admin.security.listTitle")}</div>
        <div style={{ fontSize: 13, color: "#5b6474", marginTop: 2 }}>{t(enforced ? "admin.security.listOn" : "admin.security.listOff")}</div>
      </div>
      <textarea
        className="textarea n"
        rows={5}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={"185.12.4.0/24\n84.26.190.3"}
        aria-label={t("admin.security.listTitle")}
        style={{ fontSize: 13.5 }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "#5b6474", display: "inline-flex", gap: 6, alignItems: "center" }}>
          <Icon name="GlobeSimple" size={15} />
          {t("admin.security.yourIp", { ip: myIp ?? "?" })}
          {myIp ? (
            <button type="button" className="btn btn-sm btn-ghost" style={{ height: 26, color: "#7a1f3d" }} onClick={() => setValue((v) => (v.split(/\s+/).includes(myIp) ? v : `${v.trim()}\n${myIp}`.trim()))}>
              {t("admin.security.addMine")}
            </button>
          ) : null}
        </span>
        <button className="btn btn-primary" disabled={pending || value === initial} onClick={() => run(value)}>
          {t("admin.security.saveList")}
        </button>
      </div>
    </div>
  );
}
