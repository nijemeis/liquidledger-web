"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { Icon, type IconName } from "@/components/icon";
import { Logo } from "@/components/logo";
import { Dropdown } from "@/components/client";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";
import { endSupportView, setUserLocale, signOut, switchAdministration } from "./shell-actions";

export type NavItem = { key: string; label: string; href: string; icon: IconName; badge: number };
export type NavGroup = { label: string | null; items: NavItem[] };

const NEW_MENU: { key: string; icon: IconName; href: string; letter: string }[] = [
  { key: "sales", icon: "FileText", href: "/sales?new=1", letter: "I" },
  { key: "upload", icon: "UploadSimple", href: "/purchases?upload=1", letter: "U" },
  { key: "receipt", icon: "Wallet", href: "/costs?new=1", letter: "E" },
  { key: "journal", icon: "Books", href: "/ledger?new=1", letter: "J" },
  { key: "product", icon: "Wine", href: "/products?new=1", letter: "P" },
  { key: "relation", icon: "AddressBook", href: "/relations?new=1", letter: "R" },
  { key: "order", icon: "Boat", href: "/shipments?new=1", letter: "O" },
];

export function Shell({
  groups,
  company,
  fy,
  memberships,
  currentAdministrationId,
  user,
  locale,
  initialSidebar,
  readOnly,
  isSupportView,
  banner,
  children,
}: {
  groups: NavGroup[];
  company: string;
  fy: string;
  memberships: { administrationId: string; legalName: string; role: string }[];
  currentAdministrationId: string;
  user: { name: string; initials: string; email: string };
  locale: string;
  initialSidebar: "open" | "closed" | null;
  readOnly: boolean;
  isSupportView: boolean;
  banner: { tone: string; text: string; action?: "endSupport" } | null;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const [side, setSide] = useState<"open" | "closed">(initialSidebar ?? "open");
  const manual = useRef(initialSidebar !== null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [newOpen, setNewOpen] = useState(false);

  // Auto-collapse below 1100px unless the user chose explicitly.
  useEffect(() => {
    const auto = () => {
      if (!manual.current) setSide(window.innerWidth < 1100 ? "closed" : "open");
    };
    auto();
    window.addEventListener("resize", auto);
    return () => window.removeEventListener("resize", auto);
  }, []);

  // ⌘K / Ctrl+K focuses search; letters open "New" items while the menu is open.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (newOpen && !e.metaKey && !e.ctrlKey) {
        const item = NEW_MENU.find((m) => m.letter === e.key.toUpperCase());
        if (item) {
          setNewOpen(false);
          router.push(item.href);
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [newOpen, router]);

  const toggleSide = () => {
    const next = side === "closed" ? "open" : "closed";
    manual.current = true;
    setSide(next);
    document.cookie = `ll_sidebar=${next}; path=/; max-age=31536000; samesite=lax`;
  };

  const open = side === "open";
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const navButton = (it: { href: string; label: string; icon: IconName; badge?: number }, isActive: boolean) => (
    <Link
      key={it.href}
      href={it.href}
      title={it.label}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: open ? "flex-start" : "center",
        gap: 10,
        width: "100%",
        padding: open ? "7px 10px" : "9px 0",
        borderRadius: 7,
        background: isActive ? "#f9eef2" : "transparent",
        color: isActive ? "#7a1f3d" : "#3a4250",
        boxShadow: isActive ? "inset 3px 0 0 #7a1f3d" : "none",
        fontSize: 14,
        fontWeight: isActive ? 600 : 400,
        textDecoration: "none",
      }}
      className="nav-item"
    >
      <Icon name={it.icon} size={open ? 18 : 20} />
      {open ? <span className="truncate" style={{ flex: 1 }}>{it.label}</span> : null}
      {it.badge ? (
        open ? (
          <span className="badge">{it.badge}</span>
        ) : (
          <span className="n" style={{ position: "absolute", top: 3, right: 5, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 999, background: "#7a1f3d", color: "#fff", fontSize: 10, fontWeight: 700, lineHeight: "16px", textAlign: "center", boxShadow: "0 0 0 2px #fff" }}>
            {it.badge}
          </span>
        )
      ) : null}
    </Link>
  );

  const switcher = (
    <Dropdown
      width={260}
      align="left"
      trigger={(_, toggle) =>
        open ? (
          <button onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px", marginBottom: 12, border: "1px solid #f1d5df", borderRadius: 9, background: "#fcf5f7", textAlign: "left" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="truncate" style={{ fontWeight: 600, fontSize: 13 }}>{company}</div>
              <div style={{ fontSize: 12, color: "#5b6474" }}>{fy}</div>
            </div>
            <Icon name="CaretUpDown" size={16} color="#5b6474" />
          </button>
        ) : (
          <button onClick={toggle} title={`${company} · ${fy}`} style={{ display: "grid", placeItems: "center", width: 40, height: 40, margin: "0 auto 12px", border: "1px solid #f1d5df", borderRadius: 9, background: "#fcf5f7", fontSize: 12.5, fontWeight: 700, color: "#7a1f3d" }}>
            {company.replace(/[^\p{L} ]/gu, "").split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </button>
        )
      }
    >
      {(close) => (
        <>
          <div className="menu-label">{t("common.switchAdministration")}</div>
          {memberships.map((m) => (
            <button
              key={m.administrationId}
              className="menu-item brand"
              aria-checked={m.administrationId === currentAdministrationId}
              onClick={() => {
                close();
                if (m.administrationId !== currentAdministrationId) start(async () => {
                  await switchAdministration(m.administrationId);
                  router.push("/dashboard");
                  router.refresh();
                });
              }}
            >
              <Icon name="Buildings" size={16} color="#7a1f3d" />
              <span className="truncate" style={{ flex: 1 }}>{m.legalName}</span>
              {m.administrationId === currentAdministrationId ? <Icon name="Check" color="#7a1f3d" /> : null}
            </button>
          ))}
        </>
      )}
    </Dropdown>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: `${open ? 236 : 68}px minmax(0,1fr)`, minHeight: "100vh", transition: "grid-template-columns 0.18s ease" }}>
      <aside style={{ position: "sticky", top: 0, height: "100vh", overflowY: "auto", overflowX: "hidden", background: "#fff", borderRight: "1px solid #e4e7ec", display: "flex", flexDirection: "column", padding: `14px ${open ? 12 : 10}px 16px`, gap: 2 }} className="no-print">
        <div style={{ display: "flex", alignItems: "center", justifyContent: open ? "flex-start" : "center", gap: 10, padding: `4px ${open ? 8 : 0}px 16px` }}>
          <Link href="/dashboard" aria-label="Liquid Ledger" style={{ display: "flex", alignItems: "center", gap: 10, flex: open ? 1 : "none", minWidth: 0, textDecoration: "none" }}>
            <Logo size={34} />
            {open ? <div className="wordmark" style={{ fontSize: 22, color: "#7a1f3d" }}>Liquid Ledger</div> : null}
          </Link>
          {open ? (
            <button onClick={toggleSide} title={t("common.collapse")} aria-label={t("common.collapse")} className="btn btn-icon" style={{ width: 30, height: 30, color: "#5b6474" }}>
              <Icon name="SidebarSimple" size={18} />
            </button>
          ) : null}
        </div>
        {!open ? (
          <button onClick={toggleSide} title={t("common.expand")} aria-label={t("common.expand")} className="btn btn-icon" style={{ width: "100%", height: 34, marginBottom: 6, color: "#5b6474" }}>
            <Icon name="SidebarSimple" size={18} style={{ transform: "scaleX(-1)" }} />
          </button>
        ) : null}
        {switcher}
        {groups.map((g, gi) => (
          <div key={gi} style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 10 }}>
            {g.label && open ? <div style={{ fontSize: 11.5, fontWeight: 500, color: "#8a93a3", padding: "6px 10px 4px", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>{g.label}</div> : null}
            {g.label && !open ? <div style={{ height: 1, background: "#eef0f3", margin: "4px 8px 6px" }} /> : null}
            {g.items.map((it) => navButton(it, active(it.href)))}
          </div>
        ))}
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {navButton({ href: "/settings", label: t("common.nav.settings"), icon: "GearSix" }, active("/settings"))}
          {navButton({ href: "/help", label: t("common.nav.help"), icon: "Lifebuoy" }, active("/help"))}
        </div>
      </aside>

      <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", gap: 10, padding: "12px 24px", background: "rgba(245,246,248,0.92)", backdropFilter: "blur(8px)", borderBottom: "1px solid #e4e7ec" }}>
          <form
            action="/search"
            className="search"
            style={{ flex: "1 1 160px", minWidth: 0, maxWidth: 520 }}
            onSubmit={(e) => {
              e.preventDefault();
              const q = searchRef.current?.value.trim();
              if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
            }}
          >
            <Icon name="MagnifyingGlass" size={17} />
            <input ref={searchRef} name="q" placeholder={t("common.search")} aria-label={t("common.search_")} />
            <span style={{ flex: "none", fontSize: 12, padding: "1px 6px", border: "1px solid #e4e7ec", borderRadius: 5 }}>⌘K</span>
          </form>
          <div style={{ flex: "0 1 auto" }} />
          <Dropdown
            trigger={(_, toggle) => (
              <button onClick={toggle} aria-label={t("common.language")} className="btn" style={{ padding: "0 10px", fontSize: 13.5, fontWeight: 600 }}>
                <Icon name="GlobeSimple" size={17} color="#7a1f3d" />
                {locale.toUpperCase()}
                <Icon name="CaretDown" size={12} color="#5b6474" />
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="menu-label">{t("common.language")}</div>
                {LOCALES.map((l) => (
                  <button
                    key={l}
                    className="menu-item brand"
                    aria-checked={l === locale}
                    onClick={() => {
                      close();
                      start(async () => {
                        await setUserLocale(l);
                        router.refresh();
                      });
                    }}
                  >
                    <span className="n" style={{ width: 26, fontSize: 12, fontWeight: 600, color: "#7a1f3d" }}>{l.toUpperCase()}</span>
                    <span style={{ flex: 1 }}>{LOCALE_NAMES[l]}</span>
                    {l === locale ? <Icon name="Check" color="#7a1f3d" /> : null}
                  </button>
                ))}
              </>
            )}
          </Dropdown>
          {!readOnly ? (
            <Link href="/purchases?upload=1" className="btn">
              <Icon name="UploadSimple" size={16} />
              {t("common.upload")}
            </Link>
          ) : null}
          {!readOnly ? (
            <Dropdown
              width={240}
              onOpenChange={setNewOpen}
              trigger={(_, toggle) => (
                <button onClick={toggle} className="btn btn-primary">
                  <Icon name="Plus" size={16} />
                  {t("common.new")}
                  <Icon name="CaretDown" size={13} />
                </button>
              )}
            >
              {(close) =>
                NEW_MENU.map((m) => (
                  <Link key={m.key} href={m.href} className="menu-item" onClick={close}>
                    <Icon name={m.icon} size={17} color="#5b6474" />
                    <span style={{ flex: 1 }}>{t(`common.newMenu.${m.key}`)}</span>
                    <span style={{ fontSize: 12, color: "#8a93a3" }}>{m.letter}</span>
                  </Link>
                ))
              }
            </Dropdown>
          ) : null}
          <Link href="/dashboard#todo" aria-label={t("common.notifications")} className="btn btn-icon">
            <Icon name="Bell" size={19} />
          </Link>
          <Dropdown
            width={240}
            trigger={(_, toggle) => (
              <button onClick={toggle} className="avatar" style={{ border: 0 }} aria-label={user.name}>
                {user.initials}
              </button>
            )}
          >
            {(close) => (
              <>
                <div style={{ padding: "8px 10px 6px" }}>
                  <div style={{ fontWeight: 600 }}>{user.name}</div>
                  <div className="truncate" style={{ fontSize: 12.5, color: "#5b6474" }}>{user.email}</div>
                </div>
                <div className="divider" style={{ margin: "4px 0" }} />
                {!isSupportView ? (
                  <>
                    <Link href="/settings" className="menu-item" onClick={close}>
                      <Icon name="User" size={16} color="#5b6474" />
                      {t("common.profile")}
                    </Link>
                    <Link href="/settings/security" className="menu-item" onClick={close}>
                      <Icon name="ShieldCheck" size={16} color="#5b6474" />
                      {t("common.security")}
                    </Link>
                  </>
                ) : null}
                <button
                  className="menu-item"
                  onClick={() =>
                    start(async () => {
                      if (isSupportView) await endSupportView();
                      else await signOut();
                      window.location.href = isSupportView ? "/admin" : "/login";
                    })
                  }
                >
                  <Icon name="SignOut" size={16} color="#5b6474" />
                  {isSupportView ? t("common.endSupport") : t("common.signOut")}
                </button>
              </>
            )}
          </Dropdown>
        </div>
        {banner ? (
          <div className={`banner banner-${banner.tone} no-print`} style={{ borderRadius: 0, padding: "9px 24px", alignItems: "center" }}>
            <Icon name={banner.tone === "brand" ? "Headset" : banner.tone === "warn" ? "Warning" : "Info"} size={17} />
            <span style={{ flex: 1 }}>{banner.text}</span>
            {banner.action === "endSupport" ? (
              <button className="btn btn-sm" onClick={() => start(async () => { await endSupportView(); window.location.href = "/admin"; })}>
                {t("common.endSupport")}
              </button>
            ) : null}
          </div>
        ) : null}
        <main className="page">{children}</main>
      </div>
      <style>{`.nav-item:hover{background:#f3f5f8 !important;text-decoration:none}`}</style>
    </div>
  );
}
