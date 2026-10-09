"use client";

/**
 * FormationBuilder — the instructor's studio.
 *
 * Three-zone layout instead of a flat form:
 *   left   — module rail (the training's spine: select, add, reorder)
 *   center — lesson canvas for the selected module (drag to reorder, palette
 *            of lesson types, type-specific editors)
 *   right  — live preview: the selected lesson exactly as a trainee sees it,
 *            plus running totals (lessons, XP, duration)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  type CourseSummary,
  type Formation,
  type FormationLessonType,
  type SkillRow,
  type TrainingFormat,
} from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";
import MarkdownLite from "@/components/MarkdownLite";
import Link from "next/link";
import Icon, { type IconName } from "@/components/Icon";
import Modal from "@/components/Modal";
import CourseCover from "@/components/CourseCover";
import Field, { FormSection, Segmented } from "@/components/form/Field";
import SharedEmojiPicker from "@/components/form/EmojiPicker";
import TagInput, { parseTags } from "@/components/form/TagInput";
import { F_LESSON_META, F_LESSON_TYPES, FORMATS, FORMAT_META, fmtDuration } from "@/lib/formationLessons";

/* ---------------------------------- state --------------------------------- */

interface EQuizQ {
  question: string;
  options: string; // one per line
  answer_index: number;
  explanation: string;
}

interface ELesson {
  id: string;
  title: string;
  type: FormationLessonType;
  body_md: string;
  xp: number;
  duration_min: number;
  video_url: string;
  lab_id: string;
  /** external_course — which catalogue entry this step sends them to. */
  course_id: number | null;
  questions: EQuizQ[];
  scenario: string;
  starter_prompt: string;
  goal_md: string;
  task: string;
  challenge_input: string;
  rubric: string; // one criterion per line
  min_score: number;
  /** "" | pre | post — tags a quiz as the entry or exit evaluation. */
  assessment: string;
}

interface EModule {
  title: string;
  lessons: ELesson[];
}

interface Meta {
  title: string;
  summary: string;
  level: string;
  emoji: string;
  tags: string;
  objectives: string[];
  prerequisites: string;
  format: TrainingFormat;
  /** Declared length in hours, as typed; empty = computed from lessons. */
  duration_hours: string;
  /** type de programme: built in-house, or bought from a provider. */
  source: "internal" | "external";
  provider: string;
  status: string;
  open_enrollment: boolean;
}

const newLesson = (type: FormationLessonType): ELesson => ({
  id: `fl${Math.random().toString(36).slice(2, 8)}`,
  title: "",
  type,
  body_md: "",
  xp: type === "prompt_challenge" ? 40 : type === "prompt_playground" ? 20 : type === "quiz" ? 15 : 10,
  duration_min: type === "prompt_challenge" ? 15 : type === "prompt_playground" ? 10 : 5,
  video_url: "",
  lab_id: "",
  course_id: null,
  questions: type === "quiz" ? [{ question: "", options: "", answer_index: 0, explanation: "" }] : [],
  scenario: "",
  starter_prompt: "",
  goal_md: "",
  task: "",
  challenge_input: "",
  rubric: "",
  min_score: 70,
  assessment: "",
});

function fromFormation(f: Formation): { meta: Meta; modules: EModule[] } {
  return {
    meta: {
      title: f.title,
      summary: f.summary,
      level: f.level,
      emoji: f.emoji,
      tags: f.tags.join(", "),
      objectives: f.objectives,
      prerequisites: f.prerequisites ?? "",
      format: f.format ?? "elearning",
      duration_hours: f.duration_hours != null ? String(f.duration_hours) : "",
      source: f.source ?? "internal",
      provider: f.provider ?? "",
      status: f.status,
      open_enrollment: f.open_enrollment,
    },
    modules: (f.curriculum.modules ?? []).map((m) => ({
      title: m.title,
      lessons: m.lessons.map((l) => ({
        ...newLesson(l.type),
        id: l.id,
        title: l.title,
        type: l.type,
        body_md: l.body_md ?? "",
        xp: l.xp ?? 10,
        duration_min: l.duration_min ?? 5,
        video_url: l.video_url ?? "",
        lab_id: l.lab_id ?? "",
        course_id: l.course_id ?? null,
        questions: (l.questions ?? []).map((q) => ({
          question: q.question,
          options: q.options.join("\n"),
          answer_index: q.answer_index,
          explanation: q.explanation,
        })),
        scenario: l.scenario ?? "",
        starter_prompt: l.starter_prompt ?? "",
        goal_md: l.goal_md ?? "",
        task: l.task ?? "",
        challenge_input: l.challenge_input ?? "",
        rubric: (l.rubric ?? []).join("\n"),
        min_score: l.min_score ?? 70,
        assessment: l.assessment ?? "",
      })),
    })),
  };
}


/* --------------------------------- builder -------------------------------- */

const FORMAT_ICON: Record<TrainingFormat, IconName> = {
  in_person: "org",
  virtual: "sessions",
  hybrid: "route",
  elearning: "play",
};
const LEVEL_DOT: Record<string, string> = { beginner: "bg-good", intermediate: "bg-warn", advanced: "bg-bad" };

