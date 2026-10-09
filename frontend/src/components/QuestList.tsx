"use client";

import { useEffect, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { api, type WeeklyQuests } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";

/** Weekly quests with progress bars. Self-fetches for the signed-in learner. */
export default function QuestList({ compact = false }: { compact?: boolean }) {
  const t = useT();
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
        <h3 className="font-semibold">{t("quests.title")}</h3>
        <p className="mt-1 text-sm text-text-subtle">{t("quests.signIn")}</p>
      </div>
    );
  }

  const Title = compact ? "h3" : "h2";
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <Title className="text-base font-semibold">{t("quests.title")}</Title>
        {data && (
          <span className="text-xs text-text-subtle tnum">
            {t("quests.done", { done: data.completed, total: data.total })}
          </span>
        )}
      </div>
      <ul
        className={`panel grid overflow-hidden ${
          compact ? "" : "sm:grid-cols-2"
        } [&>li]:border-border [&>li:not(:first-child)]:border-t ${
          compact ? "" : "sm:[&>li:nth-child(2)]:border-t-0 sm:[&>li:nth-child(even)]:border-l"
        }`}
      >
        {!data
          ? [...Array(4)].map((_, i) => (
              <li key={i} className="p-4">
                <div className="h-12 skeleton" />
              </li>
            ))
          : data.quests.map((q) => {
              const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
              return (
                <li key={q.id} className="flex items-center gap-3.5 p-4">
                  <span
                    aria-hidden="true"
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                      q.done ? "bg-good/15 text-good" : "bg-surface-2 text-text-muted"
                    }`}
                  >
                    <Icon name={q.done ? "check" : ((q.icon as IconName) ?? "bolt")} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-text">{q.title}</p>
                      <span className="shrink-0 text-xs text-text-subtle tnum">
                        {q.progress}/{q.target}
                      </span>
                    </div>
                    <p className="truncate text-xs text-text-subtle">{q.description}</p>
                    <div
                      className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={q.title}
                    >
                      <div
                        className={`h-full origin-left rounded-full transition-transform duration-500 ${q.done ? "bg-good" : "bg-accent"}`}
                        style={{ transform: `scaleX(${pct / 100})` }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
      </ul>
    </section>
  );
}
