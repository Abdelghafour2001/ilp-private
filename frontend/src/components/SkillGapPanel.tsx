"use client";

/**
 * Where you are vs where your role expects you to be.
 *
 * A self-rating on its own says "Sara thinks she is a 3 at SQL" — true, and
 * useless. Two things make it actionable, and this panel shows both:
 *
 * 1. **Provenance.** The level shown is the most authoritative one available
 *    (assessment > manager > peers > self), and the badge says which. A number
 *    without its source invites more trust than it has earned.
 * 2. **A target.** The role profile supplies the expected level, so the gap is
 *    a number rather than a feeling.
 *
 * A skill with no target shows "—", not a gap of zero: "nobody has said what
 * this role needs" and "you already meet it" are different facts.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type Learner, type MySkillState, type RatingSource } from "@/lib/api";
import { useT } from "@/lib/i18n";

const SOURCE_META: Record<RatingSource, { key: string; fallback: string; cls: string }> = {
  assessment: { key: "skills.source.assessment", fallback: "assessment", cls: "bg-good/15 text-good" },
  manager: { key: "skills.source.manager", fallback: "manager", cls: "bg-accent/15 text-accent-text" },
  peer: { key: "skills.source.peer", fallback: "peers", cls: "bg-iris/15 text-iris" },
  self: { key: "skills.source.self", fallback: "self-rated", cls: "bg-edge text-text-subtle" },
  none: { key: "skills.source.none", fallback: "not rated", cls: "bg-edge text-text-subtle" },
};

/** Five dots, filled to `level`, with the target marked when there is one. */
function LevelDots({ level, target }: { level: number; target: number | null }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${level}/5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= level;
        const isTarget = target !== null && n === target;
        return (
          <span
            key={n}
            className={`h-2 w-2 rounded-full ${
              filled ? "bg-accent" : "bg-surface-2"
            } ${isTarget ? "ring-1 ring-warn ring-offset-1 ring-offset-surface" : ""}`}
          />
        );
      })}
    </span>
  );
}

export default function SkillGapPanel({ me }: { me: Learner | null }) {
  const t = useT();
  const [state, setState] = useState<MySkillState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!me) return;
    api.mySkillState(me.id).then(setState).catch((e) => setError(String(e)));
  }, [me]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!me) return null;
  if (error) return <div className="card border-bad/40 text-sm text-bad">{error}</div>;
  if (!state) return <p className="text-sm text-text-subtle">{t("common.loading")}</p>;

  if (state.skills.length === 0) {
    return (
      <div className="card text-sm text-text-subtle">
        {t("skills.noState", "Follow a few skills and rate yourself to see your gaps.")}
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            🎯 {t("skills.myLevel", "My level vs my role")}
          </p>
          <p className="mt-0.5 text-xs text-text-subtle">
            {state.profile
              ? t("skills.profileIs", { name: state.profile.name })
              : t("skills.noProfile", "No role profile matches your practice and job level yet.")}
          </p>
        </div>
        {state.gaps > 0 && (
          <span className="badge bg-warn/15 text-warn">
            {t("skills.gapCount", { count: state.gaps })}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-edge text-xs uppercase tracking-wide text-text-subtle">
            <tr>
              <th className="py-2 pr-3 font-medium">{t("skills.col.skill", "Skill")}</th>
              <th className="py-2 pr-3 font-medium">{t("skills.col.level", "Level")}</th>
              <th className="py-2 pr-3 font-medium">{t("skills.col.source", "Rated by")}</th>
              <th className="py-2 pr-3 text-right font-medium">{t("skills.col.target", "Target")}</th>
              <th className="py-2 text-right font-medium">{t("skills.col.gap", "Gap")}</th>
            </tr>
          </thead>
          <tbody>
            {state.skills.map((s) => {
              const meta = SOURCE_META[s.source] ?? SOURCE_META.none;
              return (
                <tr key={s.skill_id} className="border-t border-edge">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-1.5 text-xs text-text-subtle">{s.category}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2">
                      <LevelDots level={s.level} target={s.target} />
                      <span className="font-mono text-xs">{s.level || "—"}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`badge ${meta.cls}`}
                      title={
                        // Spell out the corroboration so the badge is checkable.
                        `self ${s.self} · peers ${s.peers} · manager ${s.manager} · assessment ${s.assessment}`
                      }
                    >
                      {t(meta.key, meta.fallback)}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-xs">
                    {s.target ?? "—"}
                  </td>
                  <td
                    className={`py-2 text-right font-mono text-xs ${
                      s.gap === null
                        ? "text-text-subtle"
                        : s.gap > 0
                          ? "text-warn"
                          : "text-good"
                    }`}
                  >
                    {s.gap === null ? "—" : s.gap > 0 ? `+${s.gap}` : "✓"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-text-subtle">
        {t(
          "skills.provenanceNote",
          "The level shown is the most authoritative rating available: an assessment outranks a manager, who outranks colleagues, who outrank a self-rating. Hover the badge to see all four.",
        )}
      </p>
    </div>
  );
}
