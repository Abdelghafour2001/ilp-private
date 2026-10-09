"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type SharingSummary } from "@/lib/api";
import ListFilter, { useListFilter } from "@/components/ListFilter";
import { useI18n } from "@/lib/i18n";

export default function SessionsCatalog() {
  const { t } = useI18n();
  const [items, setItems] = useState<SharingSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listSessions().then(setItems).catch((e) => setError(String(e)));
  }, []);

  // Title, abstract, presenter and tags all searchable: people look for a
  // session by who gave it as often as by what it was called.
  const filter = useListFilter(items, (s) => ({
    haystack: [s.title, s.abstract, s.presenter, (s.tags ?? []).join(" ")].join(" "),
    tags: s.tags ?? [],
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Sharing Sessions</h1>
          <p className="mt-1 text-sm text-text-subtle">
            An archive of the team&apos;s knowledge-sharing talks — slides, write-ups, and recordings,
            kept so anyone can review them later.
          </p>
        </div>
        <Link href="/sessions/new" className="btn shrink-0">
          + Post a session
        </Link>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <ListFilter
        placeholder={t("filter.sessions")}
        {...filter}
        total={items.length}
        shown={filter.filtered.length}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {filter.filtered.map((s) => (
          <Link key={s.id} href={`/sessions/${s.id}`} className="card group flex flex-col gap-2 transition hover:border-accent">
            <h3 className="font-medium group-hover:text-accent">{s.title}</h3>
            <p className="line-clamp-2 text-sm text-text-subtle">{s.abstract}</p>
            {(s.tags ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(s.tags ?? []).slice(0, 4).map((tag) => (
                  <span key={tag} className="badge bg-edge text-text-subtle">{tag}</span>
                ))}
              </div>
            )}
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 text-xs text-text-subtle">
              {s.presenter && <span>🎤 {s.presenter}</span>}
              {s.session_date && <span>{s.session_date}</span>}
              {s.has_deck && <span className="badge bg-accent/15 text-accent">slides</span>}
              {s.recording_url && <span className="badge bg-edge text-text-subtle">recording</span>}
            </div>
          </Link>
        ))}
      </div>
      {filter.filtered.length === 0 && !error && (
        <p className="text-sm text-text-subtle">
          {items.length ? t("filter.noMatch") : t("sharing.empty")}
        </p>
      )}
    </div>
  );
}
