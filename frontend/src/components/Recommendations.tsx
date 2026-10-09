"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/Icon";
import { api } from "@/lib/api";
import type { LearningPath } from "@/lib/ai";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";

const DIFF: Record<string, string> = {
  beginner: "badge-good",
  intermediate: "badge-warn",
  advanced: "badge-bad",
};

/** On-demand "what to learn next" — an LLM call, so it's triggered by the user
 * rather than run on every dashboard load. */
export default function Recommendations() {
  const t = useT();
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
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {t("path.title")}
            <span className="badge bg-surface-3 font-normal text-text-subtle">
              <Icon name="sparkles" size={11} aria-hidden="true" /> AI
            </span>
          </h2>
          <p className="mt-0.5 text-sm text-text-muted">{t("path.lede")}</p>
        </div>
        <button className="btn-ghost btn-sm" onClick={generate} disabled={busy} aria-busy={busy}>
          {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
          {busy ? t("path.thinking") : path ? t("path.refresh") : t("path.suggest")}
        </button>
      </div>

      <div aria-live="polite">
        {error && <p className="panel p-5 text-sm text-bad">{error}</p>}

        {busy && !path && (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="panel space-y-2 p-5">
                <div className="h-4 w-2/3 skeleton" />
                <div className="h-3 w-full skeleton" />
                <div className="h-3 w-4/5 skeleton" />
              </div>
            ))}
          </div>
        )}

        {path && (
          <>
            <p className="mb-3 max-w-[65ch] text-sm text-text-muted">{path.summary}</p>
            <ol className="panel divide-y divide-border overflow-hidden">
              {path.recommendations.map((r, i) => (
                <li key={r.lab_id}>
                  <Link
                    href={`/labs/${r.lab_id}`}
                    className="group flex items-start gap-4 p-4 transition-colors hover:bg-surface-2"
                  >
                    <span className="mt-0.5 font-mono text-xs text-text-subtle tnum">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-text group-hover:text-accent-text">{r.title}</span>
                        <span className={`badge ${DIFF[r.difficulty] ?? "badge-accent"}`}>
                          {t(`common.${r.difficulty}`, r.difficulty)}
                        </span>
                      </span>
                      <span className="mt-1 block text-sm text-text-muted">{r.reason}</span>
                    </span>
                    <Icon
                      name="arrow-right"
                      size={16}
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent-text"
                    />
                  </Link>
                </li>
              ))}
            </ol>
          </>
        )}

        {!path && !error && !busy && (
          <div className="rounded-xl border border-dashed border-border-strong px-5 py-6 text-sm text-text-muted">
            {t("path.empty")}
          </div>
        )}
      </div>
    </section>
  );
}
