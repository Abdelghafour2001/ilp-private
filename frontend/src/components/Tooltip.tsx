"use client";

// A simple hover/focus tooltip. Wrap any element; pass the help text in `tip`.
// Used throughout the app to make features approachable (the "guides" pillar).

import { useState } from "react";

export default function Tooltip({
  tip,
  children,
}: {
  tip: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-lg border border-edge bg-ink px-3 py-2 text-xs font-normal leading-relaxed text-text-muted shadow-xl"
        >
          {tip}
        </span>
      )}
    </span>
  );
}

export function InfoDot({ tip }: { tip: string }) {
  return (
    <Tooltip tip={tip}>
      <span className="grid h-4 w-4 cursor-help place-items-center rounded-full border border-edge text-[10px] text-text-subtle">
        ?
      </span>
    </Tooltip>
  );
}
