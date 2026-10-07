// Server-safe UI primitives styled to the design tokens (globals.css).
// Interactive pieces (drawer, modal, toast, menus) live in ./client.tsx.
import Link from "next/link";
import { Icon, type IconName } from "./icon";

export type Tone = "green" | "blue" | "amber" | "red" | "gray" | "wine";

export const TONE: Record<Tone, { bg: string; fg: string }> = {
  green: { bg: "#e6f6ee", fg: "#157347" },
  blue: { bg: "#e8f0fb", fg: "#1f4f8f" },
  amber: { bg: "#fff3dc", fg: "#9a5b00" },
  red: { bg: "#fdebea", fg: "#b42318" },
  gray: { bg: "#f0f2f5", fg: "#4b5563" },
  wine: { bg: "#f8e9ee", fg: "#7a1f3d" },
};

export function PageHead({ eyebrow, title, actions }: { eyebrow?: React.ReactNode; title: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Pill({ tone = "gray", children, icon }: { tone?: Tone; children: React.ReactNode; icon?: IconName }) {
  return (
    <span className={`pill pill-${tone}`}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  );
}

export function Stat({ label, value, note, valueColor, noteColor }: { label: React.ReactNode; value: React.ReactNode; note?: React.ReactNode; valueColor?: string; noteColor?: string }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      {note ? (
        <div className="stat-note" style={noteColor ? { color: noteColor } : undefined}>
          {note}
        </div>
      ) : null}
    </div>
  );
}

export function Kpi({ href, icon, label, value, note, noteColor }: { href: string; icon: IconName; label: React.ReactNode; value: React.ReactNode; note?: React.ReactNode; noteColor?: string }) {
  return (
    <Link href={href} className="kpi">
      <div className="kpi-label">
        <Icon name={icon} size={17} />
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-note" style={{ color: noteColor ?? "var(--ink-500)" }}>
        {note}
      </div>
    </Link>
  );
}

/** Link-based tabs for server-rendered screens (state lives in the URL). */
export function TabLinks({ tabs, active }: { tabs: { key: string; label: React.ReactNode; count?: number; href: string }[]; active: string }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className="tab" role="tab" aria-selected={t.key === active} scroll={false}>
          {t.label}
          {t.count !== undefined ? <span className="tab-count">{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}

export function Empty({ icon = "Confetti", title, children, color = "#157347" }: { icon?: IconName; title: React.ReactNode; children?: React.ReactNode; color?: string }) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} color={color} />
      <div className="empty-title">{title}</div>
      {children}
    </div>
  );
}

export function Tile({ icon, tone = "wine", size = 32 }: { icon: IconName; tone?: Tone | { bg: string; fg: string }; size?: number }) {
  const c = typeof tone === "string" ? TONE[tone] : tone;
  return (
    <div className="tile" style={{ background: c.bg, color: c.fg, width: size, height: size }}>
      <Icon name={icon} size={Math.round(size * 0.53)} />
    </div>
  );
}

export function Banner({ tone = "info", icon, children, style }: { tone?: "info" | "error" | "warn" | "brand" | "ok"; icon?: IconName; children: React.ReactNode; style?: React.CSSProperties }) {
  const defaultIcon: Record<string, IconName> = { info: "Info", error: "WarningCircle", warn: "Warning", brand: "Info", ok: "CheckCircle" };
  return (
    <div className={`banner banner-${tone}`} style={style}>
      <Icon name={icon ?? defaultIcon[tone]!} size={17} style={{ marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

/** Product category tile colours (README "Product category tiles"). */
export const CATEGORY_STYLE: Record<string, { bg: string; fg: string; icon: IconName }> = {
  WINE: { bg: "#f8e9ee", fg: "#7a1f3d", icon: "Wine" },
  FORTIFIED: { bg: "#f8e9ee", fg: "#7a1f3d", icon: "Wine" },
  BEER: { bg: "#fff3dc", fg: "#9a5b00", icon: "BeerStein" },
  SPIRITS: { bg: "#f3ece4", fg: "#6b4a2b", icon: "Brandy" },
  WATER: { bg: "#e8f0fb", fg: "#1f4f8f", icon: "Drop" },
  SOFT: { bg: "#e6f6ee", fg: "#157347", icon: "PintGlass" },
};

export function CategoryTile({ category, size = 32 }: { category: string; size?: number }) {
  const s = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.WINE!;
  return <Tile icon={s.icon} tone={{ bg: s.bg, fg: s.fg }} size={size} />;
}

/** Grid row helper: `cols` is a grid-template-columns value shared by header and rows. */
export function TableHead({ cols, children, minWidth }: { cols: string; children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="tbl-head" style={{ gridTemplateColumns: cols, minWidth }}>
      {children}
    </div>
  );
}

export function Progress4({ stage, blocked, done }: { stage: number; blocked?: boolean; done?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 3, width: "100%" }}>
      {[0, 1, 2, 3].map((i) => {
        const c =
          i < stage || (i === stage && !blocked) ? (done || stage === 3 ? "#1aa364" : "#7a1f3d") : i === stage && blocked ? "#e5484d" : "#e4e7ec";
        return <span key={i} style={{ height: 6, borderRadius: 3, background: c }} />;
      })}
    </div>
  );
}
