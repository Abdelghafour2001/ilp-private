"use client";

/**
 * Search and tag filtering for the catalogue pages (sessions, challenges,
 * assets). One component so the three behave identically: the same box in the
 * same place, the same chips, the same count.
 *
 * Filtering happens in the browser on a list that is already loaded. These
 * catalogues hold tens of items, not thousands, so a round trip per keystroke
 * would buy nothing and cost a spinner. Move it to the server when a page
 * starts paginating.
 */

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";

export interface Filterable {
  /** Everything the search box should look at, already flattened. */
  haystack: string;
  tags: string[];
}

export function useListFilter<T>(items: T[], describe: (item: T) => Filterable) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string[]>([]);

  const described = useMemo(
    () => items.map((item) => ({ item, ...describe(item) })),
    // `describe` is defined inline by callers, so depending on it would rebuild
    // this on every render; the items are what actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  );

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of described) {
      for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [described]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return described
      .filter((row) => !needle || row.haystack.toLowerCase().includes(needle))
      // Several tags narrow rather than widen: picking "sql" and "genai" means
      // both, which is what a person filtering a catalogue expects.
      .filter((row) => active.every((tag) => row.tags.includes(tag)))
      .map((row) => row.item);
  }, [described, query, active]);

  function toggle(tag: string) {
    setActive((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));
  }

  function clear() {
    setQuery("");
    setActive([]);
  }

  return { query, setQuery, active, toggle, clear, allTags, filtered };
}

export default function ListFilter({
  placeholder,
  query,
  setQuery,
  active,
  toggle,
  clear,
  allTags,
  total,
  shown,
}: {
  placeholder: string;
  query: string;
  setQuery: (value: string) => void;
  active: string[];
  toggle: (tag: string) => void;
  clear: () => void;
  allTags: [string, number][];
  total: number;
  shown: number;
}) {
  const { t } = useI18n();
  const filtering = shown !== total;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-sm"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-sm text-text-subtle tnum">
          {filtering ? t("filter.showing", { shown, total }) : t("filter.count", { total })}
        </span>
        {filtering && (
          <button type="button" className="btn-ghost btn-sm" onClick={clear}>
            {t("filter.clear")}
          </button>
        )}
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map(([tag, count]) => {
            const on = active.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggle(tag)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  on
                    ? "border-accent bg-accent/15 font-medium text-accent-text"
                    : "border-border text-text-subtle hover:text-text"
                }`}
              >
                {on ? "✓ " : ""}
                {tag}
                <span className="ml-1 tnum text-text-subtle">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
