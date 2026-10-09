"use client";

/**
 * The frame every "create something" page shares:
 *
 *   ← back
 *   Title                                      ┌ Live preview ─────┐
 *   one line on what this is for               │  the card, as the │
 *   ┌ form ───────────────────────────┐        │  catalogue will   │
 *   │ sections…                        │        │  show it          │
 *   └──────────────────────────────────┘        ├───────────────────┤
 *   [ what's missing ………… Cancel  Post ]       │ ✓ Title ○ Tags …  │
 *                                               └───────────────────┘
 *
 * The preview is the point: people write a better title when they can see it
 * on the card, and they stop guessing what "summary" is for. The checklist
 * says what is required and what merely helps, and the action bar names the
 * one thing still blocking the button instead of greying it out silently.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "@/components/Icon";
import { useT } from "@/lib/i18n";

export interface CheckItem {
  label: string;
  done: boolean;
  /** Required items block submit; the rest are suggestions. */
  required?: boolean;
}

export default function CreateLayout({
  back,
  title,
  lede,
  preview,
  checklist,
  error,
  submitLabel,
  busyLabel,
  busy,
  onSubmit,
  notice,
  children,
}: {
  back: { href: string; label: string };
  title: string;
  lede: string;
  preview: ReactNode;
  checklist: CheckItem[];
  error?: string | null;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  onSubmit: () => void;
  /** Shown above the form: an edit-only note such as a reviewer's rejection. */
  notice?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const missing = checklist.find((c) => c.required && !c.done);
  const done = checklist.filter((c) => c.done).length;

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (!missing && !busy) onSubmit();
      }}
    >
      <header>
        <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-text-subtle hover:text-text">
          <Icon name="arrow-right" size={14} className="rotate-180" /> {back.label}
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-text-muted">{lede}</p>
      </header>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {notice && <div className="mb-4">{notice}</div>}
          <div className="panel p-6 sm:p-7">{children}</div>

          {error && (
            <p role="alert" className="mt-4 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
              {error}
            </p>
          )}

          {/* Sticks to the bottom of the viewport while the form is longer
              than the screen, so the button is never a scroll away. */}
          <div className="sticky bottom-0 z-10 -mx-1 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg/90 px-4 py-3 backdrop-blur-md">
            <p className="flex items-center gap-2 text-sm text-text-muted" aria-live="polite">
              {missing ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" />
                  {t("create.missing", { what: missing.label })}
                </>
              ) : (
                <>
                  <Icon name="check" size={15} className="text-good" />
                  {t("create.ready")}
                </>
              )}
            </p>
            <div className="flex gap-2">
              <Link href={back.href} className="btn-ghost">
                {t("common.cancel")}
              </Link>
              <button type="submit" className="btn" disabled={busy || !!missing} aria-busy={busy}>
                {busy && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                )}
                {busy ? busyLabel : submitLabel}
              </button>
            </div>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-subtle">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-50 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              {t("create.preview")}
            </p>
            <div aria-hidden="true" className="pointer-events-none select-none">
              {preview}
            </div>
          </div>

          <div className="panel p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <p className="text-sm font-semibold">{t("create.checklist")}</p>
              <span className="text-xs text-text-subtle tnum">
                {done}/{checklist.length}
              </span>
            </div>
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full origin-left rounded-full bg-accent transition-transform duration-300"
                style={{ transform: `scaleX(${checklist.length ? done / checklist.length : 0})` }}
              />
            </div>
            <ul className="space-y-1.5">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-sm">
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded-full transition-colors ${
                      c.done ? "bg-good text-white" : "border border-border-strong"
                    }`}
                    aria-hidden="true"
                  >
                    {c.done && <Icon name="check" size={10} strokeWidth={3} />}
                  </span>
                  <span className={c.done ? "text-text-muted line-through decoration-text-subtle/40" : "text-text"}>
                    {c.label}
                  </span>
                  {c.required && !c.done && (
                    <span className="ml-auto text-[11px] text-text-subtle">{t("create.required")}</span>
                  )}
                  <span className="sr-only">{c.done ? t("create.done") : t("create.todo")}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </form>
  );
}
