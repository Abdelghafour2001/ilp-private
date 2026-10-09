"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type ChallengeSummary } from "@/lib/api";
import ListFilter, { useListFilter } from "@/components/ListFilter";
import { useI18n } from "@/lib/i18n";

export default function ChallengesCatalog() {
  const { t } = useI18n();
  const [items, setItems] = useState<ChallengeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listChallenges().then(setItems).catch((e) => setError(String(e)));
  }, []);

  // The status is a tag like any other here, so "open" is one click.
  const filter = useListFilter(items, (c) => ({
    haystack: [c.title, c.summary, c.theme, c.author, (c.tags ?? []).join(" ")].join(" "),
    tags: [c.status, c.theme, ...(c.tags ?? [])].filter(Boolean) as string[],
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Challenges</h1>
          <p className="mt-1 text-sm text-text-subtle">
            Open innovation — rally the team around a brief, submit ideas, and upvote the best ones.
          </p>
        </div>
        <Link href="/challenges/new" className="btn shrink-0">
          + Post a challenge
        </Link>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <ListFilter
        placeholder={t("filter.challenges")}
        {...filter}
        total={items.length}
        shown={filter.filtered.length}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {filter.filtered.map((c) => (
          <Link key={c.id} href={`/challenges/${c.id}`} className="card group flex flex-col gap-2 transition hover:border-accent">
            <div className="flex items-center justify-between gap-2">
              <span className="badge bg-edge text-text-muted">{c.theme}</span>
              <span className={`badge ${c.status === "open" ? "bg-good/15 text-good" : "bg-edge text-text-subtle"}`}>
                {c.status}
              </span>
            </div>
            <h3 className="font-medium group-hover:text-accent">{c.title}</h3>
            <p className="line-clamp-2 text-sm text-text-subtle">{c.summary}</p>
            <div className="mt-auto flex items-center justify-between pt-2 text-xs text-text-subtle">
              {c.prize ? <span>🏆 {c.prize}</span> : <span>by {c.author}</span>}
              {c.deadline && <span>due {c.deadline}</span>}
            </div>
          </Link>
        ))}
      </div>
      {filter.filtered.length === 0 && !error && (
        <p className="text-sm text-text-subtle">
          {items.length ? t("filter.noMatch") : t("challenges.empty")}
        </p>
      )}
    </div>
  );
}
