"use client";

import { useEffect, useState } from "react";

/**
 * The tags people already use on this kind of thing, most frequent first, so a
 * new item lands next to its neighbours instead of inventing "LLM" beside "llm".
 */
export function usePopularTags(load: () => Promise<{ tags?: string[] | null }[]>, limit = 8) {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    load()
      .then((items) => {
        const counts = new Map<string, number>();
        for (const it of items) for (const t of it.tags ?? []) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) ?? 0) + 1);
        if (alive) setTags([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // `load` is an inline arrow at every call site; run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return tags;
}
