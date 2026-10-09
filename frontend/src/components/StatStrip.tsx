"use client";

import type { ReactNode } from "react";
import Icon, { type IconName } from "@/components/Icon";

/** A row of headline figures in one panel, divided by hairlines rather than
 *  boxed one by one: twelve cards in a grid read as twelve equal alarms. */
export default function StatStrip({
  title,
  stats,
  showTitle = true,
}: {
  title: string;
  showTitle?: boolean;
  stats: { label: string; value: ReactNode; hint?: string; icon?: IconName; tone?: "bad" | "warn" | "good" }[];
}) {
  return (
    <section aria-label={title}>
      {showTitle && <h2 className="mb-2 text-sm font-medium text-text-muted">{title}</h2>}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface px-4 py-3.5">
            <dt className="flex items-center gap-1.5 text-xs text-text-subtle">
              {s.icon && <Icon name={s.icon} size={12} />}
              {s.label}
            </dt>
            <dd
              className={`mt-1 text-2xl font-semibold tracking-tight tnum ${
                s.tone === "bad" ? "text-bad" : s.tone === "warn" ? "text-warn" : s.tone === "good" ? "text-good" : ""
              }`}
            >
              {s.value}
            </dd>
            {s.hint && <dd className="mt-0.5 text-[11px] leading-snug text-text-subtle">{s.hint}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

