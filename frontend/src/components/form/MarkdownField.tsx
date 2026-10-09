"use client";

/**
 * A markdown textarea with Write / Preview tabs and a three-button toolbar
 * (bold, list, code) for people who don't know the syntax by heart. Preview
 * uses the same renderer the published page does, so what you see is what
 * gets posted.
 */

import { useRef, useState } from "react";
import MarkdownLite from "@/components/MarkdownLite";
import { useT } from "@/lib/i18n";

export default function MarkdownField({
  id,
  value,
  onChange,
  placeholder,
  rows = 8,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  describedBy?: string;
}) {
  const t = useT();
  const [tab, setTab] = useState<"write" | "preview">("write");
  const area = useRef<HTMLTextAreaElement>(null);

  /** Wrap the selection (or insert at the caret) and keep the caret sensible. */
  function wrap(before: string, after = before, linePrefix = false) {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = value.slice(a, b);
    const next = linePrefix
      ? value.slice(0, a) + (sel || "item").split("\n").map((l) => before + l).join("\n") + value.slice(b)
      : value.slice(0, a) + before + (sel || "text") + after + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const start = a + before.length;
      el.setSelectionRange(start, start + (sel || (linePrefix ? "item" : "text")).length);
    });
  }

  const tabCls = (on: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${on ? "bg-surface text-text shadow-xs" : "text-text-subtle hover:text-text"}`;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-2 py-1.5">
        <div role="tablist" className="inline-flex rounded-lg p-0.5">
          <button type="button" role="tab" aria-selected={tab === "write"} className={tabCls(tab === "write")} onClick={() => setTab("write")}>
            {t("form.md.write")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "preview"} className={tabCls(tab === "preview")} onClick={() => setTab("preview")}>
            {t("form.md.preview")}
          </button>
        </div>
        {tab === "write" && (
          <div className="flex items-center gap-0.5 text-text-subtle">
            <button type="button" onClick={() => wrap("**")} className="grid h-7 w-7 place-items-center rounded-md text-sm font-bold hover:bg-surface hover:text-text" aria-label={t("form.md.bold")} title={t("form.md.bold")}>
              B
            </button>
            <button type="button" onClick={() => wrap("- ", "", true)} className="grid h-7 w-7 place-items-center rounded-md text-sm hover:bg-surface hover:text-text" aria-label={t("form.md.list")} title={t("form.md.list")}>
              •≡
            </button>
            <button type="button" onClick={() => wrap("`")} className="grid h-7 w-7 place-items-center rounded-md font-mono text-xs hover:bg-surface hover:text-text" aria-label={t("form.md.code")} title={t("form.md.code")}>
              {"</>"}
            </button>
          </div>
        )}
      </div>
      {tab === "write" ? (
        <textarea
          ref={area}
          id={id}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-describedby={describedBy}
          className="block w-full resize-y bg-transparent px-3 py-2.5 text-sm leading-relaxed text-text outline-none placeholder:text-text-subtle"
        />
      ) : (
        <div className="min-h-[10rem] px-4 py-3">
          {value.trim() ? (
            <MarkdownLite>{value}</MarkdownLite>
          ) : (
            <p className="text-sm text-text-subtle">{t("form.md.empty")}</p>
          )}
        </div>
      )}
    </div>
  );
}
