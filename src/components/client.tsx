"use client";
// Interactive primitives: drawer, modal, toast, dropdown and an action hook.
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "./icon";

// ── Toast ────────────────────────────────────────────────────────────────────

type ToastKind = "ok" | "info" | "error";
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((msg: string, kind: ToastKind = "ok") => {
    clearTimeout(timer.current);
    setToast({ msg, kind, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), kind === "error" ? 6000 : 4000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast ? (
        <div className="toast" role="status" aria-live="polite" key={toast.id}>
          <Icon
            name={toast.kind === "error" ? "WarningCircle" : toast.kind === "info" ? "Info" : "CheckCircle"}
            size={20}
            color={toast.kind === "error" ? "#ff8a8a" : toast.kind === "info" ? "#f1d5df" : "#5fd39a"}
          />
          {toast.msg}
        </div>
      ) : null}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ── Server action hook ───────────────────────────────────────────────────────

export type ActionResult = { ok: true; message?: string; [k: string]: unknown } | { ok: false; error: string };

/**
 * Call a Server Action, show its message as a toast and refresh server data.
 * Returns [run, pending].
 */
export function useAction<A extends unknown[], R extends ActionResult>(action: (...args: A) => Promise<R>, opts: { onDone?: (r: R) => void; refresh?: boolean } = {}) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = useCallback(
    (...args: A) =>
      new Promise<R>((resolve) => {
        start(async () => {
          let r: R;
          try {
            r = await action(...args);
          } catch {
            r = { ok: false, error: "Something went wrong. Please try again." } as R;
          }
          if (r.ok) {
            if (r.message) toast(r.message);
            if (opts.refresh !== false) router.refresh();
          } else toast(r.error, "error");
          opts.onDone?.(r);
          resolve(r);
        });
      }),
    [action, opts, router, toast],
  );
  return [run, pending] as const;
}

// ── Drawer & modal ───────────────────────────────────────────────────────────

function useEsc(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = 660,
  footer,
  children,
  header,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEsc(onClose);
  if (!open) return null;
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" style={{ ["--drawer-w" as string]: `${width}px` }}>
        <div className="drawer-head">
          {header ?? (
            <div style={{ minWidth: 0 }}>
              <div className="drawer-title">{title}</div>
              {subtitle ? <div className="drawer-sub n">{subtitle}</div> : null}
            </div>
          )}
          <button className="btn btn-icon" onClick={onClose} aria-label="Close" style={{ width: 34, height: 34 }}>
            <Icon name="X" size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </div>
    </>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  useEsc(onClose);
  if (!open) return null;
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" style={{ ["--modal-w" as string]: `${width}px` }}>
        <div className="drawer-head" style={{ padding: "14px 20px" }}>
          <div className="drawer-title" style={{ fontSize: 16 }}>{title}</div>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close" style={{ width: 32, height: 32 }}>
            <Icon name="X" size={17} />
          </button>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
        {footer ? <div className="drawer-foot" style={{ padding: "12px 20px" }}>{footer}</div> : null}
      </div>
    </>
  );
}

// ── Dropdown ─────────────────────────────────────────────────────────────────

export function Dropdown({ trigger, children, width = 220, align = "right", onOpenChange }: { trigger: (open: boolean, toggle: () => void) => React.ReactNode; children: (close: () => void) => React.ReactNode; width?: number; align?: "left" | "right"; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    window.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      window.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative", flex: "none" }}>
      {trigger(open, () => setOpen((o) => !o))}
      {open ? (
        <div className="menu" style={{ width, ...(align === "left" ? { left: 0, right: "auto" } : {}) }}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" disabled={disabled} onClick={() => onChange?.(!on)} />
  );
}

export function SubmitButton({ pending, children, icon, className = "btn btn-primary", disabled }: { pending?: boolean; children: React.ReactNode; icon?: IconName; className?: string; disabled?: boolean }) {
  return (
    <button type="submit" className={className} disabled={pending || disabled}>
      {pending ? <Icon name="CircleNotch" size={16} className="spin" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}
