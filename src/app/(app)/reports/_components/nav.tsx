"use client";
// Small URL-driven client pieces shared by the excise, VAT, ledger and reports screens.
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Drawer, Modal } from "@/components/client";

/** Build an href from the current path with some search params changed (null removes). */
export function useHref() {
  const pathname = usePathname();
  const sp = useSearchParams();
  return useCallback(
    (changes: Record<string, string | null>) => {
      const q = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) q.delete(k);
        else q.set(k, v);
      }
      const s = q.toString();
      return s ? `${pathname}?${s}` : pathname;
    },
    [pathname, sp],
  );
}

/** A `<select>` that navigates to `?<param>=<value>` (state lives in the URL). */
export function ParamSelect({ param, value, options, label, reset = [], width = 170 }: { param: string; value: string; options: { value: string; label: string }[]; label: string; reset?: string[]; width?: number }) {
  const router = useRouter();
  const href = useHref();
  return (
    <select
      className="select"
      aria-label={label}
      value={value}
      style={{ width, height: 36 }}
      onChange={(e) => router.push(href({ [param]: e.target.value, ...Object.fromEntries(reset.map((r) => [r, null])) }), { scroll: false })}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Drawer whose open state is a URL param; closing removes the given params. */
export function UrlDrawer({ close, title, subtitle, width, footer, children }: { close: string[]; title: React.ReactNode; subtitle?: React.ReactNode; width?: number; footer?: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  const href = useHref();
  const onClose = useCallback(() => router.push(href(Object.fromEntries(close.map((c) => [c, null]))), { scroll: false }), [router, href, close]);
  return (
    <Drawer open onClose={onClose} title={title} subtitle={subtitle} width={width} footer={footer}>
      {children}
    </Drawer>
  );
}

/** Modal whose open state is a URL param. */
export function UrlModal({ close, title, width, footer, children }: { close: string[]; title: React.ReactNode; width?: number; footer?: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  const href = useHref();
  const onClose = useCallback(() => router.push(href(Object.fromEntries(close.map((c) => [c, null]))), { scroll: false }), [router, href, close]);
  return (
    <Modal open onClose={onClose} title={title} width={width} footer={footer}>
      {children}
    </Modal>
  );
}
