"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type LabSummary } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";

const DIFFICULTY: Record<string, string> = {
  beginner: "bg-good/15 text-good",
  intermediate: "bg-warn/15 text-warn",
  advanced: "bg-bad/15 text-bad",
};

export default function LabsCatalog() {
  const [labs, setLabs] = useState<LabSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const learner = getStoredLearner();
    api
      .listLabs(learner?.id)
      .then(setLabs)
      .catch((e) => setError(String(e)));
  }, []);

  const tracks = Array.from(new Set(labs.map((l) => l.track)));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Labs</h1>
        <p className="mt-1 text-sm text-text-muted">
          Hands-on lessons against a live sandbox. Sign in (top right) to save progress and earn XP.
        </p>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}
      {labs.length === 0 && !error && (
        <p className="text-sm text-text-subtle">No labs found in <code>backend/labs/</code>.</p>
      )}

      {tracks.map((track) => (
        <section key={track} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">{track}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {labs
              .filter((l) => l.track === track)
              .map((lab) => {
                const done = lab.gradable_count > 0 && lab.completed_count >= lab.gradable_count;
                const pct = lab.gradable_count
                  ? Math.round((lab.completed_count / lab.gradable_count) * 100)
                  : 0;
                return (
                  <Link
                    key={lab.id}
                    href={`/labs/${lab.id}`}
                    className="card group flex flex-col gap-3 transition hover:border-accent"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-medium group-hover:text-accent">
                        {done && "✓ "}
                        {lab.title}
                      </h3>
                      <span className={`badge ${DIFFICULTY[lab.difficulty] ?? "bg-edge text-text-muted"}`}>
                        {lab.difficulty}
                      </span>
                    </div>
                    <p className="text-sm text-text-muted">{lab.summary}</p>
                    <div className="mt-auto flex items-center justify-between text-xs text-text-subtle">
                      <span>⚡ {lab.total_xp} XP</span>
                      <span>
                        {lab.completed_count}/{lab.gradable_count} done
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-edge">
                      <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
