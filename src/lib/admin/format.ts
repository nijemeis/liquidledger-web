// Display helpers shared by admin server pages and client components.
import type { IconName } from "@/components/icon";
import type { TFunction } from "@/i18n/t";
import type { Formatters } from "@/lib/format";
import type { Tone } from "@/components/ui";

const DAY = 86400_000;

/** Calendar-day difference in Europe/Amsterdam (0 = today, 1 = yesterday). */
function daysAgo(d: Date, now = new Date()): number {
  const key = (x: Date) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
    return Date.parse(p + "T00:00:00Z");
  };
  return Math.round((key(now) - key(d)) / DAY);
}

/** "Today, 09:12" · "Yesterday" · "3 days ago" · "5 Oct 2026" · "—". */
export function relTime(d: Date | string | null | undefined, t: TFunction, fmt: Formatters): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const n = daysAgo(date);
  if (n <= 0) return t("admin.time.today", { time: fmt.time(date) });
  if (n === 1) return t("admin.time.yesterday");
  if (n < 30) return t("admin.time.daysAgo", { n });
  return fmt.dateMed(date);
}

/** Audit log time column: "10:04" today, "Yesterday", else "5 Oct". */
export function auditTime(d: Date | string, t: TFunction, fmt: Formatters): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const n = daysAgo(date);
  if (n <= 0) return fmt.time(date);
  if (n === 1) return t("admin.time.yesterday");
  return fmt.date(date);
}

export function daysLeft(d: Date | string | null | undefined): number {
  if (!d) return 0;
  const date = typeof d === "string" ? new Date(d) : d;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / DAY));
}

/** Icon and colour for an audit action, by its prefix. */
export function actionIcon(action: string): { icon: IconName; color: string } {
  const a = action.toLowerCase();
  if (a.includes("locked") || a.includes("lock")) return { icon: "LockSimple", color: "#b42318" };
  if (a.includes("failed")) return { icon: "WarningCircle", color: "#b42318" };
  if (a.startsWith("auth.sign_in") || a.startsWith("staff.sign_in")) return { icon: "SignIn", color: "#157347" };
  if (a.includes("sign_out")) return { icon: "SignOut", color: "#5b6474" };
  if (a.startsWith("support.")) return { icon: "Headset", color: "#7a1f3d" };
  if (a.startsWith("billing.") || a.startsWith("invoice")) return { icon: "CreditCard", color: "#9a5b00" };
  if (a === "client.plan") return { icon: "ArrowUp", color: "#1f4f8f" };
  if (a.startsWith("client.")) return { icon: "Buildings", color: "#1f4f8f" };
  if (a.includes("invite")) return { icon: "UserPlus", color: "#1f4f8f" };
  if (a.includes("2fa") || a.startsWith("policy.") || a.startsWith("staff.setup")) return { icon: "ShieldCheck", color: "#7a1f3d" };
  if (a.startsWith("rates.")) return { icon: "Sliders", color: "#7a1f3d" };
  if (a.startsWith("user.") || a.startsWith("staff.")) return { icon: "User", color: "#1f4f8f" };
  if (a.includes("excise") || a.includes("vat") || a.includes("file")) return { icon: "SealCheck", color: "#1f4f8f" };
  return { icon: "Info", color: "#5b6474" };
}

export const CLIENT_STATUS_TONE: Record<string, Tone> = { ACTIVE: "green", TRIAL: "blue", PAST_DUE: "amber", SUSPENDED: "red" };
export const USER_STATUS_TONE: Record<string, Tone> = { ACTIVE: "green", INVITED: "blue", LOCKED: "red", DISABLED: "gray" };
export const INVOICE_STATUS_TONE: Record<string, Tone> = { PAID: "green", OPEN: "blue", FAILED: "amber", VOID: "gray" };

export type MfaKind = "passkey" | "app" | "sms" | "none";

export function mfaView(kind: MfaKind, t: TFunction): { label: string; icon: IconName; color: string } {
  if (kind === "none") return { label: t("admin.mfa.none"), icon: "Warning", color: "#9a5b00" };
  if (kind === "passkey") return { label: t("admin.mfa.passkey"), icon: "Fingerprint", color: "#157347" };
  if (kind === "sms") return { label: t("admin.mfa.sms"), icon: "ChatText", color: "#157347" };
  return { label: t("admin.mfa.app"), icon: "DeviceMobile", color: "#157347" };
}

export function initialsOf(name: string): string {
  return name
    .replace(/[^\p{L} ]/gu, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
