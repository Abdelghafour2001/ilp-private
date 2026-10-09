"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type LabSummary } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";
import Icon from "@/components/Icon";

const LEVEL_DOT: Record<string, string> = {
  beginner: "bg-good",
  intermediate: "bg-warn",
  advanced: "bg-bad",
};

function progress(lab: LabSummary) {
  const done = lab.gradable_count > 0 && lab.completed_count >= lab.gradable_count;
  const pct = lab.gradable_count ? Math.round((lab.completed_count / lab.gradable_count) * 100) : 0;
  return { done, pct, started: lab.completed_count > 0 };
}

export default function LabsCatalog() {
  const t = useT();
  const [labs, setLabs] = useState<LabSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const learner = getStoredLearner();
    api
      .listLabs(learner?.id)
      .then(setLabs)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const all = labs ?? [];
  const tracks = Array.from(new Set(all.map((l) => l.track)));
  // Started but not finished: the thing most people open this page for.
  const inProgress = all.filter((l) => {
    const p = progress(l);
    return p.started && !p.done;
  });
  const finished = all.filter((l) => progress(l).done).length;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">{t("labs.title")}</h1>
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-text-muted">{t("labs.lede")}</p>
        </div>
        {all.length > 0 && (
          <p className="text-sm text-text-muted tnum">
            {t("labs.finishedOf", { done: finished, total: all.length })}
          </p>
        )}
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {labs === null && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-48 skeleton rounded-xl" />
          ))}
        </div>
      )}

      {labs?.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center text-sm text-text-muted">
          {t("labs.empty")}
        </div>
      )}

      {inProgress.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">{t("labs.continue")}</h2>
          <ul className="panel divide-y divide-border overflow-hidden">
            {inProgress.map((lab) => {
              const p = progress(lab);
              return (
                <li key={lab.id}>
                  <Link href={`/labs/${lab.id}`} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent-text">
                      <Icon name="labs" size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium group-hover:text-accent-text">{lab.title}</span>
                      <span className="text-xs text-text-subtle tnum">
                        {t("labs.steps", { done: lab.completed_count, total: lab.gradable_count })}
                      </span>
                    </span>
                    <span className="hidden w-40 items-center gap-2 sm:flex">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <span className="block h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${p.pct / 100})` }} />
                      </span>
                      <span className="w-8 text-right text-xs tnum">{p.pct}%</span>
                    </span>
                    <span className="text-sm font-medium text-accent-text">{t("form.hub.continue")}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {tracks.map((track) => (
        <section key={track}>
          <h2 className="mb-3 text-base font-semibold">{track}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {all
              .filter((l) => l.track === track)
              .map((lab) => {
                const p = progress(lab);
                return (
                  <Link
                    key={lab.id}
                    href={`/labs/${lab.id}`}
                    className="group flex flex-col rounded-xl border border-border bg-surface p-5 shadow-xs transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                          p.done ? "bg-good/15 text-good" : "bg-surface-2 text-text-muted group-hover:bg-accent/10 group-hover:text-accent-text"
                        } transition-colors`}
                      >
                        <Icon name={p.done ? "check" : "labs"} size={18} strokeWidth={p.done ? 2.5 : 1.8} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold leading-snug group-hover:text-accent-text">{lab.title}</h3>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text-subtle">
                          <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[lab.difficulty] ?? "bg-text-subtle"}`} />
                          <span className="capitalize">{t(`common.${lab.difficulty}`, lab.difficulty)}</span>
                          <span>·</span>
                          <span className="tnum">{t("labs.stepCount", { n: lab.gradable_count })}</span>
                          <span>·</span>
                          <span className="inline-flex items-center gap-0.5 tnum">
                            <Icon name="bolt" size={11} className="text-iris" /> {lab.total_xp}&nbsp;XP
                          </span>
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-text-muted">{lab.summary}</p>
                    <div className="mt-auto pt-4">
                      {p.done ? (
                        <p className="flex items-center justify-between text-xs">
                          <span className="inline-flex items-center gap-1 font-medium text-good">
                            <Icon name="check" size={13} /> {t("labs.completed")}
                          </span>
                          <span className="text-text-subtle group-hover:text-text">{t("labs.review")}</span>
                        </p>
                      ) : (
                        <div className="flex items-center gap-3">
                          <span
                            className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
                            role="progressbar"
                            aria-valuenow={p.pct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={lab.title}
                          >
                            <span className="block h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${p.pct / 100})` }} />
                          </span>
                          <span className="text-xs font-medium text-accent-text">
                            {p.started ? t("form.hub.continue") : t("form.hub.start")}
                          </span>
                        </div>
                      )}
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
