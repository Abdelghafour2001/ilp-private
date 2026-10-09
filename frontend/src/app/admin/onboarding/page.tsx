"use client";

/**
 * L&D console for the first-connection wizard.
 *
 * Editing here changes the very first screen a new colleague sees, so two
 * things are deliberate. Nothing is ever deleted — a retired choice is hidden,
 * because past learners still carry its key on their profile and analytics
 * group on it. And the key is editable only while a row is new: renaming one
 * afterwards silently detaches every answer that referenced it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AccessDenied, { isForbidden } from "@/components/AccessDenied";
import Icon from "@/components/Icon";
import {
  api,
  type OnboardingGoalIn,
  type OnboardingRoleIn,
} from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useI18n } from "@/lib/i18n";

type Skill = { id: number; name: string; category: string };

/** New rows carry no server id yet; `isNew` unlocks the key/minutes field. */
type RoleRow = OnboardingRoleIn & { isNew?: boolean };
type GoalRow = OnboardingGoalIn & { isNew?: boolean };

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export default function OnboardingAdminPage() {
  const { t, locale } = useI18n();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    const me = getStoredLearner();
    api
      .onboardingConfig(me?.id)
      .then((cfg) => {
        setRoles(cfg.roles.map(({ id: _id, sort_order: _o, ...rest }) => rest));
        setGoals(cfg.goals.map(({ id: _id, sort_order: _o, ...rest }) => rest));
        setSkills(cfg.skills);
        setError(null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(load, [load]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, Skill[]>();
    for (const skill of skills) {
      const list = groups.get(skill.category) ?? [];
      list.push(skill);
      groups.set(skill.category, list);
    }
    return [...groups.entries()];
  }, [skills]);

  function patchRole(index: number, patch: Partial<RoleRow>) {
    setRoles((cur) => cur.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function patchGoal(index: number, patch: Partial<GoalRow>) {
    setGoals((cur) => cur.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function toggleSkill(index: number, skillId: number) {
    setRoles((cur) =>
      cur.map((r, i) =>
        i === index
          ? {
              ...r,
              skill_ids: r.skill_ids.includes(skillId)
                ? r.skill_ids.filter((s) => s !== skillId)
                : [...r.skill_ids, skillId],
            }
          : r,
      ),
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const me = getStoredLearner();
      // Strip the client-only `isNew` marker — the server matches on the key.
      const payload = {
        roles: roles.map(({ isNew: _n, ...rest }) => ({ ...rest, key: slug(rest.key) })),
        goals: goals.map(({ isNew: _n, ...rest }) => rest),
      };
      const next = await api.saveOnboardingConfig(payload, me?.id);
      setRoles(next.roles.map(({ id: _id, sort_order: _o, ...rest }) => rest));
      setGoals(next.goals.map(({ id: _id, sort_order: _o, ...rest }) => rest));
      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (error && isForbidden(error))
    return <AccessDenied audience="L&D" backHref="/admin/governance" />;

  const label = (row: { label_fr: string; label_en: string }) =>
    locale === "fr" ? row.label_fr || row.label_en : row.label_en || row.label_fr;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("onbAdmin.title")}</h1>
        <p className="text-sm text-text-muted">{t("onbAdmin.lede")}</p>
      </header>

      {error && <p className="card text-sm text-bad">{error}</p>}

      {/* step 1 — profile choices */}
      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">{t("onbAdmin.roles")}</h2>
          <p className="text-sm text-text-muted">{t("onbAdmin.rolesHint")}</p>
        </div>

        <div className="space-y-4">
          {roles.map((role, index) => (
            <div
              key={role.key || `new-${index}`}
              className={`space-y-3 rounded-xl border p-4 ${
                role.active ? "border-border" : "border-dashed border-border-strong opacity-70"
              }`}
            >
              <div className="grid gap-3 sm:grid-cols-[5rem_1fr_1fr_10rem]">
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-text-subtle">
                    {t("onbAdmin.emoji")}
                  </span>
                  <input
                    className="input text-center"
                    maxLength={4}
                    value={role.emoji}
                    onChange={(e) => patchRole(index, { emoji: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-text-subtle">
                    {t("onbAdmin.labelFr")}
                  </span>
                  <input
                    className="input"
                    value={role.label_fr}
                    onChange={(e) => patchRole(index, { label_fr: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-text-subtle">
                    {t("onbAdmin.labelEn")}
                  </span>
                  <input
                    className="input"
                    value={role.label_en}
                    onChange={(e) => patchRole(index, { label_en: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-text-subtle">
                    {t("onbAdmin.key")}
                  </span>
                  <input
                    className="input font-mono text-xs disabled:opacity-60"
                    value={role.key}
                    disabled={!role.isNew}
                    title={t("onbAdmin.keyHint")}
                    onChange={(e) => patchRole(index, { key: e.target.value })}
                  />
                </label>
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-text-subtle">
                  {t("onbAdmin.skills")}
                </p>
                {byCategory.map(([category, list]) => (
                  <div key={category} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-full text-[11px] font-semibold uppercase tracking-wide text-text-subtle sm:w-auto sm:pr-2">
                      {category}
                    </span>
                    {list.map((skill) => {
                      const on = role.skill_ids.includes(skill.id);
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => toggleSkill(index, skill.id)}
                          className={`rounded-full border px-3 py-1 text-sm transition ${
                            on
                              ? "border-accent bg-accent/15 font-medium text-accent-text"
                              : "border-border text-text-subtle hover:text-text"
                          }`}
                        >
                          {on ? "✓ " : ""}
                          {skill.name}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {role.skill_ids.length === 0 && (
                  <p className="text-xs text-text-subtle">{t("onbAdmin.noSkillsPicked")}</p>
                )}
              </div>

              <div className="flex items-center justify-between">
                {role.active ? (
                  <span />
                ) : (
                  <span className="text-xs text-text-subtle">{t("onbAdmin.hidden")}</span>
                )}
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => patchRole(index, { active: !role.active })}
                >
                  {role.active ? t("onbAdmin.remove") : t("onbAdmin.restore")}
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="btn-ghost btn-sm inline-flex w-fit items-center gap-1.5"
          onClick={() =>
            setRoles((cur) => [
              ...cur,
              {
                key: `${t("onbAdmin.newRoleKey")}-${cur.length + 1}`,
                label_fr: "",
                label_en: "",
                emoji: "✨",
                skill_ids: [],
                active: true,
                isNew: true,
              },
            ])
          }
        >
          <Icon name="plus" size={16} /> {t("onbAdmin.addRole")}
        </button>
      </section>

      {/* step 3 — weekly goals */}
      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">{t("onbAdmin.goals")}</h2>
          <p className="text-sm text-text-muted">{t("onbAdmin.goalsHint")}</p>
        </div>

        <div className="space-y-3">
          {goals.map((goal, index) => (
            <div
              key={goal.minutes || `new-${index}`}
              className={`grid gap-3 rounded-xl border p-3 sm:grid-cols-[7rem_1fr_1fr_auto] ${
                goal.active ? "border-border" : "border-dashed border-border-strong opacity-70"
              }`}
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-text-subtle">
                  {t("onbAdmin.minutes")}
                </span>
                <input
                  className="input tnum disabled:opacity-60"
                  type="number"
                  min={5}
                  max={1440}
                  value={goal.minutes}
                  disabled={!goal.isNew}
                  onChange={(e) => patchGoal(index, { minutes: Number(e.target.value) })}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-text-subtle">
                  {t("onbAdmin.labelFr")}
                </span>
                <input
                  className="input"
                  value={goal.label_fr}
                  onChange={(e) => patchGoal(index, { label_fr: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-text-subtle">
                  {t("onbAdmin.labelEn")}
                </span>
                <input
                  className="input"
                  value={goal.label_en}
                  onChange={(e) => patchGoal(index, { label_en: e.target.value })}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => patchGoal(index, { active: !goal.active })}
                >
                  {goal.active ? t("onbAdmin.remove") : t("onbAdmin.restore")}
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="btn-ghost btn-sm inline-flex w-fit items-center gap-1.5"
          onClick={() =>
            setGoals((cur) => [
              ...cur,
              {
                minutes: Math.max(5, ...cur.map((g) => g.minutes)) + 15,
                label_fr: "",
                label_en: "",
                active: true,
                isNew: true,
              },
            ])
          }
        >
          <Icon name="plus" size={16} /> {t("onbAdmin.addGoal")}
        </button>
      </section>

      {/* preview — the same thing the newcomer will read */}
      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">{t("onbAdmin.preview")}</h2>
          <p className="text-sm text-text-muted">
            {t("onbAdmin.previewHint", { lang: locale === "fr" ? "français" : "English" })}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {roles
            .filter((r) => r.active)
            .map((r) => (
              <div
                key={r.key}
                className="flex items-center gap-3 rounded-xl border border-border p-4"
              >
                <span className="text-3xl">{r.emoji}</span>
                <span className="font-medium">{label(r) || r.key}</span>
              </div>
            ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={busy} onClick={save}>
          {busy ? t("onbAdmin.saving") : t("onbAdmin.save")}
        </button>
        {saved && <span className="text-sm text-good">{t("onbAdmin.saved")}</span>}
        <Link href="/admin/governance" className="btn-ghost btn-sm">
          ← {t("nav.governance", "Governance")}
        </Link>
      </div>
    </div>
  );
}
