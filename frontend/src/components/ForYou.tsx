"use client";

/**
 * ForYou — the personalized slice of the home page: weekly learning goal,
 * pending invites, personal recommendations, upcoming sessions, pathway
 * progress, and what the team has been up to. Renders nothing when signed out.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useFeatures } from "@/lib/features";
import { api, type MyFeed } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import Icon from "@/components/Icon";
import { useFormat, useI18n } from "@/lib/i18n";

const GOAL_CHOICES = [15, 30, 60, 120];

function GoalRing({ done, goal }: { done: number; goal: number }) {
  const pct = goal > 0 ? Math.min(100, Math.round((100 * done) / goal)) : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-surface-3" />
        <circle
          cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
          className={pct >= 100 ? "stroke-good" : "stroke-accent"}
          strokeDasharray={c}
          strokeDashoffset={c - (c * pct) / 100}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-xs font-semibold tnum">{pct}%</span>
    </div>
  );
}

function ago(iso: string, locale: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (mins < 60) return rtf.format(-Math.max(0, mins), "minute");
  const h = Math.round(mins / 60);
  return h < 24 ? rtf.format(-h, "hour") : rtf.format(-Math.round(h / 24), "day");
}

export default function ForYou() {
  const { t, locale } = useI18n();
  const fmt = useFormat();
  const features = useFeatures();
  const [feed, setFeed] = useState<MyFeed | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  const load = useCallback(() => {
    const me = getStoredLearner();
    setSignedIn(!!me);
    if (!me) {
      setFeed(null);
      return;
    }
    api.myFeed(me.id).then(setFeed).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("dqai-learner-changed", load);
    return () => window.removeEventListener("dqai-learner-changed", load);
  }, [load]);

  async function setGoal(minutes: number) {
    const me = getStoredLearner();
    if (!me) return;
    await api.setGoal(me.id, minutes).catch(() => {});
    load();
  }

  if (!signedIn || !feed) return null;

  const { goal } = feed;
  const hasAnything =
    feed.pending.length || feed.recommendations.length || feed.upcoming.length ||
    feed.pathways.length || feed.team_activity.length || goal.weekly_goal_min;
  const sessionsOn = features?.sessions !== false;
  const row = "group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-surface-2";

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">{t("foryou.title")}</h2>
      <div className="panel overflow-hidden">
        {/* weekly goal */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 p-5">
          <GoalRing done={goal.done_min} goal={goal.weekly_goal_min} />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-text">{t("foryou.goal")}</p>
            <p className="mt-0.5 text-sm text-text-muted tnum">
              {goal.weekly_goal_min > 0
                ? goal.done_min >= goal.weekly_goal_min
                  ? t("foryou.goalDone", { done: goal.done_min, goal: goal.weekly_goal_min })
                  : t("foryou.goalProgress", { done: goal.done_min, goal: goal.weekly_goal_min })
                : t("foryou.goalNone")}
            </p>
          </div>
          <div
            role="group"
            aria-label={t("foryou.goalPick")}
            className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5"
          >
            {GOAL_CHOICES.map((m) => {
              const on = goal.weekly_goal_min === m;
              return (
                <button
                  key={m}
                  aria-pressed={on}
                  onClick={() => setGoal(on ? 0 : m)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium tnum transition-colors ${
                    on ? "bg-surface text-text shadow-xs" : "text-text-subtle hover:text-text"
                  }`}
                >
                  {m}&nbsp;min
                </button>
              );
            })}
          </div>
        </div>

        <div className={`grid border-t border-border ${sessionsOn ? "sm:grid-cols-2 sm:divide-x" : ""} divide-border`}>
          {/* to-dos: invites + recommendations */}
          <div className="p-5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-subtle">
              <Icon name="bell" size={13} aria-hidden="true" /> {t("foryou.waiting")}
            </p>
            {feed.pending.length === 0 && feed.recommendations.length === 0 && (
              <p className="flex items-center gap-2 py-2 text-sm text-text-muted">
                <Icon name="check" size={15} aria-hidden="true" className="text-good" /> {t("foryou.allClear")}
              </p>
            )}
            {feed.pending.map((p) => (
              <Link key={p.formation_id} href={p.link} className={row}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-base" aria-hidden="true">
                  {p.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text">{p.title}</span>
                  <span className="block truncate text-xs text-text-subtle">
                    {t("foryou.invitedBy", { who: p.invited_by })}
                  </span>
                </span>
                <span className="badge badge-accent shrink-0">{t("foryou.accept")}</span>
              </Link>
            ))}
            {feed.recommendations.map((r, i) => (
              <Link key={i} href={r.link} className={row}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-3 text-text-muted" aria-hidden="true">
                  <Icon name="award" size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text">{r.certification}</span>
                  <span className="block truncate text-xs text-text-subtle">
                    {r.note
                      ? t("foryou.recommendsNote", { who: r.by, note: r.note })
                      : t("foryou.recommends", { who: r.by })}
                  </span>
                </span>
              </Link>
            ))}
          </div>

          {/* Upcoming sessions. Hidden with the module: an empty panel pointing
              at a schedule that no longer exists is worse than no panel. */}
          {sessionsOn && (
            <div className="border-t border-border p-5 sm:border-t-0">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-subtle">
                <Icon name="calendar" size={13} aria-hidden="true" /> {t("foryou.next7")}
              </p>
              {feed.upcoming.length === 0 && (
                <p className="py-2 text-sm text-text-muted">
                  {t("foryou.noSessions")}{" "}
                  <Link href="/schedule" className="link">{t("foryou.schedule")}</Link>
                </p>
              )}
              {feed.upcoming.slice(0, 3).map((u, i) => {
                const d = new Date(u.starts_at);
                return (
                  <Link key={i} href={u.link} className={row}>
                    <span className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-surface leading-none">
                      <span className="text-[9px] font-semibold uppercase text-bad">
                        {fmt.date(d, { month: "short" }).replace(".", "")}
                      </span>
                      <span className="mt-0.5 text-sm font-semibold tnum">{d.getDate()}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-text">{u.title}</span>
                      <span className="block truncate text-xs text-text-subtle tnum">
                        {fmt.date(d, { weekday: "short" })} · {fmt.time(d)}
                        {u.location && ` · ${u.location}`}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {(feed.pathways.length > 0 || feed.team_activity.length > 0) && (
        <div className="mt-4 grid gap-4 xl:grid-cols-5">
          {/* my pathways */}
          {feed.pathways.length > 0 && (
            <div className={`panel p-5 ${feed.team_activity.length ? "xl:col-span-3" : "xl:col-span-5"}`}>
              <div className="mb-3 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-medium text-text-subtle">
                  <Icon name="route" size={13} aria-hidden="true" /> {t("foryou.pathways")}
                </p>
                <Link href="/pathways" className="link text-xs">{t("home.viewAll")}</Link>
              </div>
              <ul className="space-y-1">
                {[...feed.pathways]
                  // Required either way — as a compliance pathway, or by this
                  // learner's own assignment. Both float to the top.
                  .sort(
                    (a, b) =>
                      Number(b.mandatory || b.assigned_mandatory) -
                      Number(a.mandatory || a.assigned_mandatory),
                  )
                  .map((p) => (
                    <li key={p.id}>
                      <Link href="/pathways" className="-mx-2 block rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span aria-hidden="true">{p.emoji}</span>
                            <span className="min-w-0 truncate font-medium text-text">{p.title}</span>
                            {(p.mandatory || p.assigned_mandatory) && (
                              <span className="badge badge-bad shrink-0">{t("foryou.mandatory")}</span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs text-text-subtle tnum">
                            {p.done_count}/{p.step_count}
                            {p.due_date && (
                              <span className="ml-1.5 text-warn">
                                · {t("foryou.due", { date: fmt.date(p.due_date, { day: "numeric", month: "short" }) })}
                              </span>
                            )}
                          </span>
                        </div>
                        <div
                          className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3"
                          role="progressbar"
                          aria-valuenow={p.percent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={p.title}
                        >
                          <span
                            className={`block h-full rounded-full ${p.percent === 100 ? "bg-good" : "bg-accent"}`}
                            style={{ width: `${Math.max(2, p.percent)}%` }}
                          />
                        </div>
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {/* team activity */}
          {feed.team_activity.length > 0 && (
            <div className={`panel p-5 ${feed.pathways.length ? "xl:col-span-2" : "xl:col-span-5"}`}>
              <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-text-subtle">
                <Icon name="team" size={13} aria-hidden="true" /> {t("foryou.team")}
              </p>
              <ul className="space-y-0.5">
                {feed.team_activity.map((a, i) => (
                  <li key={i}>
                    <Link href={a.link} className="-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surface-2">
                      <Icon
                        name={a.kind === "cert" ? "award" : "sessions"}
                        size={14}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-text-subtle"
                      />
                      <span className="min-w-0 flex-1 text-text-muted">
                        <span className="line-clamp-2">{a.text}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-text-subtle tnum">{ago(a.at, locale)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!hasAnything && (
        <p className="mt-3 text-sm text-text-subtle">{t("foryou.empty")}</p>
      )}
    </section>
  );
}
