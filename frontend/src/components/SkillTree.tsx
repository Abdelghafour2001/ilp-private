"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { api, type SkillTrack } from "@/lib/api";

const DIFF: Record<string, string> = {
  beginner: "badge-good",
  intermediate: "badge-warn",
  advanced: "badge-bad",
};

/** The skill tree: tracks as columns of lab nodes, with completion progress. */
export default function SkillTree({ learnerId }: { learnerId?: number }) {
  const [tracks, setTracks] = useState<SkillTrack[] | null>(null);

  useEffect(() => {
    api
      .tracks(learnerId)
      .then((r) => setTracks(r.tracks))
      .catch(() => setTracks([]));
  }, [learnerId]);

  if (!tracks) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-48 skeleton rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tracks.map((t) => (
        <div key={t.track} className="panel flex flex-col overflow-hidden">
          <div className="border-b border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{t.track}</h3>
              {t.done ? (
                <span className="badge badge-good">
                  <Icon name="check" size={12} /> Mastered
                </span>
              ) : (
                <span className="font-mono text-xs tnum text-text-subtle">{t.pct}%</span>
              )}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className={`h-full rounded-full transition-all duration-700 ${t.done ? "bg-good" : "bg-accent"}`}
                style={{ width: `${t.pct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-text-subtle">
              {t.completed_steps}/{t.total_steps} steps · {t.earned_xp}/{t.total_xp} XP
            </p>
          </div>

          <div className="relative space-y-1 p-3">
            {t.labs.map((lab, i) => {
              const started = lab.completed_steps > 0;
              return (
                <Link
                  key={lab.id}
                  href={`/labs/${lab.id}`}
                  className="group relative flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
                >
                  {i < t.labs.length - 1 && (
                    <span className="absolute left-[1.45rem] top-9 h-[calc(100%-1rem)] w-px bg-border" />
                  )}
                  <span
                    className={[
                      "z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] font-semibold",
                      lab.done
                        ? "border-transparent bg-good text-white"
                        : started
                          ? "border-accent bg-accent/15 text-accent-text"
                          : "border-border-strong bg-surface text-text-subtle",
                    ].join(" ")}
                  >
                    {lab.done ? <Icon name="check" size={12} /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{lab.title}</span>
                    <span className="text-[11px] text-text-subtle">
                      {lab.completed_steps}/{lab.total_steps} · {lab.total_xp} XP
                    </span>
                  </span>
                  <span className={`badge ${DIFF[lab.difficulty] ?? "badge-accent"} shrink-0`}>
                    {lab.difficulty.slice(0, 3)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
