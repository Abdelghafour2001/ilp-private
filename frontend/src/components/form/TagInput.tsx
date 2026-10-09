"use client";

/**
 * Tags as chips. Enter, comma or Tab commits what was typed; Backspace on an
 * empty box takes the last chip back for editing. Pasting "a, b, c" makes
 * three chips. Replaces the "Tags (comma-separated)" text boxes, where a
 * stray comma or a trailing space quietly made a different tag.
 */

import { useState, type KeyboardEvent } from "react";
import Icon from "@/components/Icon";
import { useT } from "@/lib/i18n";

export function parseTags(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export default function TagInput({
  id,
  value,
  onChange,
  placeholder,
  suggestions = [],
  max = 8,
}: {
  id: string;
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  max?: number;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const next = [...value];
    for (const tag of parseTags(raw)) {
      if (!next.includes(tag) && next.length < max) next.push(tag);
    }
    onChange(next);
    setDraft("");
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "Enter" || e.key === "," || (e.key === "Tab" && draft.trim())) && draft.trim()) {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      e.preventDefault();
      setDraft(value[value.length - 1]);
      onChange(value.slice(0, -1));
    }
  }

  const open = suggestions.filter((s) => !value.includes(s)).slice(0, 8);

  return (
    <div>
      <div className="flex min-h-[2.625rem] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 shadow-xs transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-surface-3 py-0.5 pl-2 pr-1 font-mono text-xs text-text"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="grid h-4 w-4 place-items-center rounded text-text-subtle hover:bg-bad/15 hover:text-bad"
              aria-label={t("form.removeTag", { tag })}
            >
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            // A pasted list arrives in one change event.
            if (v.includes(",")) add(v);
            else setDraft(v);
          }}
          onKeyDown={onKey}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length ? "" : (placeholder ?? t("form.addTag"))}
          disabled={value.length >= max}
          autoComplete="off"
          spellCheck={false}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm text-text outline-none placeholder:text-text-subtle"
        />
      </div>
      {open.length > 0 && value.length < max && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-text-subtle">{t("form.popular")}</span>
          {open.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-md border border-dashed border-border-strong px-1.5 py-0.5 font-mono text-[11px] text-text-muted transition-colors hover:border-accent hover:text-accent-text"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
