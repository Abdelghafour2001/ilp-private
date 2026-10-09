"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { api, type Badge, type LeaderboardEntry } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";

function initials(handle: string) {
  const p = handle.replace(/[._-]+/g, " ").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || handle.slice(0, 2).toUpperCase();
}

const PERIODS = [
  { value: "", label: "All time" },
  { value: "30", label: "This month" },
  { value: "7", label: "This week" },
];

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [teams, setTeams] = useState<{ id: number; name: string }[]>([]);
  const [teamId, setTeamId] = useState<string>("");
  const [period, setPeriod] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = getStoredLearner();

  useEffect(() => {
    api.badges().then(setBadges).catch(() => {});
    api.teamNames().then(setTeams).catch(() => {});
  }, []);

  useEffect(() => {
    setLoaded(false);
    api
      .leaderboard({
        teamId: teamId ? Number(teamId) : null,
        days: period ? Number(period) : null,
      })
      .then(setEntries)
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [teamId, period]);

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  const podiumOrder = [1, 0, 2]; // visual: 2nd, 1st, 3rd
  // Indexed by rank (0 = 1st): the winner gets the tallest column.
  const heights = ["h-36", "h-28", "h-24"];
  const medals = ["from-warn/30", "from-text-subtle/25", "from-accent/25"];
  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? "All time";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="mt-1 text-sm text-text-muted">
            Top learners by XP{period && ` earned ${periodLabel.toLowerCase()}`}. Complete labs
            and trainings to climb.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input max-w-[210px] py-1.5 text-sm"
            title="Filter by team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
          >
            <option value="">🌍 All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  period === p.value
                    ? "bg-accent/15 text-accent-text"
                    : "text-text-subtle hover:text-text"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      {/* ---- Podium ----------------------------------------------------- */}
      {podium.length >= 3 && (
        <div className="grid grid-cols-3 items-end gap-3 sm:gap-5">
          {podiumOrder.map((pos) => {
            const e = podium[pos];
            if (!e) return <div key={pos} />;
            const isMe = me?.handle?.toLowerCase() === e.handle.toLowerCase();
            return (
              <div key={e.handle} className="flex min-w-0 flex-col items-center">
                <span
                  className={`grid h-14 w-14 place-items-center rounded-2xl text-lg font-bold text-white shadow-glow ${
                    pos === 0 ? "bg-accent-sheen" : "bg-accent"
                  }`}
                >
                  {initials(e.handle)}
                </span>
                <p className="mt-2 max-w-full truncate text-sm font-semibold">
                  {e.name || e.handle} {isMe && <span className="text-accent-text">(you)</span>}
                </p>
                <p className="max-w-full truncate text-xs text-text-subtle">
                  Lvl {e.level} · {e.level_title}
                  {e.team_name && ` · ${e.team_name}`}
                </p>
                <div
                  className={`mt-2 flex w-full flex-col items-center justify-end rounded-t-xl border border-b-0 border-border bg-gradient-to-t to-transparent ${medals[pos]} ${heights[pos]}`}
                >
                  <span className="mb-1 text-2xl font-bold text-text-subtle">{pos + 1}</span>
                  <span className="mb-3 font-mono text-sm font-semibold tnum text-accent-text">
                    {e.xp} XP
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- Full table ------------------------------------------------- */}
      <div className="panel overflow-hidden">
        <div className="hidden grid-cols-[3rem_1fr_8rem_6rem_6rem_5rem] gap-2 border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle sm:grid">
          <span>#</span>
          <span>Learner</span>
          <span>Team</span>
          <span className="text-center">Streak</span>
          <span className="text-center">Badges</span>
          <span className="text-right">XP</span>
        </div>
        {entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-subtle">
            {loaded
              ? period
                ? `Nobody earned XP ${periodLabel.toLowerCase()}${teamId ? " in this team" : ""} yet.`
                : "No one on the board yet — be the first!"
              : "Loading…"}
          </p>
        ) : (
          (rest.length ? rest : entries).map((e, i) => {
            const rank = (rest.length ? 3 : 0) + i + 1;
            const isMe = me?.handle?.toLowerCase() === e.handle.toLowerCase();
            return (
              <div
                key={e.handle}
                className={`grid grid-cols-[3rem_1fr_auto] items-center gap-2 border-t border-border px-4 py-3 sm:grid-cols-[3rem_1fr_8rem_6rem_6rem_5rem] ${
                  isMe ? "bg-accent/10" : ""
                }`}
              >
                <span className="font-mono text-sm tnum text-text-subtle">{rank}</span>
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-text-muted">
                    {initials(e.handle)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text">
                      {e.name || e.handle} {isMe && <span className="text-accent-text">(you)</span>}
                    </span>
                    <span className="text-[11px] text-text-subtle">
                      Lvl {e.level} · {e.level_title}
                    </span>
                  </span>
                </span>
                <span className="hidden min-w-0 items-center sm:flex">
                  {e.team_name ? (
                    <span className="badge max-w-full truncate bg-edge text-text-subtle">{e.team_name}</span>
                  ) : (
                    <span className="text-xs text-text-subtle">—</span>
                  )}
                </span>
                <span className="hidden items-center justify-center gap-1 text-sm text-text-muted sm:flex">
                  {e.current_streak > 0 ? (
                    <>
                      <Icon name="flame" size={14} className="text-warn" /> {e.current_streak}
                    </>
                  ) : (
                    <span className="text-text-subtle">—</span>
                  )}
                </span>
                <span className="hidden items-center justify-center gap-1 text-sm text-text-muted sm:flex">
                  <Icon name="trophy" size={14} className="text-iris" /> {e.badges}
                </span>
                <span className="text-right font-mono text-sm font-semibold tnum text-accent-text">
                  {e.xp}
                </span>
              </div>
            );
          })
        )}
      </div>

      {badges.length > 0 && (
        <section className="space-y-3">
          <h2 className="eyebrow">Badges to unlock</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {badges.map((b) => (
              <div key={b.id} className="card card-hover flex items-center gap-3 py-3">
                <span className="text-2xl">{b.emoji}</span>
                <div>
                  <p className="text-sm font-medium">{b.name}</p>
                  <p className="text-xs text-text-muted">{b.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
