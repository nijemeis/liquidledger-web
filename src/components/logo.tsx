import { useId } from "react";

/** The end-on barrel mark (48×48 geometry from the handoff). */
export function Logo({ size = 34, inverted = false }: { size?: number; inverted?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const fg = inverted ? "#7a1f3d" : "#fff";
  const bg = inverted ? "#fff" : "#7a1f3d";
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} style={{ flex: "none", display: "block" }} aria-hidden="true">
      <defs>
        <clipPath id={`ll-${id}`}>
          <circle cx="24" cy="24" r="12" />
        </clipPath>
      </defs>
      <circle cx="24" cy="24" r="22" fill={bg} />
      <circle cx="24" cy="24" r="14" fill="none" stroke={fg} strokeWidth="2" />
      <g clipPath={`url(#ll-${id})`} stroke={fg} strokeWidth="1.2" opacity="0.45">
        <path d="M16 10V38M20 10V38M24 10V38M28 10V38M32 10V38" />
      </g>
      <circle cx="24" cy="30" r="2.6" fill={fg} />
    </svg>
  );
}