export default function FormationBuilder({
  initial,
  back,
  title,
  lede,
}: {
  initial?: Formation;
  back: { href: string; label: string };
  title: string;
  lede?: string;
}) {
  const t = useT();
  const router = useRouter();
  const seed = initial
    ? fromFormation(initial)
    : {
        meta: {
          title: "",
          summary: "",
          level: "beginner",
          emoji: "🎓",
          tags: "",
          objectives: [],
          prerequisites: "",
          format: "elearning" as TrainingFormat,
          duration_hours: "",
          source: "internal" as const,
          provider: "",
          status: "draft",
          open_enrollment: false,
        },
        modules: [{ title: "Module 1", lessons: [newLesson("article")] }] as EModule[],
      };

  const [meta, setMeta] = useState<Meta>(seed.meta);
  const [modules, setModules] = useState<EModule[]>(seed.modules);
  // New trainings start on the "Basics" step; edits jump straight to the studio.
  const [step, setStep] = useState<1 | 2 | 3>(initial ? 2 : 1);
  const [invitees, setInvitees] = useState("");
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [skillIds, setSkillIds] = useState<number[]>(
    initial ? (initial.skills ?? []).map((s) => s.id) : [],
  );

  useEffect(() => {
    api.listSkills().then(setSkills).catch(() => {});
  }, []);
  const [mi, setMi] = useState(0); // selected module
  const [li, setLi] = useState(0); // selected lesson (within module)
  const [palette, setPalette] = useState(false);
  const [objDraft, setObjDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);

  const mod = modules[mi];
  const lesson = mod?.lessons[li];
  const me = getStoredLearner();

  const stats = useMemo(() => {
    const ls = modules.flatMap((m) => m.lessons);
    return {
      lessons: ls.length,
      xp: ls.reduce((s, l) => s + (Number(l.xp) || 0), 0),
      min: ls.reduce((s, l) => s + (Number(l.duration_min) || 0), 0),
      practice: ls.filter((l) => F_LESSON_META[l.type].kind === "practice").length,
    };
  }, [modules]);

  /* ------ mutations ------ */

  function patchLesson(patch: Partial<ELesson>) {
    setModules((cur) =>
      cur.map((m, i) =>
        i === mi
          ? { ...m, lessons: m.lessons.map((l, j) => (j === li ? { ...l, ...patch } : l)) }
          : m,
      ),
    );
  }

  function addLesson(type: FormationLessonType) {
    setModules((cur) =>
      cur.map((m, i) => (i === mi ? { ...m, lessons: [...m.lessons, newLesson(type)] } : m)),
    );
    setLi(mod.lessons.length);
    setPalette(false);
  }

  function removeLesson(j: number) {
    setModules((cur) =>
      cur.map((m, i) => (i === mi ? { ...m, lessons: m.lessons.filter((_, k) => k !== j) } : m)),
    );
    setLi((cur) => Math.max(0, cur >= j ? cur - 1 : cur));
  }

  function moveLesson(from: number, to: number) {
    if (to < 0 || to >= mod.lessons.length || from === to) return;
    setModules((cur) =>
      cur.map((m, i) => {
        if (i !== mi) return m;
        const ls = [...m.lessons];
        const [x] = ls.splice(from, 1);
        ls.splice(to, 0, x);
        return { ...m, lessons: ls };
      }),
    );
    setLi(to);
  }

  function addModule() {
    setModules((cur) => [...cur, { title: `Module ${cur.length + 1}`, lessons: [] }]);
    setMi(modules.length);
    setLi(0);
  }

  function moveModule(from: number, to: number) {
    if (to < 0 || to >= modules.length) return;
    setModules((cur) => {
      const ms = [...cur];
      const [x] = ms.splice(from, 1);
      ms.splice(to, 0, x);
      return ms;
    });
    setMi(to);
  }

  function removeModule(i: number) {
    if (modules.length === 1) return;
    setModules((cur) => cur.filter((_, k) => k !== i));
    setMi((cur) => Math.max(0, cur >= i ? cur - 1 : cur));
    setLi(0);
  }

  /* ------ save ------ */

  function build() {
    return {
      title: meta.title,
      summary: meta.summary,
      level: meta.level,
      emoji: meta.emoji || "🎓",
      tags: meta.tags.split(",").map((t) => t.trim()).filter(Boolean),
      objectives: meta.objectives,
      prerequisites: meta.prerequisites,
      format: meta.format,
      duration_hours: meta.duration_hours.trim() ? Number(meta.duration_hours) : null,
      source: meta.source,
      provider: meta.source === "external" ? meta.provider : "",
      skill_ids: skillIds,
      status: meta.status,
      open_enrollment: meta.open_enrollment,
      curriculum: {
        modules: modules.map((m) => ({
          title: m.title,
          lessons: m.lessons.map((l) => ({
            id: l.id,
            title: l.title,
            type: l.type,
            body_md: l.body_md,
            xp: Number(l.xp) || 10,
            duration_min: Number(l.duration_min) || 5,
            video_url: l.video_url || null,
            lab_id: l.lab_id || null,
            course_id: l.course_id,
            questions: l.questions.map((q) => ({
              question: q.question,
              options: q.options.split("\n").map((o) => o.trim()).filter(Boolean),
              answer_index: Number(q.answer_index) || 0,
              explanation: q.explanation,
            })),
            scenario: l.scenario || null,
            starter_prompt: l.starter_prompt || null,
            goal_md: l.goal_md || null,
            task: l.task || null,
            challenge_input: l.challenge_input || null,
            rubric: l.rubric.split("\n").map((r) => r.trim()).filter(Boolean),
            min_score: Number(l.min_score) || 70,
          })),
        })),
      },
    };
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (!me) throw new Error("Pick a handle first (top-right) — formations need a trainer identity.");
      const body = { ...build(), learner_id: me.id };
      const f = initial
        ? await api.updateFormation(initial.id, body, me.id)
        : await api.createFormation(body);
      const handles = invitees.split(/[\s,;]+/).filter(Boolean);
      if (handles.length) {
        await api.inviteTrainees(f.id, handles, me.id).catch(() => {});
      }
      router.push(`/formations/${f.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-8">
      <header>
        <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-text-subtle hover:text-text">
          <Icon name="arrow-right" size={14} className="rotate-180" /> {back.label}
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em]">{title}</h1>
            {lede && <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-text-muted">{lede}</p>}
          </div>
          <ol className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1" aria-label={t("cb.steps")}>
            {([
              { n: 1 as const, label: t("fb.step.basics") },
              { n: 2 as const, label: t("fb.step.curriculum") },
              { n: 3 as const, label: t("fb.step.people") },
            ]).map(({ n, label }) => {
              const on = step === n;
              return (
                <li key={n}>
                  <button
                    type="button"
                    disabled={n !== 1 && !meta.title.trim()}
                    aria-current={on ? "step" : undefined}
                    onClick={() => setStep(n)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                      on ? "bg-accent/10 font-medium text-accent-text" : "text-text-muted hover:text-text"
                    }`}
                  >
                    <span
                      className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold ${
                        step > n ? "bg-good text-white" : on ? "bg-accent text-accent-fg" : "bg-surface-3"
                      }`}
                    >
                      {step > n ? <Icon name="check" size={11} strokeWidth={3} /> : n}
                    </span>
                    {label}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </header>

      {/* ---- step 1: basics ---- */}
      {step === 1 && (
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          <div className="panel p-6 sm:p-7">
            <FormSection step={1} title={t("fb.s.card")} lede={t("fb.s.cardLede")}>
              <Field id="fb-title" label={t("cb.f.title")} count={meta.title.length} max={70}>
                <div className="flex gap-2">
                  <SharedEmojiPicker id="fb-emoji" value={meta.emoji} onChange={(emoji) => setMeta({ ...meta, emoji })} />
                  <input
                    id="fb-title"
                    name="title"
                    className="input py-2.5 text-base font-medium"
                    autoComplete="off"
                    autoFocus={!initial}
                    placeholder={t("fb.titlePh")}
                    value={meta.title}
                    onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                  />
                </div>
              </Field>
              <Field id="fb-summary" label={t("fb.f.pitch")} hint={t("fb.f.pitchHint")} count={meta.summary.length} max={140}>
                <input id="fb-summary" name="summary" className="input" autoComplete="off" placeholder={t("fb.pitchPh")} value={meta.summary} onChange={(e) => setMeta({ ...meta, summary: e.target.value })} />
              </Field>
              <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
                <div>
                  <p className="mb-1.5 text-sm font-medium">{t("cb.f.level")}</p>
                  <Segmented
                    label={t("cb.f.level")}
                    value={meta.level as "beginner"}
                    onChange={(level) => setMeta({ ...meta, level })}
                    options={(["beginner", "intermediate", "advanced"] as const).map((l) => ({
                      value: l as "beginner",
                      label: (
                        <span className="inline-flex items-center gap-1.5 capitalize">
                          <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[l]}`} />
                          {t(`common.${l}`, l)}
                        </span>
                      ),
                    }))}
                  />
                </div>
                <Field id="fb-tags" label={t("cb.f.tags")} optional>
                  <TagInput id="fb-tags" value={parseTags(meta.tags)} onChange={(tags) => setMeta({ ...meta, tags: tags.join(", ") })} />
                </Field>
              </div>
            </FormSection>

            <FormSection step={2} title={t("fb.s.delivery")} lede={t("fb.s.deliveryLede")}>
              <div>
                <p className="mb-1.5 text-sm font-medium">{t("fb.f.format")}</p>
                <div role="radiogroup" aria-label={t("fb.f.format")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {FORMATS.map((f) => {
                    const on = meta.format === f;
                    return (
                      <button
                        key={f}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setMeta({ ...meta, format: f })}
                        className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-[border-color,background-color] ${
                          on ? "border-accent bg-accent/5 ring-1 ring-accent/30" : "border-border hover:border-border-strong"
                        }`}
                      >
                        <span className={`grid h-8 w-8 place-items-center rounded-lg ${on ? "bg-accent text-accent-fg" : "bg-surface-2 text-text-muted"}`}>
                          <Icon name={FORMAT_ICON[f]} size={15} />
                        </span>
                        <span>
                          <span className="block text-sm font-medium">{t(`fb.format.${f}`, FORMAT_META[f].label)}</span>
                          <span className="block text-[11px] leading-snug text-text-subtle">{t(`fb.format.${f}.desc`, FORMAT_META[f].desc)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-sm font-medium">{t("builder.programType")}</p>
                  <Segmented
                    label={t("builder.programType")}
                    value={meta.source}
                    onChange={(source) => setMeta({ ...meta, source })}
                    options={[
                      { value: "internal" as const, label: t("builder.internal") },
                      { value: "external" as const, label: t("builder.external") },
                    ]}
                  />
                  <p className="mt-1.5 text-xs text-text-subtle">
                    {meta.source === "internal" ? t("builder.internalHint") : t("builder.externalHint")}
                  </p>
                  {meta.source === "external" && (
                    <input
                      className="input mt-2"
                      aria-label={t("builder.providerPlaceholder")}
                      placeholder={t("builder.providerPlaceholder")}
                      value={meta.provider}
                      onChange={(e) => setMeta({ ...meta, provider: e.target.value })}
                    />
                  )}
                </div>
                <Field id="fb-hours" label={t("builder.durationHours")} optional hint={t("builder.durationHint")}>
                  <div className="relative">
                    <input
                      id="fb-hours"
                      className="input pr-10"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.5}
                      placeholder={t("builder.durationPlaceholder")}
                      value={meta.duration_hours}
                      onChange={(e) => setMeta({ ...meta, duration_hours: e.target.value })}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-subtle">h</span>
                  </div>
                </Field>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 transition-colors hover:border-border-strong">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
                  checked={meta.open_enrollment}
                  onChange={(e) => setMeta({ ...meta, open_enrollment: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-medium">{t("fb.f.open")}</span>
                  <span className="block text-xs text-text-subtle">{t("fb.f.openHint")}</span>
                </span>
              </label>
            </FormSection>

            <FormSection step={3} title={t("fb.s.outcomes")} lede={t("fb.s.outcomesLede")}>
              <Field id="fb-obj" label={t("fb.f.objectives")} optional hint={t("fb.f.objectivesHint")}>
                <div className="space-y-2">
                  {meta.objectives.length > 0 && (
                    <ol className="space-y-1.5">
                      {meta.objectives.map((o, i) => (
                        <li key={i} className="flex items-start gap-2.5 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                          <Icon name="target" size={14} className="mt-0.5 shrink-0 text-accent-text" />
                          <span className="flex-1">{o}</span>
                          <button
                            type="button"
                            aria-label={t("fb.f.removeObjective")}
                            className="text-text-subtle hover:text-bad"
                            onClick={() => setMeta({ ...meta, objectives: meta.objectives.filter((_, k) => k !== i) })}
                          >
                            <Icon name="x" size={13} />
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                  <input
                    id="fb-obj"
                    className="input"
                    autoComplete="off"
                    placeholder={t("fb.f.objectivePh")}
                    value={objDraft}
                    onChange={(e) => setObjDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && objDraft.trim()) {
                        e.preventDefault();
                        setMeta({ ...meta, objectives: [...meta.objectives, objDraft.trim()] });
                        setObjDraft("");
                      }
                    }}
                  />
                </div>
              </Field>
              <Field id="fb-skills" label={t("fb.f.skills")} optional>
                {skills.length === 0 ? (
                  <p id="fb-skills" className="text-xs text-text-subtle">{t("fb.f.noSkills")}</p>
                ) : (
                  <div id="fb-skills" className="flex flex-wrap gap-1.5">
                    {skills.map((sk) => {
                      const on = skillIds.includes(sk.id);
                      return (
                        <button
                          key={sk.id}
                          type="button"
                          title={sk.description}
                          aria-pressed={on}
                          onClick={() => setSkillIds((cur) => (on ? cur.filter((i) => i !== sk.id) : [...cur, sk.id]))}
                          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors ${
                            on ? "border-accent bg-accent/10 font-medium text-accent-text" : "border-border text-text-muted hover:border-border-strong hover:text-text"
                          }`}
                        >
                          {on && <Icon name="check" size={11} strokeWidth={2.5} />}
                          {sk.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>
              <Field id="fb-prereq" label={t("fb.f.prereq")} optional>
                <textarea
                  id="fb-prereq"
                  rows={3}
                  className="input resize-y text-sm"
                  placeholder={t("fb.f.prereqPh")}
                  value={meta.prerequisites}
                  onChange={(e) => setMeta({ ...meta, prerequisites: e.target.value })}
                />
              </Field>
            </FormSection>
          </div>

          <div className="sticky bottom-0 z-10 -mx-1 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg/90 px-4 py-3 backdrop-blur-md">
            <p className="flex items-center gap-2 text-sm text-text-muted" aria-live="polite">
              {meta.title.trim() ? (
                <>
                  <Icon name="check" size={15} className="text-good" /> {t("fb.nextCurriculum")}
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" /> {t("fb.need.title")}
                </>
              )}
            </p>
            <button type="button" className="btn" disabled={!meta.title.trim()} onClick={() => setStep(2)}>
              {t("fb.toCurriculum")} <Icon name="arrow-right" size={15} />
            </button>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <p className="flex items-center gap-1.5 text-xs font-medium text-text-subtle">
            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" /> {t("create.preview")}
          </p>
          <article aria-hidden="true" className="pointer-events-none select-none">
            <div className="overflow-hidden rounded-xl border border-border shadow-sm">
              <CourseCover emoji={meta.emoji || "🎓"} className="aspect-[16/9] rounded-none" />
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-text-subtle">
              <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[meta.level]}`} />
              <span className="capitalize">{t(`common.${meta.level}`, meta.level)}</span>
              <span>·</span>
              <span>{t(`fb.format.${meta.format}`, FORMAT_META[meta.format].label)}</span>
              {meta.duration_hours && (
                <>
                  <span>·</span>
                  <span className="tnum">{meta.duration_hours}&nbsp;h</span>
                </>
              )}
            </p>
            <h3 className={`mt-1 font-semibold leading-snug ${meta.title ? "text-text" : "text-text-subtle"}`}>{meta.title || t("fb.titlePh")}</h3>
            <p className="mt-1 line-clamp-2 text-sm text-text-muted">{meta.summary || t("fb.pitchPh")}</p>
            {meta.objectives.length > 0 && (
              <ul className="mt-3 space-y-1">
                {meta.objectives.slice(0, 3).map((o, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-text-muted">
                    <Icon name="check" size={12} className="mt-0.5 shrink-0 text-good" /> <span className="line-clamp-1">{o}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-text-subtle">
              {meta.open_enrollment ? t("fb.preview.open") : t("fb.preview.invite")}
            </p>
          </article>
        </aside>
      </div>
      )}

      {/* ---- steps 2-3: recap of basics ---- */}
      {step >= 2 && (
      <>
      {/* compact recap of step 1 */}
      <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface-2 text-xl" aria-hidden="true">{meta.emoji || "🎓"}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{meta.title || t("cb.untitled")}</p>
          <p className="truncate text-xs text-text-subtle">
            {t(`common.${meta.level}`, meta.level).replace(/^./, (c) => c.toUpperCase())}
            {meta.summary && ` · ${meta.summary}`}
          </p>
        </div>
        <Segmented
          label={t("fb.visibility")}
          value={meta.status as "draft"}
          onChange={(status) => setMeta({ ...meta, status })}
          options={[
            { value: "draft" as const, label: t("fb.draft") },
            { value: "published" as "draft", label: t("fb.published") },
          ]}
        />
        <button type="button" className="btn-ghost btn-sm" onClick={() => setStep(1)}>
          <Icon name="pencil" size={13} /> {t("fb.editBasics")}
        </button>
      </div>
      </>
      )}

      {step === 2 && (
      <>
      {/* ---- studio: rail / canvas / preview ---- */}
      <div className="grid gap-4 xl:grid-cols-[230px_1fr_380px] lg:grid-cols-[230px_1fr]">
        {/* module rail */}
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t("fb.modules")}</p>
          {modules.map((m, i) => (
            <div
              key={i}
              onClick={() => {
                setMi(i);
                setLi(0);
              }}
              className={`group cursor-pointer rounded-xl border p-3 transition ${
                i === mi ? "border-accent bg-accent/10" : "border-border hover:bg-surface-2"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-text-subtle">
                  Module {i + 1}
                </span>
                <span className="hidden gap-0.5 group-hover:flex">
                  <button type="button" aria-label={t("cb.moveUp")} className="btn-icon h-6 w-6" onClick={(e) => { e.stopPropagation(); moveModule(i, i - 1); }}><Icon name="chevron-down" size={12} className="rotate-180" /></button>
                  <button type="button" aria-label={t("cb.moveDown")} className="btn-icon h-6 w-6" onClick={(e) => { e.stopPropagation(); moveModule(i, i + 1); }}><Icon name="chevron-down" size={12} /></button>
                  <button type="button" aria-label={t("fb.removeModule")} className="btn-icon h-6 w-6 hover:text-bad" onClick={(e) => { e.stopPropagation(); removeModule(i); }}><Icon name="trash" size={12} /></button>
                </span>
              </div>
              {i === mi ? (
                <input
                  className="mt-1 w-full bg-transparent text-sm font-medium outline-none"
                  value={m.title}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setModules((cur) => cur.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))
                  }
                />
              ) : (
                <p className="mt-1 truncate text-sm font-medium">{m.title}</p>
              )}
              {/* lesson dots */}
              <div className="mt-2 flex flex-wrap gap-1">
                {m.lessons.map((l, j) => (
                  <span
                    key={l.id}
                    title={l.title || F_LESSON_META[l.type].label}
                    className={`grid h-6 w-6 place-items-center rounded-md text-xs ${
                      i === mi && j === li ? "bg-accent/25" : "bg-surface-2"
                    }`}
                  >
                    {F_LESSON_META[l.type].icon}
                  </span>
                ))}
                {m.lessons.length === 0 && (
                  <span className="text-[10px] text-text-subtle">empty</span>
                )}
              </div>
            </div>
          ))}
          <button type="button" className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border-strong py-2.5 text-sm font-medium text-text-muted transition-colors hover:border-accent hover:text-accent-text" onClick={addModule}>
            <Icon name="plus" size={14} /> {t("fb.addModule")}
          </button>
        </div>

        {/* lesson canvas */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">
              {t("fb.lessonsIn", { module: mod?.title ?? "" })}
            </p>
            <button type="button" className="btn-soft btn-sm" onClick={() => setPalette(true)}>
              <Icon name="plus" size={14} /> {t("fb.addLesson")}
            </button>
          </div>

          {mod?.lessons.length === 0 && (
            <button
              onClick={() => setPalette(true)}
              className="w-full rounded-xl border-2 border-dashed border-border p-8 text-sm text-text-subtle transition hover:border-accent hover:text-text"
            >
              {t("fb.emptyModule")}
            </button>
          )}

          {mod?.lessons.map((l, j) => {
            const m = F_LESSON_META[l.type];
            const selected = j === li;
            return (
              <div
                key={l.id}
                draggable
                onDragStart={() => (dragFrom.current = j)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom.current !== null) moveLesson(dragFrom.current, j);
                  dragFrom.current = null;
                }}
                onClick={() => setLi(j)}
                className={`cursor-pointer rounded-xl border transition ${
                  selected ? "border-accent" : "border-border hover:bg-surface-2"
                }`}
              >
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  <span className="cursor-grab text-text-subtle" title="Drag to reorder">⠿</span>
                  <span className="text-lg">{m.icon}</span>
                  <input
                    className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-text-subtle"
                    placeholder={`${m.label} title…`}
                    value={l.title}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setLi(j)}
                    onChange={(e) => {
                      setLi(j);
                      setModules((cur) =>
                        cur.map((x, k) =>
                          k === mi
                            ? { ...x, lessons: x.lessons.map((y, z) => (z === j ? { ...y, title: e.target.value } : y)) }
                            : x,
                        ),
                      );
                    }}
                  />
                  <span className="badge bg-edge text-text-subtle">{m.label}</span>
                  <span className="hidden items-center gap-0.5 sm:flex">
                    <button type="button" aria-label={t("cb.moveUp")} className="btn-icon h-7 w-7" onClick={(e) => { e.stopPropagation(); moveLesson(j, j - 1); }}><Icon name="chevron-down" size={13} className="rotate-180" /></button>
                    <button type="button" aria-label={t("cb.moveDown")} className="btn-icon h-7 w-7" onClick={(e) => { e.stopPropagation(); moveLesson(j, j + 1); }}><Icon name="chevron-down" size={13} /></button>
                    <button type="button" aria-label={t("cb.removeLesson")} className="btn-icon h-7 w-7 hover:text-bad" onClick={(e) => { e.stopPropagation(); removeLesson(j); }}><Icon name="trash" size={13} /></button>
                  </span>
                </div>

                {selected && lesson && (
                  <div className="space-y-3 border-t border-border p-3" onClick={(e) => e.stopPropagation()}>
                    <LessonEditor lesson={lesson} patch={patchLesson} />
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-text-subtle">
                        XP
                        <input
                          type="number"
                          className="input ml-1.5 inline-block w-20"
                          value={lesson.xp}
                          onChange={(e) => patchLesson({ xp: Number(e.target.value) })}
                        />
                      </label>
                      <label className="text-xs text-text-subtle">
                        {t("fb.minutes")}
                        <input
                          type="number"
                          className="input ml-1.5 inline-block w-20"
                          value={lesson.duration_min}
                          onChange={(e) => patchLesson({ duration_min: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* live preview */}
        <div className="hidden space-y-3 xl:block">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" /> {t("fb.traineePreview")}
          </p>
          <div className="card sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto">
            {lesson ? <LessonPreview lesson={lesson} /> : <p className="text-sm text-text-subtle">Select a lesson.</p>}
          </div>
          <div className="card flex items-center justify-between text-center text-xs text-text-subtle">
            <Stat label="modules" value={modules.length} />
            <Stat label="lessons" value={stats.lessons} />
            <Stat label="hands-on" value={stats.practice} />
            <Stat label="XP" value={stats.xp} />
            <Stat label="length" value={fmtDuration(stats.min)} />
          </div>
        </div>
      </div>

      {/* ---- palette ---- */}
      {palette && (
        <Modal
          title={t("fb.palette.title", { module: mod?.title ?? "" })}
          lede={t("fb.palette.lede")}
          size="md"
          onClose={() => setPalette(false)}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {F_LESSON_TYPES.map((ty) => {
              const m = F_LESSON_META[ty];
              return (
                <button
                  key={ty}
                  type="button"
                  onClick={() => addLesson(ty)}
                  className="group flex items-start gap-3 rounded-xl border border-border p-3 text-left transition-[border-color,background-color] hover:border-accent hover:bg-accent/5"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-xl transition-transform group-hover:scale-110" aria-hidden="true">{m.icon}</span>
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {m.label}
                      {m.kind === "practice" && <span className="badge badge-accent">{t("fb.handsOn")}</span>}
                    </span>
                    <span className="block text-xs leading-relaxed text-text-subtle">{m.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      </>
      )}

      {/* ---- step 3: who takes it ---- */}
      {step === 3 && (
        <div className="panel p-6 sm:p-7">
          <FormSection title={t("fb.s.people")} lede={t("fb.s.peopleLede")}>
            <Field id="fb-invite" label={t("fb.f.invite")} optional hint={t("fb.f.inviteHint")}>
              <TagInput
                id="fb-invite"
                value={invitees.split(/[\s,;]+/).filter(Boolean)}
                onChange={(list) => setInvitees(list.join(", "))}
                placeholder={t("fb.f.invitePh")}
                max={200}
              />
            </Field>
            {invitees.trim() && (
              <p className="flex items-center gap-2 text-sm text-text-muted">
                <Icon name="mail" size={15} className="text-accent-text" />
                {t("fb.f.inviteCount", { n: invitees.split(/[\s,;]+/).filter(Boolean).length })}
              </p>
            )}
            {meta.open_enrollment && (
              <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-text-muted">
                <Icon name="team" size={14} className="mt-px shrink-0 text-text-subtle" />
                {t("fb.f.openNote")}
              </p>
            )}
          </FormSection>
        </div>
      )}

      {step >= 2 && (
      <>
      {/* ---- save bar ---- */}
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg/90 px-4 py-3 backdrop-blur-md">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-subtle tnum">
          <span>{t("fb.stat.lessons", { n: stats.lessons })}</span>
          <span>{t("fb.stat.handsOn", { n: stats.practice })}</span>
          <span className="inline-flex items-center gap-0.5">
            <Icon name="bolt" size={11} className="text-iris" /> {stats.xp}&nbsp;XP
          </span>
          <span className="inline-flex items-center gap-0.5">
            <Icon name="clock" size={11} /> {fmtDuration(stats.min)}
          </span>
          {meta.status === "draft" && <span className="text-warn">{t("fb.draftNote")}</span>}
        </p>
        <div className="flex items-center gap-2">
          {step === 2 && (
            <button type="button" className="btn-ghost" onClick={() => setStep(3)}>
              {t("fb.step.people")} <Icon name="arrow-right" size={15} />
            </button>
          )}
          {step === 3 && (
            <button type="button" className="btn-ghost" onClick={() => setStep(2)}>
              <Icon name="arrow-right" size={15} className="rotate-180" /> {t("fb.step.curriculum")}
            </button>
          )}
          <button type="button" className="btn" onClick={save} disabled={busy || !meta.title.trim()} aria-busy={busy}>
            {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
            {busy
              ? t("common.saving", "Saving…")
              : initial
                ? t("cb.saveChanges")
                : meta.status === "published"
                  ? t("fb.publish")
                  : t("cb.saveDraft")}
          </button>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

/* ------------------------------ sub-components ----------------------------- */

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <span>
      <span className="block text-sm font-semibold text-text">{value}</span>
      {label}
    </span>
  );
}

/** Pick the provider course this step is. The catalogue is 800-odd entries, so
 *  it is a search box rather than a dropdown, and the chosen one stays visible
 *  afterwards — an id alone tells the author nothing. */
function ProviderCoursePicker({
  lesson,
  patch,
}: {
  lesson: ELesson;
  patch: (p: Partial<ELesson>) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CourseSummary[]>([]);
  const [chosen, setChosen] = useState<CourseSummary | null>(null);

  useEffect(() => {
    if (!lesson.course_id || chosen?.id === lesson.course_id) return;
    api.getCourse(lesson.course_id).then((c) => setChosen(c as unknown as CourseSummary)).catch(() => setChosen(null));
  }, [lesson.course_id, chosen]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) return setHits([]);
    const timer = setTimeout(() => {
      api.listCourses(term).then((rows) => setHits(rows.filter((c) => c.external_url).slice(0, 8)));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  function choose(course: CourseSummary) {
    setChosen(course);
    setHits([]);
    setQ("");
    patch({ course_id: course.id, title: lesson.title || course.title });
  }

  return (
    <div className="space-y-2">
      {chosen && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/[0.06] px-3 py-2 text-sm">
          <span>{chosen.emoji} </span>
          <span className="font-medium">{chosen.title}</span>
          <span className="text-xs text-text-subtle">{chosen.provider}</span>
          <button
            className="ml-auto text-xs text-text-subtle hover:text-bad"
            onClick={() => {
              setChosen(null);
              patch({ course_id: null });
            }}
          >
            ✕
          </button>
        </div>
      )}
      <input
        className="input"
        placeholder="Search the provider catalogue (3 letters or more)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {hits.length > 0 && (
        <ul className="divide-y divide-edge rounded-lg border border-border">
          {hits.map((c) => (
            <li key={c.id}>
              <button
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                onClick={() => choose(c)}
              >
                <span className="font-medium">{c.title}</span>
                <span className="text-xs text-text-subtle">
                  {c.provider}
                  {c.external_hours ? ` · ${c.external_hours} h` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-text-subtle">
        The trainee follows it on the provider. It ticks off here when the sync reports it
        finished — it cannot be ticked by hand, which is what keeps the completion figure true.
      </p>
      <MdArea
        label="Why this course sits here (markdown, optional)"
        value={lesson.body_md}
        onChange={(v) => patch({ body_md: v })}
      />
    </div>
  );
}

function LessonEditor({ lesson, patch }: { lesson: ELesson; patch: (p: Partial<ELesson>) => void }) {
  const t = useT();
  switch (lesson.type) {
    case "video":
      return (
        <div className="space-y-2">
          <input
            className="input"
            placeholder="Video URL (YouTube / Vimeo)"
            value={lesson.video_url}
            onChange={(e) => patch({ video_url: e.target.value })}
          />
          <MdArea label="Notes under the video (markdown, optional)" value={lesson.body_md} onChange={(v) => patch({ body_md: v })} />
        </div>
      );
    case "external_course":
      return <ProviderCoursePicker lesson={lesson} patch={patch} />;
    case "lab":
      return (
        <div className="space-y-2">
          <input
            className="input"
            placeholder="Lab id (e.g. python-basics — see /labs)"
            value={lesson.lab_id}
            onChange={(e) => patch({ lab_id: e.target.value })}
          />
          <MdArea label="Intro text (markdown, optional)" value={lesson.body_md} onChange={(v) => patch({ body_md: v })} />
        </div>
      );
    case "quiz":
      return (
        <div className="space-y-3">
          {/* Tagging a quiz as the entry or exit evaluation is what turns two
              quizzes into a measurable before/after, reported per trainee. */}
          <label className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
              📊 {t("assess.picker")}
            </span>
            <select
              className="input max-w-[240px] py-1 text-sm"
              value={lesson.assessment}
              onChange={(e) => patch({ assessment: e.target.value })}
            >
              <option value="">{t("assess.picker.none")}</option>
              <option value="pre">{t("assess.picker.pre")}</option>
              <option value="post">{t("assess.picker.post")}</option>
            </select>
            {lesson.assessment === "pre" && (
              <span className="text-xs text-text-subtle">
                {t("assess.picker.preHint")}
              </span>
            )}
            {lesson.assessment === "post" && (
              <span className="text-xs text-text-subtle">
                {t("assess.picker.postHint")}
              </span>
            )}
          </label>
          {lesson.questions.map((q, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  placeholder={`Question ${i + 1}`}
                  value={q.question}
                  onChange={(e) =>
                    patch({ questions: lesson.questions.map((x, k) => (k === i ? { ...x, question: e.target.value } : x)) })
                  }
                />
                <button
                  className="btn-icon text-bad"
                  onClick={() => patch({ questions: lesson.questions.filter((_, k) => k !== i) })}
                >
                  ✕
                </button>
              </div>
              <textarea
                className="input h-20 font-mono text-xs"
                placeholder="Options, one per line"
                value={q.options}
                onChange={(e) =>
                  patch({ questions: lesson.questions.map((x, k) => (k === i ? { ...x, options: e.target.value } : x)) })
                }
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-text-subtle">
                  Correct option:
                  <select
                    className="input ml-1.5 inline-block w-auto"
                    value={q.answer_index}
                    onChange={(e) =>
                      patch({
                        questions: lesson.questions.map((x, k) =>
                          k === i ? { ...x, answer_index: Number(e.target.value) } : x,
                        ),
                      })
                    }
                  >
                    {q.options.split("\n").filter((o) => o.trim()).map((o, oi) => (
                      <option key={oi} value={oi}>
                        {oi + 1}. {o.slice(0, 40)}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  className="input flex-1"
                  placeholder="Why is it correct? (shown after answering)"
                  value={q.explanation}
                  onChange={(e) =>
                    patch({ questions: lesson.questions.map((x, k) => (k === i ? { ...x, explanation: e.target.value } : x)) })
                  }
                />
              </div>
            </div>
          ))}
          <button
            className="btn-ghost btn-sm"
            onClick={() =>
              patch({ questions: [...lesson.questions, { question: "", options: "", answer_index: 0, explanation: "" }] })
            }
          >
            + Add question
          </button>
        </div>
      );
    case "prompt_playground":
      return (
        <div className="space-y-2">
          <MdArea label="Lesson intro (markdown)" value={lesson.body_md} onChange={(v) => patch({ body_md: v })} />
          <MdArea
            label="🎯 Goal — what should trainees try to achieve?"
            value={lesson.goal_md}
            onChange={(v) => patch({ goal_md: v })}
          />
          <MdArea
            label="📥 Input data (auto-appended to their prompt — e.g. raw notes, tickets)"
            value={lesson.challenge_input}
            onChange={(v) => patch({ challenge_input: v })}
            mono
          />
          <input
            className="input"
            placeholder="Starter prompt shown in the editor (optional — e.g. a deliberately bad one)"
            value={lesson.starter_prompt}
            onChange={(e) => patch({ starter_prompt: e.target.value })}
          />
          <input
            className="input"
            placeholder="Hidden system prompt / scenario (optional, advanced)"
            value={lesson.scenario}
            onChange={(e) => patch({ scenario: e.target.value })}
          />
        </div>
      );
    case "prompt_challenge":
      return (
        <div className="space-y-2">
          <MdArea label="Lesson intro (markdown)" value={lesson.body_md} onChange={(v) => patch({ body_md: v })} />
          <MdArea
            label="🏆 Task — what must the trainee's prompt accomplish? (shown + given to the AI examiner)"
            value={lesson.task}
            onChange={(v) => patch({ task: v })}
          />
          <MdArea
            label="📥 Input data their prompt runs against"
            value={lesson.challenge_input}
            onChange={(v) => patch({ challenge_input: v })}
            mono
          />
          <MdArea
            label="📋 Rubric — one grading criterion per line"
            value={lesson.rubric}
            onChange={(v) => patch({ rubric: v })}
            mono
          />
          <label className="block text-xs text-text-subtle">
            Pass mark (0-100)
            <input
              type="number"
              className="input ml-1.5 inline-block w-24"
              value={lesson.min_score}
              onChange={(e) => patch({ min_score: Number(e.target.value) })}
            />
          </label>
        </div>
      );
    default:
      return (
        <MdArea
          label="Article content (markdown: #, ##, **bold**, `code`, ``` fences, - lists, > callouts)"
          value={lesson.body_md}
          onChange={(v) => patch({ body_md: v })}
          tall
        />
      );
  }
}

function MdArea({
  label,
  value,
  onChange,
  mono,
  tall,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  tall?: boolean;
}) {
  return (
    <label className="block text-xs text-text-subtle">
      {label}
      <textarea
        className={`input mt-1 w-full ${tall ? "h-48" : "h-24"} ${mono ? "font-mono text-xs" : "text-sm"}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/* Renders the lesson roughly as the trainee will see it. */
function LessonPreview({ lesson }: { lesson: ELesson }) {
  const m = F_LESSON_META[lesson.type];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="badge bg-edge text-text-muted">{m.icon} {m.label}</span>
        <span className="badge badge-accent">⚡ {lesson.xp || 10} XP</span>
      </div>
      <h3 className="text-lg font-semibold">{lesson.title || "Untitled lesson"}</h3>

      {lesson.type === "video" && lesson.video_url && (
        <div className="grid aspect-video place-items-center rounded-lg border border-border bg-ink text-3xl">🎬</div>
      )}

      {lesson.body_md && <MarkdownLite>{lesson.body_md}</MarkdownLite>}

      {lesson.type === "quiz" &&
        lesson.questions.map((q, i) => (
          <div key={i} className="space-y-1.5">
            <p className="text-sm font-medium">{i + 1}. {q.question || "…"}</p>
            {q.options.split("\n").filter((o) => o.trim()).map((o, oi) => (
              <div key={oi} className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-muted">
                {o}
              </div>
            ))}
          </div>
        ))}

      {lesson.type === "prompt_playground" && (
        <>
          {lesson.goal_md && (
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
              <p className="mb-1 text-xs font-semibold uppercase text-accent-text">🎯 Your goal</p>
              <MarkdownLite>{lesson.goal_md}</MarkdownLite>
            </div>
          )}
          <PreviewPromptBox starter={lesson.starter_prompt} input={lesson.challenge_input} cta="▶ Run prompt" />
        </>
      )}

      {lesson.type === "prompt_challenge" && (
        <>
          {lesson.task && (
            <div className="rounded-lg border border-warn/40 bg-warn/5 p-3">
              <p className="mb-1 text-xs font-semibold uppercase text-warn">🏆 Your mission</p>
              <p className="text-sm text-text-muted">{lesson.task}</p>
            </div>
          )}
          {lesson.rubric.trim() && (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-1 text-xs font-semibold uppercase text-text-subtle">
                📋 Rubric — pass at {lesson.min_score || 70}/100
              </p>
              <ul className="list-decimal space-y-1 pl-4 text-sm text-text-muted">
                {lesson.rubric.split("\n").filter((r) => r.trim()).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          <PreviewPromptBox input={lesson.challenge_input} cta="Run & submit for grading" />
        </>
      )}
    </div>
  );
}

function PreviewPromptBox({ starter, input, cta }: { starter?: string; input?: string; cta: string }) {
  return (
    <div className="space-y-2">
      {input?.trim() && (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-ink p-2.5 font-mono text-[11px] text-text-subtle">
          {input}
        </pre>
      )}
      <div className="rounded-lg border border-border bg-ink p-2.5 font-mono text-xs text-text-subtle">
        {starter?.trim() || "Write your prompt here…"}
      </div>
      <button className="btn btn-sm pointer-events-none opacity-60">{cta}</button>
    </div>
  );
}
