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
      <span className="absolute inset-0 grid place-items-center text-xs font-bold">{pct}%</span>
    </div>
  );
}

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return "now";
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export default function ForYou() {
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

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">For you</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* weekly goal */}
        <div className="card flex items-center gap-4">
          <GoalRing done={goal.done_min} goal={goal.weekly_goal_min} />
          <div className="min-w-0">
            <p className="text-sm font-medium">Weekly goal</p>
            {goal.weekly_goal_min > 0 ? (
              <p className="text-xs text-text-muted">
                {goal.done_min} / {goal.weekly_goal_min} min this week
                {goal.done_min >= goal.weekly_goal_min && " — done! 🎉"}
              </p>
            ) : (
              <p className="text-xs text-text-subtle">Set a target to build the habit:</p>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {GOAL_CHOICES.map((m) => (
                <button
                  key={m}
                  onClick={() => setGoal(m === goal.weekly_goal_min ? 0 : m)}
                  className={`badge transition ${
                    goal.weekly_goal_min === m
                      ? "badge-accent"
                      : "bg-edge text-text-subtle hover:text-text"
                  }`}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* to-dos: invites + recommendations */}
        <div className="card space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            📥 Waiting for you
          </p>
          {feed.pending.length === 0 && feed.recommendations.length === 0 && (
            <p className="text-sm text-text-subtle">All clear — nothing pending. 🎉</p>
          )}
          {feed.pending.map((p) => (
            <Link key={p.formation_id} href={p.link} className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm hover:border-accent">
              <span>{p.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.title}</span>
                <span className="text-xs text-text-subtle">invited by {p.invited_by} — accept to start</span>
              </span>
            </Link>
          ))}
          {feed.recommendations.map((r, i) => (
            <Link key={i} href={r.link} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-accent">
              <span>🎖️</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.certification}</span>
                <span className="block truncate text-xs text-text-subtle">
                  {r.by} recommends{r.note ? ` — “${r.note}”` : " this for you"}
                </span>
              </span>
            </Link>
          ))}
        </div>

        {/* Upcoming sessions. Hidden with the module: an empty panel pointing
            at a schedule that no longer exists is worse than no panel. */}
        {features?.sessions !== false && (
        <div className="card space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            📅 Next 7 days
          </p>
          {feed.upcoming.length === 0 && (
            <p className="text-sm text-text-subtle">
              No live sessions coming up — check the <Link href="/schedule" className="link">schedule</Link>.
            </p>
          )}
          {feed.upcoming.slice(0, 3).map((u, i) => (
            <Link key={i} href={u.link} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-accent">
              <span>{u.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{u.title}</span>
                <span className="block truncate text-xs text-text-subtle">
                  {new Date(u.starts_at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                  {u.location && ` · ${u.location}`}
                </span>
              </span>
            </Link>
          ))}
        </div>)}
      </div>

      {(feed.pathways.length > 0 || feed.team_activity.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* my pathways */}
          {feed.pathways.length > 0 && (
            <div className="card space-y-2 lg:col-span-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                  🧭 My pathways
                </p>
                <Link href="/pathways" className="link text-xs">View all</Link>
              </div>
              {[...feed.pathways]
                // Required either way — as a compliance pathway, or by this
                // learner's own assignment. Both float to the top.
                .sort(
                  (a, b) =>
                    Number(b.mandatory || b.assigned_mandatory) -
                    Number(a.mandatory || a.assigned_mandatory),
                )
                .map((p) => (
                <Link key={p.id} href="/pathways" className="block rounded-lg border border-border px-3 py-2 hover:border-accent">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate font-medium">{p.emoji} {p.title}</span>
                      {(p.mandatory || p.assigned_mandatory) && (
                        <span className="badge shrink-0 bg-bad/15 text-bad">Obligatoire</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-text-subtle">
                      {p.done_count}/{p.step_count} steps
                      {p.due_date && (
                        <span className="ml-1 text-warn">
                          · due {new Date(p.due_date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className={`block h-full rounded-full ${p.percent === 100 ? "bg-good" : "bg-accent"}`}
                      style={{ width: `${Math.max(2, p.percent)}%` }}
                    />
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* team activity */}
          {feed.team_activity.length > 0 && (
            <div className="card space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                👥 Your team
              </p>
              {feed.team_activity.map((a, i) => (
                <Link key={i} href={a.link} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                  <span>{a.kind === "cert" ? "🏅" : "💬"}</span>
                  <span className="min-w-0 flex-1 text-text-muted">
                    <span className="line-clamp-2">{a.text}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-text-subtle">{ago(a.at)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {!hasAnything && (
        <p className="text-sm text-text-subtle">
          Nothing personal yet — join a training or follow a skill and this section comes alive.
        </p>
      )}
    </section>
  );
}
