"use client";

/**
 * One labelled form field: label on top, the control, then either the error
 * (when there is one) or the hint. A placeholder is not a label — it vanishes
 * the moment someone types and screen readers treat it as optional — so every
 * control on a create form goes through this.
 *
 * `count`/`max` show a quiet counter that turns amber near the limit, for the
 * fields that end up on a card where length matters (titles, summaries).
 */

import { useId, type ReactNode } from "react";
import { useT } from "@/lib/i18n";

export function useFieldId(id?: string) {
  const auto = useId();
  return id ?? auto;
}

export default function Field({
  id,
  label,
  hint,
  error,
  optional,
  count,
  max,
  children,
  className = "",
}: {
  /** The id of the control inside, so the label is clickable. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean | string;
  count?: number;
  max?: number;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  const near = max != null && count != null && count > max * 0.9;
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
          {optional && (
            <span className="ml-1.5 text-xs font-normal text-text-subtle">
              {typeof optional === "string" ? optional : t("form.optional")}
            </span>
          )}
        </label>
        {max != null && count != null && (
          <span
            className={`text-xs tnum ${count > max ? "text-bad" : near ? "text-warn" : "text-text-subtle"}`}
            aria-live="polite"
          >
            {count}/{max}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-relaxed text-text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A titled block of fields. On wide screens the title and blurb sit in a left
 * column so a long form reads as a few decisions, not one endless stack.
 */
export function FormSection({
  title,
  lede,
  step,
  children,
}: {
  title: string;
  lede?: string;
  step?: number;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-x-8 gap-y-4 border-t border-border py-7 first:border-t-0 first:pt-0 xl:grid-cols-[13rem_minmax(0,1fr)]">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {step != null && (
            <span className="grid h-5 w-5 place-items-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent-text tnum">
              {step}
            </span>
          )}
          {title}
        </h2>
        {lede && <p className="mt-1 text-xs leading-relaxed text-text-subtle">{lede}</p>}
      </div>
      <div className="min-w-0 space-y-5">{children}</div>
    </section>
  );
}

/** A row of mutually exclusive choices, styled as one control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-border bg-surface-2 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              on ? "bg-surface text-text shadow-xs" : "text-text-subtle hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
