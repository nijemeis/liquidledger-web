"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { Icon, type IconName } from "@/components/icon";
import { Logo } from "@/components/logo";
import { adminSearch, type SearchResults } from "./actions";

export type AdminNavItem = { key: string; href: string; icon: IconName; label: string; badge: number };

export function AdminShell({
  nav,
  staff,
  healthy,
  appUrl,
  children,
}: {
  nav: AdminNavItem[];
  staff: { name: string; initials: string; meta: string };
  healthy: boolean;
  appUrl: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const active = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/"));

  async function signOut() {
    await fetch("/api/admin-auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    window.location.href = "/admin/login";
  }

  return (
    <div className="adm-grid">
      <aside className="adm-side">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 6px" }}>
          <Logo size={32} inverted />
          <div className="wordmark adm-hide" style={{ fontSize: 21, color: "#fff" }}>Liquid Ledger</div>
        </div>
        <div className="adm-hide" style={{ margin: "0 8px 16px 50px" }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, background: "#7a1f3d", color: "#fff", whiteSpace: "nowrap" }}>{t("admin.badge")}</span>
        </div>
        {nav.map((it) => {
          const on = active(it.href);
          return (
            <Link
              key={it.key}
              href={it.href}
              title={it.label}
              className="adm-nav"
              aria-current={on ? "page" : undefined}
              style={{ background: on ? "#33212a" : undefined, color: on ? "#fff" : "#d6c6cd", fontWeight: on ? 600 : 400, boxShadow: on ? "inset 3px 0 0 #c45b7e" : "none" }}
            >
              <Icon name={it.icon} size={18} />
              <span className="adm-hide" style={{ flex: 1 }}>{it.label}</span>
              {it.badge ? <span className="n adm-badge">{it.badge}</span> : null}
            </Link>
          );
        })}
        <div style={{ marginTop: "auto", padding: "12px 10px 0", borderTop: "1px solid #33242a", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, flex: "none", borderRadius: "50%", background: "#7a1f3d", color: "#fff", display: "grid", placeItems: "center", fontWeight: 600, fontSize: 12 }}>{staff.initials}</div>
          <div className="adm-hide" style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{staff.name}</div>
            <div style={{ fontSize: 12, color: "#b9a6ae" }}>{staff.meta}</div>
          </div>
          <button onClick={signOut} title={t("common.signOut")} aria-label={t("common.signOut")} className="adm-out">
            <Icon name="SignOut" size={17} />
          </button>
        </div>
      </aside>

      <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", gap: 10, padding: "12px 28px", background: "rgba(245,246,248,0.92)", backdropFilter: "blur(8px)", borderBottom: "1px solid #e4e7ec" }}>
          <AdminSearch />
          <div style={{ flex: "0 1 auto" }} />
          {healthy ? (
            <span className="adm-status" style={{ color: "#157347", background: "#e6f6ee" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#1aa364" }} />
              {t("admin.shell.healthy")}
            </span>
          ) : (
            <span className="adm-status" style={{ color: "#b42318", background: "#fdebea" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#e5484d" }} />
              {t("admin.shell.unhealthy")}
            </span>
          )}
          <a href={appUrl} className="btn" style={{ flex: "none", fontSize: 13.5, padding: "0 12px" }} target="_blank" rel="noopener">
            <Icon name="ArrowSquareOut" size={16} />
            {t("admin.shell.customerApp")}
          </a>
        </div>
        <main style={{ padding: "26px 28px 80px", minWidth: 0 }}>{children}</main>
      </div>
      <style>{`
        .adm-grid{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100vh}
        .adm-side{position:sticky;top:0;height:100vh;overflow-y:auto;background:#1c1216;color:#e9dde2;display:flex;flex-direction:column;padding:14px 12px 16px;gap:2px}
        .adm-nav{position:relative;display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:7px;font-size:14px;text-decoration:none}
        .adm-nav:hover{background:#2c1d23 !important;text-decoration:none;color:#fff !important}
        .adm-badge{font-size:11.5px;font-weight:600;padding:1px 7px;border-radius:999px;background:#e5484d;color:#fff}
        .adm-status{flex:none;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;padding:4px 10px;border-radius:999px;white-space:nowrap}
        .adm-out{flex:none;width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:7px;background:transparent;color:#b9a6ae}
        .adm-out:hover{background:#2c1d23;color:#fff}
        .adm-row:hover{background:#fcf5f7 !important}
        .adm-hover:hover{background:#fafbfc}
        @media (max-width: 860px){
          .adm-grid{grid-template-columns:64px minmax(0,1fr)}
          .adm-side{padding:14px 8px 16px}
          .adm-hide{display:none !important}
          .adm-nav{justify-content:center;padding:9px 0}
          .adm-badge{position:absolute;top:2px;right:4px;padding:0 5px;font-size:10px}
          .adm-status{display:none}
        }
      `}</style>
    </div>
  );
}

function AdminSearch() {
  const { t } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<SearchResults | null>(null);
  const [, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRes(null);
      return;
    }
    const id = ++seq.current;
    const h = setTimeout(() => {
      start(async () => {
        const r = await adminSearch(term);
        if (id === seq.current) setRes(r);
      });
    }, 220);
    return () => clearTimeout(h);
  }, [q]);

  useEffect(() => {
    const h = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const total = res ? res.clients.length + res.users.length + res.staff.length : 0;

  return (
    <div ref={box} style={{ position: "relative", flex: "1 1 160px", minWidth: 0, maxWidth: 480 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) go(`/admin/search?q=${encodeURIComponent(q.trim())}`);
        }}
        style={{ display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 12px", background: "#fff", border: "1px solid #d5d9e0", borderRadius: 9, color: "#8a93a3" }}
      >
        <Icon name="MagnifyingGlass" size={17} />
        <input
          value={q}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder={t("admin.shell.search")}
          aria-label={t("common.search_")}
          style={{ flex: 1, minWidth: 0, border: 0, outline: 0, fontSize: 14, background: "transparent", color: "#14171f" }}
        />
      </form>
      {open && res && q.trim().length >= 2 ? (
        <div className="menu" style={{ left: 0, right: 0, top: 44, width: "100%", maxHeight: 420, overflowY: "auto" }}>
          {total === 0 ? <div style={{ padding: "10px 10px", color: "#5b6474", fontSize: 13.5 }}>{t("common.emptySearch")}</div> : null}
          {res.clients.length ? <div className="menu-label">{t("admin.search.clients")}</div> : null}
          {res.clients.map((c) => (
            <button key={c.id} className="menu-item brand" onClick={() => go(`/admin/clients?id=${c.id}`)}>
              <Icon name="Buildings" size={16} color="#7a1f3d" />
              <span style={{ flex: 1, minWidth: 0 }} className="truncate">
                {c.name} <span style={{ color: "#5b6474", fontSize: 12.5 }}>{c.vat ?? ""}</span>
              </span>
              <span style={{ fontSize: 12, color: "#8a93a3" }}>{c.flag}</span>
            </button>
          ))}
          {res.users.length ? <div className="menu-label">{t("admin.search.users")}</div> : null}
          {res.users.map((u) => (
            <button key={u.id} className="menu-item brand" onClick={() => go(`/admin/users?q=${encodeURIComponent(u.email)}`)}>
              <Icon name="User" size={16} color="#7a1f3d" />
              <span style={{ flex: 1, minWidth: 0 }} className="truncate">
                {u.name} <span style={{ color: "#5b6474", fontSize: 12.5 }}>{u.email}</span>
              </span>
              <span className="truncate" style={{ fontSize: 12, color: "#8a93a3", maxWidth: 140 }}>{u.client ?? ""}</span>
            </button>
          ))}
          {res.staff.length ? <div className="menu-label">{t("admin.search.staff")}</div> : null}
          {res.staff.map((s) => (
            <button key={s.id} className="menu-item brand" onClick={() => go(`/admin/users?tab=staff`)}>
              <Icon name="ShieldCheck" size={16} color="#7a1f3d" />
              <span style={{ flex: 1, minWidth: 0 }} className="truncate">
                {s.name} <span style={{ color: "#5b6474", fontSize: 12.5 }}>{s.email}</span>
              </span>
            </button>
          ))}
          {total > 0 ? (
            <button className="menu-item" onClick={() => go(`/admin/search?q=${encodeURIComponent(q.trim())}`)} style={{ color: "#7a1f3d", fontSize: 13 }}>
              {t("admin.search.all")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
