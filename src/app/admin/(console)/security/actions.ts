"use server";
import { AdminError, auditStaff, staffAction } from "@/lib/admin/staff";
import { getPolicies, ipAllowed, setPolicies, type SecurityPolicies } from "@/lib/policies";

const TOGGLES = ["trust30", "newDevice", "ipAllow", "sso"] as const;
type ToggleKey = (typeof TOGGLES)[number];
const POLICY_EN: Record<ToggleKey, string> = { trust30: "trust this device for 30 days", newDevice: "new-device sign-in emails", ipAllow: "IP allow-list for platform staff", sso: "SSO (SAML) on Enterprise" };

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

/** Validate one allow-list entry: IPv4, IPv4 CIDR (/0–32) or an exact IPv6 address. */
function validEntry(e: string): boolean {
  if (e.includes("/")) {
    const [base, bits] = e.split("/");
    return IPV4.test(base ?? "") && /^\d{1,2}$/.test(bits ?? "") && Number(bits) <= 32;
  }
  return IPV4.test(e) || (e.includes(":") && IPV6.test(e) && e.length <= 45);
}

export async function setPolicy(key: string, on: boolean) {
  return staffAction("policies.write", async (ctx) => {
    if (key === "enforce2fa" || key === "staffPasskey") throw new AdminError(ctx.t("admin.security.required"));
    if (!(TOGGLES as readonly string[]).includes(key)) throw new AdminError(ctx.t("admin.err.input"));
    const before = await getPolicies();
    const k = key as ToggleKey;
    if (k === "ipAllow" && on) {
      if (!before.ipAllowList.length) throw new AdminError(ctx.t("admin.security.listEmpty"));
      // Never lock out the person flipping the switch.
      if (!ipAllowed(ctx.ip, before.ipAllowList)) throw new AdminError(ctx.t("admin.security.selfLockout", { ip: ctx.ip ?? "?" }));
    }
    const patch: Partial<SecurityPolicies> = { [k]: Boolean(on) };
    await setPolicies(patch, ctx.staff.email);
    await auditStaff(ctx, {
      action: "policy.update",
      summary: `${on ? "Turned on" : "Turned off"} security policy “${POLICY_EN[k]}”`,
      targetType: "policy",
      targetId: k,
      before: { [k]: before[k] },
      after: { [k]: Boolean(on) },
    });
    return { message: ctx.t(on ? "admin.security.on" : "admin.security.off", { policy: ctx.t(`admin.security.p.${k}.title`) }) };
  });
}

export async function saveIpAllowList(raw: string) {
  return staffAction("policies.write", async (ctx) => {
    const entries = [...new Set(String(raw ?? "").split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
    if (entries.length > 100) throw new AdminError(ctx.t("admin.security.tooMany"));
    const bad = entries.filter((e) => !validEntry(e));
    if (bad.length) throw new AdminError(ctx.t("admin.security.badEntries", { entries: bad.slice(0, 3).join(", ") }));
    const before = await getPolicies();
    if (before.ipAllow) {
      if (!entries.length) throw new AdminError(ctx.t("admin.security.listEmpty"));
      if (!ipAllowed(ctx.ip, entries)) throw new AdminError(ctx.t("admin.security.selfLockout", { ip: ctx.ip ?? "?" }));
    }
    await setPolicies({ ipAllowList: entries }, ctx.staff.email);
    await auditStaff(ctx, {
      action: "policy.ip_allow_list",
      summary: `Updated the admin IP allow-list · ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`,
      targetType: "policy",
      targetId: "ipAllowList",
      before: { ipAllowList: before.ipAllowList },
      after: { ipAllowList: entries },
    });
    return { message: ctx.t("admin.security.listSaved", { n: entries.length }) };
  });
}
