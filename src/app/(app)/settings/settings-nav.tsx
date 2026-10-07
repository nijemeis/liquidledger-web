"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icon";

export type SettingsNavItem = { href: string; label: string; icon: IconName; group: string };

export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const pathname = usePathname();
  let lastGroup = "";
  return (
    <nav className="settings-nav" aria-label="Settings">
      {items.map((it) => {
        const active = it.href === "/settings" ? pathname === "/settings" : pathname.startsWith(it.href);
        const head = it.group !== lastGroup ? it.group : null;
        lastGroup = it.group;
        return (
          <div key={it.href} style={{ display: "contents" }}>
            {head ? (
              <div className="settings-group" style={{ fontSize: 11.5, fontWeight: 500, color: "#8a93a3", padding: "10px 10px 4px", letterSpacing: "0.02em" }}>
                {head}
              </div>
            ) : null}
            <Link
              href={it.href}
              className="nav-item"
              aria-current={active ? "page" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 10px",
                borderRadius: 7,
                fontSize: 14,
                textDecoration: "none",
                background: active ? "#f9eef2" : "transparent",
                color: active ? "#7a1f3d" : "#3a4250",
                fontWeight: active ? 600 : 400,
                boxShadow: active ? "inset 3px 0 0 #7a1f3d" : "none",
                whiteSpace: "nowrap",
              }}
            >
              <Icon name={it.icon} size={18} />
              {it.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
