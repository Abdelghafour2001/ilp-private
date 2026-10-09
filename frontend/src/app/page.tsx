"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ForYou from "@/components/ForYou";
import Icon from "@/components/Icon";
import OnboardingWizard from "@/components/OnboardingWizard";
import Recommendations from "@/components/Recommendations";
import QuestList from "@/components/QuestList";
import { navFor } from "@/lib/nav";
import { useFeatures } from "@/lib/features";
import { api, type LeaderboardEntry, type Recommendation } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";

interface Stats {
  xp: number;
  level: number;
  levelTitle: string;
  streak: number;
  rank: number | null;
}

export default function Home() {
  const t = useT();
  const [handle, setHandle] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({
    xp: 0,
    level: 1,
    levelTitle: "Novice",
    streak: 0,
    rank: null,
  });
  const [top, setTop] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  // Modules this deployment switched off do not belong on the explore grid
  // any more than they belong in the sidebar.
  const features = useFeatures();
  // What to do next, with the reason attached. Computed from what they have
  // already started, the programmes they nearly hold, and what their unit is
  // taking — no model, nothing to tune, and every line can be checked.
  const [reco, setReco] = useState<Recommendation[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const learner = getStoredLearner();
      setHandle(learner?.handle ?? null);
      setRole(learner?.role ?? null);
      // The person's own figures, fetched on their own and first.
      //
      // These used to sit inside the leaderboard's `try`, after `await
      // api.leaderboard()`. The leaderboard is a module that can be switched
      // off, and the feature middleware answers a switched-off module with
      // 404 — deliberately, so it "does not exist" rather than looking
      // forbidden. For every learner outside the roles allowed to see
      // rankings that 404 threw, the profile fetch below it never ran, and
      // the dashboard kept its initial state: Lvl 1, Novice, 0 XP, shown to
      // somebody who was level 5 with 1406 XP. The feature's own description
      // promises XP "is still earned and still shown on a profile"; nothing
      // optional may take that away.
      if (learner) {
        const profile = await api.learnerProfile(learner.id).catch(() => null);
        if (alive && profile) {
          if (profile.name) setHandle(profile.name);
          setStats((s) => ({
            ...s,
            xp: profile.xp,
            level: profile.level,
            levelTitle: profile.level_title,
            streak: profile.current_streak,
          }));
        }
      }
      if (alive) setLoading(false);

      // The ranking is decoration, so it comes second and may fail alone.
      const board = await api.leaderboard().catch(() => []);
      if (alive && board.length) {
        setTop(board.slice(0, 5));
        if (learner) {
          const rank = board.findIndex((e) => e.handle === learner.handle);
          setStats((s) => ({ ...s, rank: rank >= 0 ? rank + 1 : null }));
        }
      }
      if (learner) {
        const suggestions = await api.recommendations(learner.id).catch(() => null);
        if (alive && suggestions) setReco(suggestions.items.slice(0, 5));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  const statCards = [
    {
      label: stats.levelTitle,
      value: `Lvl ${stats.level}`,
      icon: "trophy" as const,
      accent: "text-accent-text",
    },
    { label: "Total XP", value: stats.xp, icon: "bolt" as const, accent: "text-iris" },
    { label: "Day streak", value: stats.streak, icon: "flame" as const, accent: "text-warn" },
    // Rank is a position against colleagues: it belongs to the leaderboard and
    // goes when the leaderboard does, or a learner is shown their place in a
    // ranking they cannot see.
    ...(features?.leaderboard === false
      ? []
      : [{
          label: "Rank",
          value: stats.rank ? `#${stats.rank}` : "—",
          icon: "leaderboard" as const,
          accent: "text-good",
        }]),
  ];

  return (
    <div className="space-y-8">
      {/* Switchable from the admin switchboard: a deployment whose questions
          are not ready should not greet its first colleagues with them. */}
      {features?.onboarding !== false && <OnboardingWizard />}
      {/* ---- Hero -------------------------------------------------------- */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-surface p-8 shadow-sm animate-fade-up md:p-10">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-accent/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-32 h-56 w-56 rounded-full bg-iris/10 blur-3xl" />
        <div className="relative max-w-2xl">
          <p className="eyebrow mb-3">{t("home.subtitle")}</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {greeting}
            {handle ? (
              <>
                , <span className="text-gradient">{handle}</span>
              </>
            ) : (
              <>
                {" "}— learn by <span className="text-gradient">doing</span>
              </>
            )}
            .
          </h1>
          {/* The promise has to match the modules this client bought. A hero
              selling graded labs on a deployment with labs switched off is the
              first thing a new learner reads and the first thing that is
              wrong. */}
          <p className="mt-3 text-[15px] leading-relaxed text-text-muted">
            {features?.labs === false ? t("home.ledeTraining") : t("home.ledeFull")}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {features?.labs === false ? (
              <Link href="/formations" className="btn">
                <Icon name="formations" size={16} /> {t("home.startTraining")}
              </Link>
            ) : (
              <Link href="/labs" className="btn">
                <Icon name="labs" size={16} /> {t("home.startLab")}
              </Link>
            )}
            <Link href="/courses" className="btn-ghost">
              <Icon name="courses" size={16} /> {t("home.browseCourses")}
            </Link>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("aida-open-command"))}
              className="btn-ghost"
            >
              <Icon name="command" size={16} /> {t("home.quickJump")}
              <span className="kbd ml-1">⌘K</span>
            </button>
          </div>
        </div>
      </section>

      {/* ---- Stats ------------------------------------------------------- */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((s, i) => (
          <div
            key={s.label}
            className="card card-hover animate-fade-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-text-subtle">
                {s.label}
              </span>
              <Icon name={s.icon} size={18} className={s.accent} />
            </div>
            <p className="mt-3 font-mono text-3xl font-semibold tnum text-text">
              {loading ? <span className="inline-block h-8 w-16 skeleton align-middle" /> : s.value}
            </p>
          </div>
        ))}
      </section>

      {/* ---- For you: goal, invites, sessions, pathways, team ----------- */}
      <ForYou />

      {/* ---- Weekly quests --------------------------------------------- */}
      {/* Every weekly quest counts lab steps and SQL exercises. With labs off
          they are four counters stuck at zero, which reads as a product that
          does not work rather than one that was narrowed. */}
      {features?.labs !== false && <QuestList />}

      {/* ---- Personalized path ----------------------------------------- */}
      {features?.labs !== false && <Recommendations />}

      <div className="grid gap-8 lg:grid-cols-3">
        {/* ---- Explore ---------------------------------------------------- */}
        <section className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t("home.explore")}</h2>
          </div>
          <div className="space-y-6">
            {navFor(role, features)
              .filter((g) => g.title !== "Overview")
              .map((group) => (
              <div key={group.title}>
                <p className="eyebrow mb-2.5">{group.title}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="card card-hover group flex items-start gap-3.5"
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-accent-text transition-colors group-hover:border-accent/30 group-hover:bg-accent/10">
                        <Icon name={item.icon} size={19} />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium text-text">
                          {item.label}
                          <Icon
                            name="arrow-right"
                            size={14}
                            className="text-text-subtle opacity-0 transition-all -translate-x-1 group-hover:translate-x-0 group-hover:opacity-100"
                          />
                        </span>
                        <span className="mt-0.5 block text-sm text-text-muted">{item.desc}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- What to do next -------------------------------------------- */}
        {reco.length > 0 && (
          <section className="lg:col-span-1">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {t("home.recommended", "Recommended for you")}
              </h2>
            </div>
            <div className="panel divide-y divide-border overflow-hidden">
              {reco.map((r) =>
                r.external ? (
                  <a
                    key={r.slug}
                    href={r.link}
                    target="_blank"
                    rel="noreferrer"
                    className="block p-3.5 transition hover:bg-surface-2"
                  >
                    <p className="font-medium">{r.title}</p>
                    <p className="mt-0.5 text-xs text-text-muted">{r.reason}</p>
                  </a>
                ) : (
                  <Link key={r.slug} href={r.link} className="block p-3.5 transition hover:bg-surface-2">
                    <p className="font-medium">{r.title}</p>
                    <p className="mt-0.5 text-xs text-text-muted">{r.reason}</p>
                  </Link>
                ),
              )}
            </div>
          </section>
        )}

        {/* ---- Leaderboard preview --------------------------------------- */}
        {features?.leaderboard !== false && (
        <section className="lg:col-span-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t("home.topLearners")}</h2>
            <Link href="/leaderboard" className="link text-sm">
              {t("home.viewAll")}
            </Link>
          </div>
          <div className="panel divide-y divide-border overflow-hidden">
            {loading ? (
              [...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3.5">
                  <span className="h-7 w-7 skeleton rounded-full" />
                  <span className="h-4 flex-1 skeleton" />
                </div>
              ))
            ) : top.length === 0 ? (
              <p className="p-6 text-center text-sm text-text-subtle">
                {t("home.noLearners")}
              </p>
            ) : (
              top.map((entry, i) => (
                <div key={entry.handle} className="flex items-center gap-3 p-3.5">
                  <span
                    className={[
                      "grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold",
                      i === 0
                        ? "bg-warn/15 text-warn"
                        : i === 1
                          ? "bg-text-subtle/15 text-text-muted"
                          : i === 2
                            ? "bg-accent/15 text-accent-text"
                            : "bg-surface-2 text-text-subtle",
                    ].join(" ")}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
                    {entry.handle}
                  </span>
                  <span className="font-mono text-sm tnum text-text-muted">{entry.xp} XP</span>
                </div>
              ))
            )}
          </div>

          {features?.labs !== false && (
            <div className="card mt-4 bg-surface-2">
              <div className="flex items-center gap-2 text-sm font-medium text-text">
                <Icon name="sparkles" size={16} className="text-accent-text" />
                {t("home.tutor")}
              </div>
              <p className="mt-1.5 text-sm text-text-muted">
                {t("home.tutorHint")}
              </p>
              <Link href="/labs" className="btn-soft mt-3 w-full">
                {t("home.tryTutor")}
              </Link>
            </div>
          )}
        </section>
        )}
      </div>
    </div>
  );
}
