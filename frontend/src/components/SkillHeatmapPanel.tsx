"use client";

/**
 * Org-wide skill coverage — "where are we thin?".
 *
 * This is the question a skills framework exists to answer, and the one a
 * per-programme hours report cannot: hours tell you how much training was
 * consumed, not whether the organisation can actually do the work.
 *
 * Two numbers per cell, and they say different things:
 *
 * * **coverage** — share of the group at level 3+ ("can do this unaided").
 *   Meaningful even where nobody has set a target.
 * * **gap** — average shortfall against the role target, and how many people
 *   are short. Only meaningful once a role profile exists, so a group with no
 *   targets shows coverage and a dash rather than a fake zero.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type Learner, type SkillHeatmap } from "@/lib/api";
import { useT } from "@/lib/i18n";

const AXES = ["bu", "practice", "location", "job_level"] as const;

/** Green where the group is strong, amber thin, red absent. */
function coverageStyle(coverage: number, rated: number) {
  if (!rated) return "bg-surface-2 text-text-subtle";
  if (coverage >= 60) return "bg-good/20 text-good";
  if (coverage >= 30) return "bg-warn/20 text-warn";
  return "bg-bad/20 text-bad";
}

export default function SkillHeatmapPanel({ me }: { me: Learner | null }) {
  const t = useT();
  const [axis, setAxis] = useState<(typeof AXES)[number]>("practice");
  const [data, setData] = useState<SkillHeatmap | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    api
      .skillHeatmap(axis, me?.id)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [axis, me?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) return <div className="card border-bad/40 text-sm text-bad">{error}</div>;
  if (!data) return <p className="text-sm text-text-subtle">{t("common.loading")}</p>;

  return (
    <div className="card space-y-3 p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2.5">
        <span className="text-xs text-text-subtle">{t("org.heatmap.axis")}</span>
        <select
          className="input h-8 max-w-[190px] py-0 text-xs"
          value={axis}
          onChange={(e) => setAxis(e.target.value as (typeof AXES)[number])}
        >
          {AXES.map((a) => (
            <option key={a} value={a}>
              {t(`org.col.${a === "job_level" ? "jobLevel" : a}`)}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-text-subtle">
          {t("org.heatmap.coverage")}
        </span>
      </div>

      {data.groups.length === 0 || data.skills.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-text-subtle">
          {t("org.heatmap.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-edge text-xs uppercase tracking-wide text-text-subtle">
              <tr>
                <th className="sticky left-0 z-10 bg-surface px-4 py-3 font-medium">
                  {t(`org.col.${axis === "job_level" ? "jobLevel" : axis}`)}
                </th>
                {data.skills.map((s) => (
                  <th key={s.id} className="px-2 py-3 text-center font-medium" title={s.category}>
                    <span className="block max-w-[86px] truncate">{s.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => (
                <tr key={g.group} className="border-t border-edge">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-2.5">
                    <span className="font-medium">{g.group}</span>
                    <span className="ml-1.5 text-xs text-text-subtle">n={g.members}</span>
                  </td>
                  {g.cells.map((c) => (
                    <td key={c.skill_id} className="px-1.5 py-2 text-center">
                      <span
                        className={`inline-flex min-w-[54px] flex-col rounded-md px-1.5 py-1 ${coverageStyle(
                          c.coverage,
                          c.rated,
                        )}`}
                        title={
                          c.targeted
                            ? `${t("org.heatmap.gap")} ${c.avg_gap} · ${t("org.heatmap.short", {
                                count: c.people_short,
                              })}`
                            : t("org.heatmap.coverage")
                        }
                      >
                        <span className="font-mono text-xs font-semibold">
                          {c.rated ? `${c.coverage}%` : "—"}
                        </span>
                        {/* Only show a gap where a role target exists; a dash
                            is honest, a zero would not be. */}
                        <span className="text-[10px] opacity-80">
                          {c.targeted ? (c.avg_gap > 0 ? `▼${c.avg_gap}` : "✓") : "—"}
                        </span>
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-edge px-4 py-2 text-[11px] text-text-subtle">
        {t(
          "org.heatmap.legend",
          "Top number: share of the group at level 3+ (can work unaided). Bottom: average shortfall against the role target, or — when the role sets none.",
        )}
      </p>
    </div>
  );
}
