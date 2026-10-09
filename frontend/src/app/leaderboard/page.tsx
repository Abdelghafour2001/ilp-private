"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { Segmented } from "@/components/form/Field";
import { api, type Badge, type LeaderboardEntry } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useFormat, useT } from "@/lib/i18n";

function initials(handle: string) {
  const p = handle.replace(/[._-]+/g, " ").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || handle.slice(0, 2).toUpperCase();
}

type Period = "" | "30" | "7";

// Medal tones for the three podium places, by rank (0 = first).
const PLACE = [
  { ring: "ring-warn/60", text: "text-warn", label: "lb.first" },
  { ring: "ring-text-subtle/50", text: "text-text-muted", label: "lb.second" },
  { ring: "ring-[#c08457]/60", text: "text-[#a8693e] dark:text-[#d79a6b]", label: "lb.third" },
];

export default function Leaderboard() {
  const t = useT();
  const fmt = useFormat();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [earned, setEarned] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState<{ id: number; name: string }[]>([]);
  const [teamId, setTeamId] = useState<string>("");
  const [period, setPeriod] = useState<Period>("");
  const [error, setError] = useState<string | null>(null);
  const [me] = useState(() => getStoredLearner());

  useEffect(() => {
    api.badges().then(setBadges).catch(() => {});
    api.teamNames().then(setTeams).catch(() => {});
    if (me) api.learnerProfile(me.id, me.id).then((p) => setEarned(new Set(p.badges))).catch(() => {});
  }, [me]);

  useEffect(() => {
    setEntries(null);
    setError(null);
    api
      .leaderboard({ teamId: teamId ? Number(teamId) : null, days: period ? Number(period) : null })
      .then(setEntries)
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setEntries([]);
      });
  }, [teamId, period]);

  const isMe = (e: LeaderboardEntry) => !!me?.handle && me.handle.toLowerCase() === e.handle.toLowerCase();
  const list = entries ?? [];
  const showPodium = list.length >= 3;
  const podium = showPodium ? list.slice(0, 3) : [];
  const rest = showPodium ? list.slice(3) : list;
  const myRank = list.findIndex(isMe);
  const mine = myRank >= 0 ? list[myRank] : null;
  const ahead = myRank > 0 ? list[myRank - 1] : null;
  const locked = badges.filter((b) => !earned.has(b.id));
  const periodLabel = { "": t("lb.allTime"), "30": t("lb.month"), "7": t("lb.week") }[period];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">{t("lb.title")}</h1>
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-text-muted">{t("lb.lede")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-auto max-w-[14rem] py-1.5 text-sm"
            aria-label={t("lb.team")}
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
          >
            <option value="">{t("lb.allTeams")}</option>
            {teams.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.name}
              </option>
            ))}
          </select>
          <Segmented
            label={t("lb.period")}
            value={period}
            onChange={setPeriod}
            options={[
              { value: "" as Period, label: t("lb.allTime") },
              { value: "30" as Period, label: t("lb.month") },
              { value: "7" as Period, label: t("lb.week") },
            ]}
          />
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {entries === null && (
        <div className="space-y-4" aria-busy="true">
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 skeleton rounded-xl" />
            ))}
          </div>
          <div className="h-64 skeleton rounded-xl" />
        </div>
      )}

      {/* Where I stand, and the one number that matters: the gap to the next place. */}
      {mine && (
        <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-accent/30 bg-accent/5 px-5 py-4">
          <p className="text-sm">
            <span className="text-text-muted">{t("lb.yourRank")}</span>{" "}
            <span className="text-2xl font-semibold tnum">#{myRank + 1}</span>
            <span className="text-text-subtle tnum"> / {list.length}</span>
          </p>
          <p className="text-sm">
            <span className="font-semibold tnum">{fmt.number(mine.xp)}</span>{" "}
            <span className="text-text-muted">XP · {periodLabel.toLowerCase()}</span>
          </p>
          <p className="text-sm text-text-muted sm:ml-auto">
            {ahead ? (
              <>
                <Icon name="arrow-up" size={13} className="mr-1 inline text-accent-text" />
                {t("lb.toPass", { n: fmt.number(ahead.xp - mine.xp + 1), name: ahead.name || ahead.handle })}
              </>
            ) : (
              <>
                <Icon name="trophy" size={13} className="mr-1 inline text-warn" />
                {t("lb.onTop")}
              </>
            )}
          </p>
        </section>
      )}

      {showPodium && (
        <ol className="grid grid-cols-3 items-end gap-3 sm:gap-5" aria-label={t("lb.podium")}>
          {/* Read in rank order; laid out 2 · 1 · 3 so the winner stands in the middle. */}
          {[0, 1, 2].map((pos) => {
            const e = podium[pos];
            const p = PLACE[pos];
            return (
              <li
                key={e.handle}
                style={{ order: pos === 0 ? 2 : pos === 1 ? 1 : 3 }}
                className={`panel flex min-w-0 flex-col items-center px-2 text-center sm:px-4 ${
                  pos === 0 ? "pb-6 pt-7 shadow-md" : "pb-5 pt-5"
                } ${isMe(e) ? "border-accent" : ""}`}
              >
                <span className="sr-only">{t(p.label)}</span>
                <span className={`text-xs font-semibold uppercase tracking-wider ${p.text}`} aria-hidden="true">
                  {pos + 1}
                </span>
                <span
                  className={`mt-2 grid place-items-center rounded-full bg-surface-2 font-semibold text-text ring-2 ring-offset-2 ring-offset-surface ${p.ring} ${
                    pos === 0 ? "h-16 w-16 text-lg" : "h-12 w-12 text-sm"
                  }`}
                  aria-hidden="true"
                >
                  {initials(e.handle)}
                </span>
                <p className="mt-3 w-full truncate text-sm font-semibold">
                  {e.name || e.handle}
                  {isMe(e) && <span className="text-accent-text"> · {t("lb.you")}</span>}
                </p>
                <p className="w-full truncate text-xs text-text-subtle">{e.team_name || e.level_title}</p>
                <p className={`mt-3 font-semibold tracking-tight tnum ${pos === 0 ? "text-2xl" : "text-lg"}`}>
                  {fmt.number(e.xp)}
                  <span className="ml-1 text-xs font-medium text-text-subtle">XP</span>
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {entries !== null && (
        <div className="panel overflow-x-auto">
          {list.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Icon name="trophy" size={22} className="mx-auto text-text-subtle" />
              <p className="mt-3 text-sm text-text-muted">
                {period || teamId ? t("lb.emptyFiltered") : t("lb.empty")}
              </p>
            </div>
          ) : rest.length > 0 ? (
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-text-subtle">
                  <th scope="col" className="w-14 px-4 py-2.5 font-medium">#</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">{t("lb.learner")}</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">{t("lb.teamCol")}</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-medium">{t("lb.streak")}</th>
                  <th scope="col" className="px-2 py-2.5 text-right font-medium">{t("lb.badges")}</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">XP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rest.map((e, i) => {
                  const rank = (showPodium ? 3 : 0) + i + 1;
                  const mineRow = isMe(e);
                  return (
                    <tr key={e.handle} className={mineRow ? "bg-accent/5" : "hover:bg-surface-2/60"} aria-current={mineRow ? "true" : undefined}>
                      <td className={`px-4 py-3 tnum ${mineRow ? "font-semibold text-accent-text" : "text-text-subtle"}`}>{rank}</td>
                      <td className="px-2 py-3">
                        <span className="flex min-w-0 items-center gap-3">
                          <span
                            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                              mineRow ? "bg-accent text-accent-fg" : "bg-surface-2 text-text-muted"
                            }`}
                            aria-hidden="true"
                          >
                            {initials(e.handle)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {e.name || e.handle}
                              {mineRow && <span className="text-accent-text"> · {t("lb.you")}</span>}
                            </span>
                            <span className="block text-xs text-text-subtle">
                              {t("lb.level", { n: e.level })} · {e.level_title}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="max-w-[12rem] truncate px-2 py-3 text-text-muted">{e.team_name || "—"}</td>
                      <td className="px-2 py-3 text-right tnum text-text-muted">
                        {e.current_streak > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <Icon name="flame" size={13} className="text-warn" /> {e.current_streak}
                          </span>
                        ) : (
                          <span className="text-text-subtle">—</span>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right tnum text-text-muted">{e.badges}</td>
                      <td className="px-4 py-3 text-right font-semibold tnum">{fmt.number(e.xp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      )}

      {locked.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold">{t("lb.toUnlock")}</h2>
            <Link href="/profile" className="text-sm text-accent-text hover:underline">
              {t("lb.seeBadges", { n: earned.size, total: badges.length })}
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {locked.slice(0, 6).map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-xl border border-dashed border-border-strong px-4 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-xl grayscale" aria-hidden="true">
                  {b.emoji}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{b.name}</span>
                  <span className="line-clamp-2 text-xs text-text-subtle">{b.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
