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
import { useFormat, useT } from "@/lib/i18n";
import LevelRing from "@/components/LevelRing";

interface Stats {
  xp: number;
  level: number;
  levelTitle: string;
  levelPct: number;
  toNext: number;
  streak: number;
  rank: number | null;
}

export default function Home() {
  const t = useT();
  const fmt = useFormat();
  const [me, setMe] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({
    xp: 0,
    level: 1,
    levelTitle: "Novice",
    levelPct: 0,
    toNext: 0,
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
      setMe(learner?.handle ?? null);
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
            levelPct: profile.level_pct,
            toNext: profile.xp_to_next,
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

  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  // First name only: "Good afternoon, Salma" reads like a person said it;
  // the full name plus surname reads like a mail merge.
  const firstName = handle?.split(/[\s.]/)[0] ?? "";
  const today = fmt.date(new Date(), { weekday: "long", day: "numeric", month: "long" });
  const showRank = features?.leaderboard !== false;
  const labsOff = features?.labs === false;

  return (
    <div className="space-y-10">
      {/* Switchable from the admin switchboard: a deployment whose questions
          are not ready should not greet its first colleagues with them. */}
      {features?.onboarding !== false && <OnboardingWizard />}

      {/* ---- Greeting + progress ---------------------------------------- */}
      <section className="grid items-end gap-8 pt-2 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="animate-fade-up">
          <p className="eyebrow mb-4 first-letter:uppercase">{today}</p>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            {t(`home.greeting.${part}`)}
            {firstName && (
              <>
                , <span className="text-accent-text">{firstName}</span>
              </>
            )}
            .
          </h1>
          {/* The promise has to match the modules this client bought. A hero
              selling graded labs on a deployment with labs switched off is the
              first thing a new learner reads and the first thing that is
              wrong. */}
          <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-text-muted">
            {labsOff ? t("home.ledeTraining") : t("home.ledeFull")}
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
            {labsOff ? (
              <Link href="/formations" className="btn px-4 py-2.5">
                <Icon name="formations" size={16} aria-hidden="true" /> {t("home.startTraining")}
              </Link>
            ) : (
              <Link href="/labs" className="btn px-4 py-2.5">
                <Icon name="labs" size={16} aria-hidden="true" /> {t("home.startLab")}
              </Link>
            )}
            <Link
              href="/courses"
              className="group inline-flex items-center gap-1.5 text-sm font-medium text-text hover:text-accent-text"
            >
              {t("home.browseCourses")}
              <Icon
                name="arrow-right"
                size={15}
                aria-hidden="true"
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("aida-open-command"))}
              className="hidden items-center gap-2 text-sm text-text-subtle hover:text-text sm:inline-flex"
            >
              {t("home.quickJump")}
              <span className="kbd">⌘&nbsp;K</span>
            </button>
          </div>
        </div>

        {/* One composed progress card instead of four look-alike stat boxes:
            the level is the headline, the rest are its footnotes. */}
        <Link
          href="/profile"
          aria-label={t("home.progress.aria", { level: stats.level, title: stats.levelTitle })}
          className="panel group block animate-fade-up overflow-hidden transition-[border-color,box-shadow] duration-200 [animation-delay:80ms] hover:border-border-strong hover:shadow-md"
        >
          <div className="flex items-center gap-4 p-5">
            {loading ? (
              <span className="h-[72px] w-[72px] skeleton rounded-full" />
            ) : (
              <LevelRing level={stats.level} pct={stats.levelPct} label={t("home.lvl")} />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-text">{stats.levelTitle}</p>
              <p className="mt-0.5 text-sm text-text-muted tnum">
                {loading ? (
                  <span className="inline-block h-4 w-32 skeleton align-middle" />
                ) : (
                  t("home.progress.toNext", { xp: fmt.number(stats.toNext), level: stats.level + 1 })
                )}
              </p>
            </div>
            <Icon
              name="chevron-right"
              size={16}
              aria-hidden="true"
              className="shrink-0 text-text-subtle transition-transform group-hover:translate-x-0.5"
            />
          </div>
          <dl
            className={`grid divide-x divide-border border-t border-border bg-surface-2/60 ${
              showRank ? "grid-cols-3" : "grid-cols-2"
            }`}
          >
            <div className="px-4 py-3">
              <dt className="flex items-center gap-1 text-xs text-text-subtle">
                <Icon name="bolt" size={12} aria-hidden="true" className="text-iris" /> XP
              </dt>
              <dd className="mt-0.5 font-semibold tnum">{loading ? "—" : fmt.number(stats.xp)}</dd>
            </div>
            <div className="px-4 py-3">
              <dt className="flex items-center gap-1 text-xs text-text-subtle">
                <Icon name="flame" size={12} aria-hidden="true" className="text-warn" /> {t("home.streak")}
              </dt>
              <dd className="mt-0.5 font-semibold tnum">
                {loading ? "—" : stats.streak}
              </dd>
            </div>
            {/* Rank is a position against colleagues: it belongs to the
                leaderboard and goes when the leaderboard does, or a learner is
                shown their place in a ranking they cannot see. */}
            {showRank && (
              <div className="px-4 py-3">
                <dt className="flex items-center gap-1 text-xs text-text-subtle">
                  <Icon name="leaderboard" size={12} aria-hidden="true" className="text-good" /> {t("home.rank")}
                </dt>
                <dd className="mt-0.5 font-semibold tnum">{stats.rank ? `#${stats.rank}` : "—"}</dd>
              </div>
            )}
          </dl>
        </Link>
      </section>

      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {/* ---- For you: goal, invites, sessions, pathways, team --------- */}
          <ForYou />

          {/* ---- Weekly quests ------------------------------------------- */}
          {/* Every weekly quest counts lab steps and SQL exercises. With labs
              off they are four counters stuck at zero, which reads as a
              product that does not work rather than one that was narrowed. */}
          {!labsOff && <QuestList />}

          {/* ---- Personalized path --------------------------------------- */}
          {!labsOff && <Recommendations />}
        </div>

        <aside className="min-w-0 space-y-10">
          {/* ---- What to do next ------------------------------------------ */}
          {reco.length > 0 && (
            <section>
              <h2 className="mb-3 text-base font-semibold">
                {t("home.recommended", "Recommended for you")}
              </h2>
              <ol className="space-y-1">
                {reco.map((r, i) => {
                  const inner = (
                    <>
                      <span className="mt-0.5 font-mono text-xs text-text-subtle tnum">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-text group-hover:text-accent-text">
                          {r.title}
                          {r.external && <span aria-hidden="true"> ↗</span>}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{r.reason}</span>
                      </span>
                    </>
                  );
                  const cls = "group -mx-2.5 flex gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-surface-2";
                  return (
                    <li key={r.slug}>
                      {r.external ? (
                        <a href={r.link} target="_blank" rel="noreferrer" className={cls}>
                          {inner}
                        </a>
                      ) : (
                        <Link href={r.link} className={cls}>
                          {inner}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {/* ---- Leaderboard preview ------------------------------------- */}
          {showRank && (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-base font-semibold">{t("home.topLearners")}</h2>
                <Link href="/leaderboard" className="link text-sm">
                  {t("home.viewAll")}
                </Link>
              </div>
              <ol className="panel divide-y divide-border overflow-hidden">
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <li key={i} className="flex items-center gap-3 px-4 py-3">
                      <span className="h-7 w-7 skeleton rounded-lg" />
                      <span className="h-4 flex-1 skeleton" />
                    </li>
                  ))
                ) : top.length === 0 ? (
                  <li className="p-6 text-center text-sm text-text-subtle">{t("home.noLearners")}</li>
                ) : (
                  top.map((entry, i) => {
                    const isMe = entry.handle === me;
                    const display = entry.name || entry.handle;
                    return (
                      <li
                        key={entry.handle}
                        className={`relative flex items-center gap-3 px-4 py-2.5 ${isMe ? "bg-accent/5" : ""}`}
                      >
                        {isMe && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" aria-hidden="true" />}
                        <span className="w-4 text-center font-mono text-xs text-text-subtle tnum">{i + 1}</span>
                        <span
                          aria-hidden="true"
                          className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-semibold ${
                            i === 0 ? "bg-warn/15 text-warn" : "bg-surface-3 text-text-muted"
                          }`}
                        >
                          {initials(display)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
                          {display}
                          {isMe && <span className="ml-1.5 text-xs font-normal text-accent-text">{t("home.you")}</span>}
                        </span>
                        <span className="text-sm tnum text-text-muted">
                          {fmt.number(entry.xp)}
                          <span className="ml-1 text-xs text-text-subtle">XP</span>
                        </span>
                      </li>
                    );
                  })
                )}
              </ol>
            </section>
          )}

          {!labsOff && (
            <section className="rounded-xl border border-dashed border-border-strong p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-text">
                <Icon name="sparkles" size={16} aria-hidden="true" className="text-accent-text" />
                {t("home.tutor")}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{t("home.tutorHint")}</p>
              <Link href="/labs" className="link mt-3 inline-flex items-center gap-1 text-sm">
                {t("home.tryTutor")} <Icon name="arrow-right" size={14} aria-hidden="true" />
              </Link>
            </section>
          )}
        </aside>
      </div>

      {/* ---- Explore ------------------------------------------------------ */}
      {/* A directory, not a second sidebar of big cards: one line per
          destination, grouped the same way the navigation is. */}
      <section className="border-t border-border pt-8">
        <h2 className="mb-6 text-base font-semibold">{t("home.explore")}</h2>
        <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {navFor(role, features)
            .filter((g) => g.title !== "Overview")
            .map((group) => (
              <div key={group.title} className="min-w-0">
                <p className="eyebrow mb-2">{t(group.titleKey, group.title)}</p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface"
                      >
                        <Icon
                          name={item.icon}
                          size={17}
                          aria-hidden="true"
                          className="shrink-0 text-text-subtle transition-colors group-hover:text-accent-text"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-text">{t(item.labelKey, item.label)}</span>
                          <span className="block truncate text-xs text-text-subtle">{t(item.descKey, item.desc)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}

function initials(name: string) {
  const parts = name.split(/[\s.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
