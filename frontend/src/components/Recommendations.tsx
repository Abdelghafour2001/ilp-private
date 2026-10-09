"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/Icon";
import { api } from "@/lib/api";
import type { LearningPath } from "@/lib/ai";
import { getStoredLearner } from "@/lib/learner";

const DIFF: Record<string, string> = {
  beginner: "badge-good",
  intermediate: "badge-warn",
  advanced: "badge-bad",
};

/** On-demand "what to learn next" — an LLM call, so it's triggered by the user
 * rather than run on every dashboard load. */
export default function Recommendations() {
  const [path, setPath] = useState<LearningPath | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const learner = getStoredLearner();
      setPath(await api.recommend(learner?.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-sheen text-white shadow-glow">
            <Icon name="sparkles" size={19} />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Your learning path</h2>
            <p className="text-sm text-text-muted">AI-picked next steps based on your progress</p>
          </div>
        </div>
        <button className="btn" onClick={generate} disabled={busy}>
          {busy ? "Thinking…" : path ? "Refresh" : "Suggest next steps"}
        </button>
      </div>

      {error && <p className="p-5 text-sm text-bad">{error}</p>}

      {path && (
        <div className="p-5">
          <p className="mb-4 text-sm text-text-muted">{path.summary}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {path.recommendations.map((r) => (
              <Link
                key={r.lab_id}
                href={`/labs/${r.lab_id}`}
                className="card card-hover group block"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text">{r.title}</span>
                  <span className={`badge ${DIFF[r.difficulty] ?? "badge-accent"} shrink-0`}>
                    {r.difficulty}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-text-muted">{r.reason}</p>
                <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent-text">
                  Start
                  <Icon
                    name="arrow-right"
                    size={14}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!path && !error && (
        <div className="p-5">
          <p className="text-sm text-text-subtle">
            Get a personalized sequence of labs to work through next — built from what you&apos;ve
            already completed.
          </p>
        </div>
      )}
    </section>
  );
}
