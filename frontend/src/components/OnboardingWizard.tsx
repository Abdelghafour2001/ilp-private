"use client";

/**
 * OnboardingWizard — the first-connection assessment (M-07).
 * Shows automatically for signed-in learners with `onboarded === false`:
 *   1. role focus → 2. skills to develop (preselected by role) → 3. weekly goal
 * then AIDA orients them to matching pathways & trainings.
 *
 * The choices themselves are not in this file: L&D edits them in the console
 * (/admin/onboarding), and they arrive with a label in each language. The
 * chrome around them goes through `t()` like the rest of the app — this is the
 * first screen a new hire ever sees, and it was the last one still hardcoded
 * in French.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type OnboardingGoal, type OnboardingRole } from "@/lib/api";
import { getStoredLearner, storeLearner } from "@/lib/learner";
import { useI18n } from "@/lib/i18n";

type Options = Awaited<ReturnType<typeof api.onboardingOptions>>;
type Result = Awaited<ReturnType<typeof api.completeOnboarding>>;

export default function OnboardingWizard() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Options | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [role, setRole] = useState<string>("");
  const [skillIds, setSkillIds] = useState<number[]>([]);
  const [skillQuery, setSkillQuery] = useState("");
  const [goal, setGoal] = useState(30);
  const [busy, setBusy] = useState(false);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [optsError, setOptsError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  /** The label in the reader's language, falling back to the other one. */
  function label(item: OnboardingRole | OnboardingGoal) {
    return locale === "fr"
      ? item.label_fr || item.label_en
      : item.label_en || item.label_fr;
  }

  useEffect(() => {
    const me = getStoredLearner();
    if (!me) return;
    // Trust a fresh profile over possibly-stale localStorage.
    api
      .learnerProfile(me.id)
      .then((p) => {
        if ((p as { onboarded?: boolean }).onboarded === false) {
          setOpen(true);
          setLoadingOpts(true);
          setOptsError(null);
          api
            .onboardingOptions()
            .then((o) => {
              setOpts(o);
              // Default to whatever L&D put in the middle of their ladder
              // rather than a number this file invents.
              const mid = o.goals[Math.floor(o.goals.length / 2)];
              if (mid) setGoal(mid.minutes);
            })
            .catch(() => setOptsError(t("onboarding.loadError")))
            .finally(() => setLoadingOpts(false));
        }
      })
      .catch(() => {});
    // `t` is stable per locale; re-running this on a language switch would
    // re-open a wizard the learner may have just finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;

  const me = getStoredLearner();
  const roleObj = opts?.roles.find((r) => r.key === role);
  // The catalogue is the whole company's — eighteen domains — so step 2 shows
  // the domains this role actually touches, plus whatever a search turns up.
  // Listing all of it in a modal is how a first impression becomes a wall.
  const all = opts?.skills ?? [];
  const needle = skillQuery.trim().toLowerCase();
  const shown = needle
    ? all.filter((s) => `${s.name} ${s.category}`.toLowerCase().includes(needle))
    : all.filter((s) => skillIds.includes(s.id));
  const categories = [...new Set(shown.map((s) => s.category))];

  function pickRole(key: string) {
    if (!opts || loadingOpts) return;
    setRole(key);
    const preset = opts.roles.find((r) => r.key === key);
    setSkillIds(preset?.skill_ids ?? []);
    setStep(2);
  }

  async function finish() {
    if (!me) return;
    setBusy(true);
    try {
      const r = await api.completeOnboarding({
        learner_id: me.id,
        role_focus: role || "other",
        skill_ids: skillIds,
        goal_min: goal,
      });
      setResult(r);
      storeLearner({ ...me, onboarded: true });
    } finally {
      setBusy(false);
    }
  }

  async function joinPathway(id: number) {
    if (!me) return;
    await api.enrollPathway(id, me.id).catch(() => {});
    setOpen(false);
    router.push("/pathways");
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-xl animate-scale-in">
        {!result ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="eyebrow">{t("onboarding.welcome")}</p>
                <h2 className="text-xl font-semibold">
                  {step === 1 && t("onboarding.step1")}
                  {step === 2 && t("onboarding.step2")}
                  {step === 3 && t("onboarding.step3")}
                </h2>
              </div>
              <span className="badge bg-edge text-text-subtle">{step}/3</span>
            </div>

            {step === 1 && (
              <div className="space-y-3">
                {loadingOpts && (
                  <p className="text-sm text-text-muted">{t("onboarding.loading")}</p>
                )}
                {optsError && (
                  <p className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
                    {optsError}
                  </p>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {(opts?.roles ?? []).map((r) => (
                    <button
                      key={r.key}
                      disabled={loadingOpts || !!optsError}
                      onClick={() => pickRole(r.key)}
                      className="flex items-center gap-3 rounded-xl border border-border p-4 text-left transition hover:border-accent hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="text-3xl">{r.emoji}</span>
                      <span className="font-medium">{label(r)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <p className="text-sm text-text-muted">
                  {t("onboarding.preselected", { emoji: roleObj?.emoji ?? "" })}
                </p>
                <input
                  className="input w-full"
                  placeholder={t("onboarding.searchSkills", "Search another skill or domain…")}
                  value={skillQuery}
                  onChange={(e) => setSkillQuery(e.target.value)}
                />
                {categories.length === 0 ? (
                  <p className="rounded-xl border border-border bg-edge/40 px-3 py-4 text-sm text-text-muted">
                    {needle ? t("onboarding.noSkillMatch", "Nothing matches that.") : t("onboarding.noSkills")}
                  </p>
                ) : (
                  categories.map((cat) => (
                    <div key={cat}>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-subtle">{cat}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {shown
                          .filter((s) => s.category === cat)
                          .map((s) => {
                            const on = skillIds.includes(s.id);
                            return (
                              <button
                                key={s.id}
                                title={s.description}
                                onClick={() =>
                                  setSkillIds((cur) =>
                                    on ? cur.filter((i) => i !== s.id) : [...cur, s.id],
                                  )
                                }
                                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                                  on
                                    ? "border-accent bg-accent/15 font-medium text-accent-text"
                                    : "border-border text-text-subtle hover:text-text"
                                }`}
                              >
                                {on ? "✓ " : ""}{s.name}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  ))
                )}
                <div className="flex justify-between pt-2">
                  <button className="btn-ghost" onClick={() => setStep(1)}>
                    {t("onboarding.back")}
                  </button>
                  <button className="btn" disabled={skillIds.length === 0} onClick={() => setStep(3)}>
                    {t(
                      skillIds.length > 1 ? "onboarding.continueMany" : "onboarding.continueOne",
                      { count: skillIds.length },
                    )}
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {(opts?.goals ?? []).map((g) => (
                    <button
                      key={g.minutes}
                      onClick={() => setGoal(g.minutes)}
                      className={`rounded-xl border p-4 text-left transition ${
                        goal === g.minutes
                          ? "border-accent bg-accent/10 font-medium"
                          : "border-border hover:border-accent/50"
                      }`}
                    >
                      {label(g)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-text-subtle">{t("onboarding.goalHint")}</p>
                <div className="flex justify-between pt-2">
                  <button className="btn-ghost" onClick={() => setStep(2)}>
                    {t("onboarding.back")}
                  </button>
                  <button className="btn" disabled={busy} onClick={finish}>
                    {busy ? t("onboarding.finishing") : t("onboarding.finish")}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-3xl">🤖</span>
              <div className="rounded-2xl rounded-tl-sm border border-accent/30 bg-accent/5 p-3">
                <p className="text-sm leading-relaxed text-text">{result.message}</p>
              </div>
            </div>

            {result.pathways.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                  🧭 {t("onboarding.recommendedPathways")}
                </p>
                {result.pathways.map((pw) => (
                  <div key={pw.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                    <span className="text-2xl">{pw.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{pw.title}</p>
                      <p className="line-clamp-1 text-xs text-text-subtle">{pw.summary}</p>
                    </div>
                    <button className="btn btn-sm shrink-0" onClick={() => joinPathway(pw.id)}>
                      {t("onboarding.join")}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {result.trainings.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                  📚 {t("onboarding.matchingTrainings")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.trainings.map((training) => (
                    <button
                      key={training.id}
                      className="badge bg-edge text-text-muted hover:text-text"
                      onClick={() => { setOpen(false); router.push(`/formations/${training.id}`); }}
                    >
                      {training.emoji} {training.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button className="btn-ghost" onClick={() => { setOpen(false); window.location.reload(); }}>
                {t("onboarding.exploreAlone")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
