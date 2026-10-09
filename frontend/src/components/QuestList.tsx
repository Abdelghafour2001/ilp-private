"use client";

import { useEffect, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { api, type WeeklyQuests } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";

/** Weekly quests with progress bars. Self-fetches for the signed-in learner. */
export default function QuestList({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<WeeklyQuests | null>(null);
  const [signedIn, setSignedIn] = useState(true);

  useEffect(() => {
    const learner = getStoredLearner();
    if (!learner) {
      setSignedIn(false);
      return;
    }
    api.quests(learner.id).then(setData).catch(() => setData(null));
  }, []);

  if (!signedIn) {
    return (
      <div className="panel p-5">
        <h3 className="font-semibold">Weekly quests</h3>
        <p className="mt-1 text-sm text-text-subtle">Sign in to take on this week&apos;s goals.</p>
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Icon name="trophy" size={17} className="text-warn" />
          <h3 className="font-semibold">Weekly quests</h3>
        </div>
        {data && (
          <span className="chip">
            {data.completed}/{data.total} done
          </span>
        )}
      </div>
      <div className={`space-y-3 p-5 ${compact ? "" : "sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0"}`}>
        {!data
          ? [...Array(4)].map((_, i) => <div key={i} className="h-14 skeleton" />)
          : data.quests.map((q) => {
              const pct = Math.round((q.progress / q.target) * 100);
              return (
                <div
                  key={q.id}
                  className={`rounded-xl border p-3.5 ${
                    q.done ? "border-good/40 bg-good/5" : "border-border bg-surface-2"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                        q.done ? "bg-good/15 text-good" : "bg-accent/10 text-accent-text"
                      }`}
                    >
                      <Icon name={(q.icon as IconName) ?? "bolt"} size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text">{q.title}</p>
                      <p className="truncate text-xs text-text-subtle">{q.description}</p>
                    </div>
                    {q.done && <Icon name="check" size={16} className="shrink-0 text-good" />}
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${q.done ? "bg-good" : "bg-accent"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] tnum text-text-subtle">
                      {q.progress}/{q.target}
                    </span>
                  </div>
                </div>
              );
            })}
      </div>
    </div>
  );
}
