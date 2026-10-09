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

const EMOJIS = ["🎓", "🪄", "🤖", "🧠", "⚡", "🚀", "📊", "🧪", "💬", "🔮"];

/* --------------------------------- builder -------------------------------- */

export default function FormationBuilder({ initial }: { initial?: Formation }) {
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
    <div className="space-y-4">
      {/* ---- step indicator ---- */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { n: 1 as const, label: "Basics" },
          { n: 2 as const, label: "Curriculum" },
          { n: 3 as const, label: "People" },
        ].map(({ n, label }, i) => (
          <div key={n} className="flex items-center gap-2">
            {i > 0 && <span className="text-text-subtle">→</span>}
            <button
              onClick={() => (n === 1 || meta.title.trim()) && setStep(n)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 transition ${
                step === n
                  ? "border-accent bg-accent/10 font-medium text-text"
                  : "border-border text-text-subtle hover:text-text"
              }`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-xs font-semibold ${
                  step > n ? "bg-good/20 text-good" : step === n ? "bg-accent/25" : "bg-surface-2"
                }`}
              >
                {step > n ? "✓" : n}
              </span>
              {label}
            </button>
          </div>
        ))}
      </div>

      {/* ---- step 1: basics ---- */}
      {step === 1 && (
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <EmojiPicker value={meta.emoji} onChange={(e) => setMeta({ ...meta, emoji: e })} />
          <input
            className="min-w-[220px] flex-1 bg-transparent text-xl font-semibold outline-none placeholder:text-text-subtle"
            placeholder="Name your training…"
            value={meta.title}
            onChange={(e) => setMeta({ ...meta, title: e.target.value })}
          />
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            {["draft", "published"].map((s) => (
              <button
                key={s}
                onClick={() => setMeta({ ...meta, status: s })}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  meta.status === s
                    ? s === "published"
                      ? "bg-good/15 text-good"
                      : "bg-warn/15 text-warn"
                    : "text-text-subtle hover:text-text"
                }`}
              >
                {s === "published" ? "● Published" : "○ Draft"}
              </button>
            ))}
          </div>
        </div>

        <input
          className="input"
          placeholder="One-line pitch — what will trainees be able to do afterwards?"
          value={meta.summary}
          onChange={(e) => setMeta({ ...meta, summary: e.target.value })}
        />

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1">
            {["beginner", "intermediate", "advanced"].map((lv) => (
              <button
                key={lv}
                onClick={() => setMeta({ ...meta, level: lv })}
                className={`badge transition ${
                  meta.level === lv ? "badge-accent" : "bg-edge text-text-subtle hover:text-text"
                }`}
              >
                {lv}
              </button>
            ))}
          </div>
          <input
            className="input max-w-xs"
            placeholder="Tags (comma-separated)"
            value={meta.tags}
            onChange={(e) => setMeta({ ...meta, tags: e.target.value })}
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={meta.open_enrollment}
              onChange={(e) => setMeta({ ...meta, open_enrollment: e.target.checked })}
            />
            Open enrollment (anyone can join — otherwise invite/code only)
          </label>
        </div>

        {/* format */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-subtle">
            🎥 Format
          </p>
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((f) => (
              <button
                key={f}
                title={FORMAT_META[f].desc}
                onClick={() => setMeta({ ...meta, format: f })}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${
                  meta.format === f
                    ? "border-accent bg-accent/10 font-medium text-text"
                    : "border-border text-text-subtle hover:text-text"
                }`}
              >
                <span>{FORMAT_META[f].icon}</span>
                {FORMAT_META[f].label}
              </button>
            ))}
          </div>
        </div>

        {/* internal vs external — an HR reporting axis, not just a label */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-subtle">
            🏗 {t("builder.programType")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {([
              ["internal", `🏠 ${t("builder.internal")}`, t("builder.internalHint")],
              ["external", `🏢 ${t("builder.external")}`, t("builder.externalHint")],
            ] as const).map(([value, label, desc]) => (
              <button
                key={value}
                title={desc}
                onClick={() => setMeta({ ...meta, source: value })}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  meta.source === value
                    ? "border-accent bg-accent/10 font-medium text-text"
                    : "border-border text-text-subtle hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
            {meta.source === "external" && (
              <input
                className="input max-w-[240px] py-1.5 text-sm"
                placeholder={t("builder.providerPlaceholder")}
                value={meta.provider}
                onChange={(e) => setMeta({ ...meta, provider: e.target.value })}
              />
            )}
          </div>
        </div>

        {/* declared duration */}
        <label className="block max-w-xs">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-subtle">
            ⏱️ {t("builder.durationHours")}
          </span>
          <input
            className="input text-sm"
            type="number"
            min={0}
            step={0.5}
            placeholder={t("builder.durationPlaceholder")}
            value={meta.duration_hours}
            onChange={(e) => setMeta({ ...meta, duration_hours: e.target.value })}
          />
          <span className="mt-1 block text-xs text-text-subtle">{t("builder.durationHint")}</span>
        </label>

        {/* prerequisites */}
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-subtle">
            📋 Prerequisites
          </span>
          <textarea
            className="input h-16 text-sm"
            placeholder="What should trainees know or have done before starting? (leave empty if none)"
            value={meta.prerequisites}
            onChange={(e) => setMeta({ ...meta, prerequisites: e.target.value })}
          />
        </label>

        {/* skills developed */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-subtle">
            🎯 Skills this training develops
          </p>
          {skills.length === 0 ? (
            <p className="text-xs text-text-subtle">
              No skills in the catalog yet — add some from the Skills page.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => {
                const on = skillIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    title={s.description}
                    onClick={() =>
                      setSkillIds((cur) => (on ? cur.filter((i) => i !== s.id) : [...cur, s.id]))
                    }
                    className={`rounded-full border px-3 py-1 text-xs transition ${
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
          )}
        </div>

        {/* objectives */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-subtle">
            🎯 Learning objectives
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {meta.objectives.map((o, i) => (
              <span key={i} className="badge bg-edge text-text-muted">
                {o}
                <button
                  className="ml-1.5 text-text-subtle hover:text-bad"
                  onClick={() =>
                    setMeta({ ...meta, objectives: meta.objectives.filter((_, k) => k !== i) })
                  }
                >
                  ✕
                </button>
              </span>
            ))}
            <input
              className="input max-w-xs"
              placeholder="Add an objective + Enter"
              value={objDraft}
              onChange={(e) => setObjDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && objDraft.trim()) {
                  setMeta({ ...meta, objectives: [...meta.objectives, objDraft.trim()] });
                  setObjDraft("");
                }
              }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-text-subtle">
            Next: build the curriculum — modules, lessons and hands-on practice.
          </p>
          <button className="btn" disabled={!meta.title.trim()} onClick={() => setStep(2)}>
            Continue to curriculum →
          </button>
        </div>
      </div>
      )}

      {/* ---- steps 2-3: recap of basics ---- */}
      {step >= 2 && (
      <>
      {/* compact recap of step 1 */}
      <div className="card flex flex-wrap items-center gap-3 py-3">
        <span className="text-2xl">{meta.emoji || "🎓"}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{meta.title || "Untitled formation"}</p>
          <p className="truncate text-xs text-text-subtle">
            {meta.level}
            {meta.summary && ` · ${meta.summary}`}
          </p>
        </div>
        <span className={`badge ${meta.status === "published" ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}>
          {meta.status}
        </span>
        <button className="btn-ghost btn-sm" onClick={() => setStep(1)}>
          ← Edit details
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
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">Modules</p>
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
                  <button className="btn-icon text-xs" onClick={(e) => { e.stopPropagation(); moveModule(i, i - 1); }}>↑</button>
                  <button className="btn-icon text-xs" onClick={(e) => { e.stopPropagation(); moveModule(i, i + 1); }}>↓</button>
                  <button className="btn-icon text-xs text-bad" onClick={(e) => { e.stopPropagation(); removeModule(i); }}>✕</button>
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
          <button className="btn-ghost w-full" onClick={addModule}>
            + Add module
          </button>
        </div>

        {/* lesson canvas */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
              Lessons — {mod?.title}
            </p>
            <button className="btn-soft btn-sm" onClick={() => setPalette(true)}>
              + Add lesson
            </button>
          </div>

          {mod?.lessons.length === 0 && (
            <button
              onClick={() => setPalette(true)}
              className="w-full rounded-xl border-2 border-dashed border-border p-8 text-sm text-text-subtle transition hover:border-accent hover:text-text"
            >
              This module is empty — add its first lesson
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
                    <button className="btn-icon text-xs" onClick={(e) => { e.stopPropagation(); moveLesson(j, j - 1); }}>↑</button>
                    <button className="btn-icon text-xs" onClick={(e) => { e.stopPropagation(); moveLesson(j, j + 1); }}>↓</button>
                    <button className="btn-icon text-xs text-bad" onClick={(e) => { e.stopPropagation(); removeLesson(j); }}>✕</button>
                  </span>
                </div>

                {selected && lesson && (
                  <div className="space-y-3 border-t border-border p-3" onClick={(e) => e.stopPropagation()}>
                    <LessonEditor lesson={lesson} patch={patchLesson} />
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-text-subtle">
                        ⚡ XP
                        <input
                          type="number"
                          className="input ml-1.5 inline-block w-20"
                          value={lesson.xp}
                          onChange={(e) => patchLesson({ xp: Number(e.target.value) })}
                        />
                      </label>
                      <label className="text-xs text-text-subtle">
                        ⏱ Minutes
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
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            👁 Trainee preview
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
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setPalette(false)}
        >
          <div
            className="w-full max-w-2xl animate-scale-in rounded-2xl border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 font-semibold">Add a lesson to “{mod?.title}”</p>
            <p className="mb-4 text-xs text-text-subtle">
              Mix theory with practice — the interactive types keep trainees doing, not just reading.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {F_LESSON_TYPES.map((t) => {
                const m = F_LESSON_META[t];
                return (
                  <button
                    key={t}
                    onClick={() => addLesson(t)}
                    className="flex items-start gap-3 rounded-xl border border-border p-3 text-left transition hover:border-accent hover:bg-accent/5"
                  >
                    <span className="text-2xl">{m.icon}</span>
                    <span>
                      <span className="block text-sm font-medium">
                        {m.label}
                        {m.kind === "practice" && <span className="ml-1.5 badge badge-accent">hands-on</span>}
                      </span>
                      <span className="block text-xs text-text-subtle">{m.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      </>
      )}

      {/* ---- step 3: who takes it ---- */}
      {step === 3 && (
        <div className="card space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            👥 Who should take this training?
          </p>
          <p className="text-sm text-text-muted">
            Invite people now by handle or email — each gets a notification and an email invite.
            You can also skip this: team leads and managers can assign the training from their
            team dashboard at any time.
          </p>
          <textarea
            className="input h-24"
            placeholder="Handles or emails, separated by commas or new lines…"
            value={invitees}
            onChange={(e) => setInvitees(e.target.value)}
          />
          {meta.open_enrollment && (
            <p className="text-xs text-text-subtle">
              ℹ️ Open enrollment is on — anyone can also join from the catalog without an invite.
            </p>
          )}
        </div>
      )}

      {step >= 2 && (
      <>
      {/* ---- save bar ---- */}
      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}
      <div className="sticky bottom-4 z-10 flex items-center justify-between rounded-2xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur">
        <p className="text-xs text-text-subtle">
          {stats.lessons} lessons · {stats.practice} hands-on · ⚡{stats.xp} XP · {fmtDuration(stats.min)}
          {meta.status === "draft" && " · saved as draft (invisible to trainees)"}
        </p>
        <div className="flex items-center gap-2">
          {step === 2 && (
            <button className="btn-ghost" onClick={() => setStep(3)}>
              👥 People →
            </button>
          )}
          {step === 3 && (
            <button className="btn-ghost" onClick={() => setStep(2)}>
              ← Curriculum
            </button>
          )}
          <button className="btn" onClick={save} disabled={busy || !meta.title.trim()}>
            {busy
              ? "Saving…"
              : initial
                ? "💾 Save changes"
                : meta.status === "published"
                  ? "🚀 Publish training"
                  : "💾 Save draft"}
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

function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="grid h-12 w-12 place-items-center rounded-xl border border-border text-2xl transition hover:border-accent"
        onClick={() => setOpen((o) => !o)}
        title="Pick an emoji"
      >
        {value || "🎓"}
      </button>
      {open && (
        <div className="absolute left-0 top-14 z-20 grid grid-cols-5 gap-1 rounded-xl border border-border bg-surface p-2 shadow-lg">
          {EMOJIS.map((e) => (
            <button
              key={e}
              className="grid h-9 w-9 place-items-center rounded-lg text-xl hover:bg-surface-2"
              onClick={() => {
                onChange(e);
                setOpen(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
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
          <PreviewPromptBox input={lesson.challenge_input} cta="🚀 Run & submit for grading" />
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
