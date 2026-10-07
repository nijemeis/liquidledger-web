"use client";
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

export interface CodeBoxesHandle {
  clear: () => void;
  focus: () => void;
}

/**
 * Six one-digit boxes (3 + 3 with a dash). Typing moves forward, Backspace
 * goes back, arrows move, pasting fills all boxes; `onComplete` fires when
 * all six are filled.
 */
export const CodeBoxes = forwardRef<CodeBoxesHandle, { onComplete: (code: string) => void; onChange?: (code: string) => void; error?: boolean; shakeKey?: number; label: string; disabled?: boolean }>(
  function CodeBoxes({ onComplete, onChange, error, shakeKey = 0, label, disabled }, ref) {
    const [code, setCodeState] = useState<string[]>(["", "", "", "", "", ""]);
    // Mirror in a ref so fast typing never works on a stale render.
    const codeRef = useRef(code);
    const setCode = (next: string[]) => {
      codeRef.current = next;
      setCodeState(next);
    };
    const boxes = useRef<(HTMLInputElement | null)[]>([]);
    const focusBox = (i: number) => {
      const el = boxes.current[i];
      if (el) {
        el.focus();
        el.select();
      }
    };

    useImperativeHandle(ref, () => ({
      clear: () => {
        setCode(["", "", "", "", "", ""]);
        focusBox(0);
      },
      focus: () => focusBox(0),
    }));

    useEffect(() => {
      focusBox(0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-focus the first box once verification finishes and the boxes were cleared.
    useEffect(() => {
      if (!disabled && codeRef.current.every((c) => !c)) focusBox(0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [disabled]);

    const setDigits = (start: number, str: string) => {
      const d = str.replace(/\D/g, "").slice(0, 6 - start).split("");
      if (!d.length) return;
      const next = [...codeRef.current];
      d.forEach((c, j) => (next[start + j] = c));
      setCode(next);
      onChange?.(next.join(""));
      if (next.every(Boolean)) onComplete(next.join(""));
      else focusBox(Math.min(start + d.length, 5));
    };

    const items: React.ReactNode[] = [];
    code.forEach((v, i) => {
      if (i === 3) items.push(<span key="sep" style={{ height: 2, background: "#c4cbd6", borderRadius: 2 }} />);
      items.push(
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          className="n"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`${label} ${i + 1}`}
          value={v}
          disabled={disabled}
          onChange={(e) => {
            const val = e.target.value.replace(/\D/g, "");
            if (!val) {
              const next = [...codeRef.current];
              next[i] = "";
              setCode(next);
              onChange?.(next.join(""));
              return;
            }
            // A box holds one digit; when a second arrives, keep the new one (it may be a paste of several).
            const prev = codeRef.current[i] ?? "";
            const incoming = val.length > 1 && prev && val.startsWith(prev) ? val.slice(prev.length) : val;
            setDigits(i, incoming);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !codeRef.current[i] && i > 0) {
              e.preventDefault();
              const next = [...codeRef.current];
              next[i - 1] = "";
              setCode(next);
              focusBox(i - 1);
            } else if (e.key === "ArrowLeft" && i > 0) focusBox(i - 1);
            else if (e.key === "ArrowRight" && i < 5) focusBox(i + 1);
          }}
          onPaste={(e) => {
            e.preventDefault();
            setDigits(i, e.clipboardData.getData("text"));
          }}
          onFocus={(e) => e.target.select()}
          style={{
            width: "100%",
            height: 56,
            textAlign: "center",
            border: `1px solid ${error ? "#e5484d" : v ? "#c98ea2" : "#d5d9e0"}`,
            borderRadius: 10,
            fontSize: 24,
            fontWeight: 600,
            color: "#14171f",
            background: v ? "#fcf5f7" : "#fff",
            outline: "none",
          }}
          onFocusCapture={(e) => {
            e.currentTarget.style.boxShadow = "0 0 0 3px #f1d5df";
            e.currentTarget.style.borderColor = "#7a1f3d";
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.borderColor = error ? "#e5484d" : v ? "#c98ea2" : "#d5d9e0";
          }}
        />,
      );
    });

    return (
      <div
        key={shakeKey}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr) 14px repeat(3,1fr)",
          gap: 8,
          alignItems: "center",
          animation: error ? "ll-shake 0.4s both" : "none",
        }}
      >
        {items}
      </div>
    );
  },
);
