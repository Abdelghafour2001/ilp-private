"use client";

/**
 * My goals — what this person is working towards, and how close they are.
 *
 * Progress is never entered by hand. A goal names skills and the levels it
 * wants; the distance comes from the same measurement the gap analysis uses,
 * so a goal and a development plan cannot disagree about where somebody
 * stands. That is why there is no "mark 60% done" control here: the number is
 * evidence, not a feeling.
 *
 * Each goal carries what to do about it — content already tagged against the
 * skills that are short. Suggesting work for a gap nobody has is how a
 * learning platform starts recommending noise.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Goal, type SkillRow } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const LEVELS = [1, 2, 3, 4, 5];

export default function GoalsPanel({ learnerId }: { learnerId: number }) {
  const { t } = useI18n();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listGoals(learnerId, learnerId)
      .then((r) => setGoals(r.goals))
      .catch((e) => setError(String(e.message ?? e)));
  }, [learnerId]);

  useEffect(load, [load]);
  useEffect(() => {
    api.listSkills().then(setSkills).catch(() => {});
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api.createGoal({
        learner_id: learnerId,
        title: title.trim(),
        due_date: due || null,
        targets: Object.entries(picked).map(([id, target]) => ({
          skill_id: Number(id),
          target,
        })),
      });
      setTitle("");
      setDue("");
      setPicked({});
      setAdding(false);
      load();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function close(goal: Goal, status: "achieved" | "dropped") {
    await api.setGoalStatus(goal.id, status, learnerId);
    load();
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">{t("goals.title")}</h2>
          <p className="text-sm text-text-muted">{t("goals.lede")}</p>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => setAdding((v) => !v)}>
          {adding ? t("common.cancel") : `+ ${t("goals.add")}`}
        </button>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      {adding && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap gap-2">
            <input
              className="input min-w-[16rem] flex-1"
              placeholder={t("goals.titlePlaceholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className="input max-w-[11rem]"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-text-subtle">
              {t("goals.pickSkills")}
            </p>
            <div className="flex flex-wrap gap-2">
              {skills.slice(0, 24).map((s) => {
                const chosen = picked[s.id];
                return (
                  <div key={s.id} className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs">
                    <span>{s.name}</span>
                    <select
                      className="bg-transparent text-xs outline-none"
                      value={chosen ?? ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        setPicked((p) => {
                          const next = { ...p };
                          if (!value) delete next[s.id];
                          else next[s.id] = Number(value);
                          return next;
                        });
                      }}
                    >
                      <option value="">—</option>
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
          <button
            className="btn btn-sm"
            disabled={busy || !title.trim() || !Object.keys(picked).length}
            onClick={create}
          >
            {busy ? t("common.saving") : t("goals.save")}
          </button>
        </div>
      )}

      {goals.length === 0 && !adding && (
        <p className="text-sm text-text-subtle">{t("goals.empty")}</p>
      )}

      {goals.map((g) => (
        <div key={g.id} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 font-medium">{g.title}</span>
            {g.created_by && (
              <span className="badge bg-edge text-text-subtle">
                {t("goals.proposedBy", { who: g.created_by })}
              </span>
            )}
            {g.status !== "active" && (
              <span className="badge bg-edge text-text-subtle">{t(`goals.${g.status}`)}</span>
            )}
            {g.due_date && (
              <span className={`text-xs ${g.overdue ? "text-bad" : "text-text-subtle"}`}>
                {t("track.due")} {g.due_date}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full ${g.percent === 100 ? "bg-good" : "bg-accent"}`}
                style={{ width: `${Math.max(2, g.percent)}%` }}
              />
            </div>
            <span className="text-xs tnum text-text-subtle">
              {g.reached}/{g.total}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {g.targets.map((s) => (
              <span
                key={s.skill_id}
                className={`badge ${s.reached ? "bg-good/15 text-good" : "bg-edge text-text-subtle"}`}
              >
                {s.name} {s.current}/{s.target}
              </span>
            ))}
          </div>

          {g.recommended.length > 0 && g.status === "active" && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-text-subtle">
              <span>{t("goals.nextStep")}</span>
              {g.recommended.map((r) => (
                <Link key={`${r.kind}-${r.id}`} href={r.link} className="text-accent-text hover:underline">
                  {r.title}
                </Link>
              ))}
            </p>
          )}

          {g.status === "active" && (
            <div className="flex gap-2">
              <button className="btn-ghost btn-sm" onClick={() => close(g, "achieved")}>
                ✓ {t("goals.achieved")}
              </button>
              <button className="btn-ghost btn-sm text-text-subtle" onClick={() => close(g, "dropped")}>
                {t("goals.drop")}
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
