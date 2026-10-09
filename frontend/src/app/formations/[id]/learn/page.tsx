"use client";

import { Suspense, use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  api,
  type ChallengeResult,
  type Course,
  type Formation,
  type FormationLesson,
  type Learner,
} from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import MarkdownLite from "@/components/MarkdownLite";
import { F_LESSON_META, fmtDuration } from "@/lib/formationLessons";
import { useT } from "@/lib/i18n";
import Icon, { type IconName } from "@/components/Icon";

const TYPE_ICON: Record<string, IconName> = {
  article: "file",
  video: "play",
  lab: "labs",
  quiz: "quiz",
  prompt_playground: "sparkles",
  prompt_challenge: "trophy",
  external_course: "external",
};

function embedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") && u.searchParams.get("v"))
      return `https://www.youtube.com/embed/${u.searchParams.get("v")}`;
    if (u.hostname === "youtu.be") return `https://www.youtube.com/embed${u.pathname}`;
    if (u.hostname.includes("vimeo.com"))
      return `https://player.vimeo.com/video/${u.pathname.split("/").filter(Boolean).pop()}`;
  } catch {
    /* not a URL */
  }
  return null;
}

type Flat = { lesson: FormationLesson; module: string; moduleIndex: number };

export default function FormationPlayerPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="h-96 skeleton rounded-2xl" aria-busy="true" />}>
      <FormationPlayer params={params} />
    </Suspense>
  );
}

function FormationPlayer({ params }: { params: Promise<{ id: string }> }) {
  const t = useT();
  const { id } = use(params);
  const formationId = Number(id);
  const search = useSearchParams();

  const [me, setMe] = useState<Learner | null>(null);
  const [formation, setFormation] = useState<Formation | null>(null);
  const [flat, setFlat] = useState<Flat[]>([]);
  const [idx, setIdx] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [xpEarned, setXpEarned] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const learner = getStoredLearner();
    setMe(learner);
    api
      .getFormation(formationId, learner?.id)
      .then((f) => {
        setFormation(f);
        const flatL = (f.curriculum.modules ?? []).flatMap((m, mi) =>
          m.lessons.map((lesson) => ({ lesson, module: m.title, moduleIndex: mi })),
        );
        setFlat(flatL);
        const want = search.get("lesson");
        if (want) {
          const wi = flatL.findIndex((x) => x.lesson.id === want);
          if (wi >= 0) setIdx(wi);
        }
        if (learner) {
          api
            .formationProgress(formationId, learner.id)
            .then((p) => {
              const done = new Set(p.completed);
              setCompleted(done);
              setXpEarned(p.xp_earned);
              // No lesson asked for: open where they left off, not on lesson
              // one of a training they are half-way through.
              if (!want) {
                const next = flatL.findIndex((x) => !done.has(x.lesson.id));
                if (next > 0) setIdx(next);
              }
            })
            .catch(() => {});
        }
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formationId]);

  const current = flat[idx];

  function go(i: number) {
    if (i < 0 || i >= flat.length) return;
    setIdx(i);
    window.scrollTo({ top: 0 });
  }

  // ← / → move between lessons when the reader isn't typing (playgrounds and
  // challenges are full of text boxes, so this stays out of their way).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" && idx < flat.length - 1) go(idx + 1);
      if (e.key === "ArrowLeft" && idx > 0) go(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function markComplete(data?: Record<string, unknown>) {
    if (!me) {
      setError(t("form.hub.signIn"));
      return;
    }
    try {
      const p = await api.completeFormationLesson(formationId, current.lesson.id, me.id, data);
      setCompleted(new Set(p.completed));
      setXpEarned(p.xp_earned);
      window.dispatchEvent(new Event("dqai-learner-changed"));
      if (idx < flat.length - 1) go(idx + 1);
    } catch (e) {
      setError(String(e));
    }
  }

  function onChallengePassed(result: ChallengeResult) {
    setCompleted(new Set(result.progress.completed));
    setXpEarned(result.progress.xp_earned);
    window.dispatchEvent(new Event("dqai-learner-changed"));
  }

  if (error && !formation)
    return (
      <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
        {error}
      </p>
    );
  if (!formation || flat.length === 0)
    return (
      <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)]" aria-busy="true">
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-8 skeleton" />
          ))}
        </div>
        <div className="space-y-3">
          <div className="h-9 w-2/3 skeleton" />
          <div className="h-4 w-full skeleton" />
          <div className="h-4 w-5/6 skeleton" />
        </div>
      </div>
    );

  const pct = Math.round((100 * completed.size) / flat.length);
  // Lessons that complete through their own interaction, not the bottom bar.
  // Lessons the bottom bar cannot tick off. A provider course is one of them:
  // it is done when the provider says so, not when the trainee says so.
  const gradedHere = ["quiz", "prompt_challenge", "prompt_playground", "external_course"].includes(
    current.lesson.type,
  );

  const prev = flat[idx - 1];
  const next = flat[idx + 1];
  const isDone = completed.has(current.lesson.id);

  return (
    <div className="space-y-6">
      {/* ---- Training bar -------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border pb-4">
        <Link href={`/formations/${formationId}`} className="group flex min-w-0 items-center gap-2 text-sm">
          <Icon name="arrow-right" size={14} className="rotate-180 text-text-subtle group-hover:text-text" />
          <span className="text-lg" aria-hidden="true">{formation.emoji}</span>
          <span className="truncate font-medium text-text group-hover:text-accent-text">{formation.title}</span>
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <span className="inline-flex items-center gap-1 text-xs text-text-subtle tnum">
            <Icon name="bolt" size={12} className="text-iris" /> {t("learn.xpEarned", { xp: xpEarned })}
          </span>
          <div
            className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("course.progress")}
          >
            <div
              className={`h-full origin-left rounded-full transition-transform duration-500 ${pct === 100 ? "bg-good" : "bg-accent"}`}
              style={{ transform: `scaleX(${pct / 100})` }}
            />
          </div>
          <span className="w-9 text-right text-xs font-medium tnum">{pct}%</span>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label={t("common.close")} className="shrink-0 hover:opacity-70">
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* ---- Outline ------------------------------------------------------ */}
        <nav aria-label={t("course.curriculum")} className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          <ol className="space-y-5">
            {(formation.curriculum.modules ?? []).map((m, mi) => (
              <li key={mi}>
                <p className="mb-2 text-xs font-semibold text-text-subtle">
                  <span className="mr-1.5 font-mono tnum">{String(mi + 1).padStart(2, "0")}</span>
                  {m.title}
                </p>
                <ol>
                  {m.lessons.map((l, li) => {
                    const fi = flat.findIndex((f) => f.lesson.id === l.id);
                    const active = fi === idx;
                    const done = completed.has(l.id);
                    return (
                      <li key={l.id} className="relative">
                        {li < m.lessons.length - 1 && (
                          <span className={`absolute left-[11px] top-7 h-[calc(100%-1rem)] w-px ${done ? "bg-good/40" : "bg-border"}`} aria-hidden="true" />
                        )}
                        <button
                          type="button"
                          onClick={() => go(fi)}
                          aria-current={active ? "step" : undefined}
                          className={`relative flex w-full items-start gap-3 rounded-lg py-1.5 pr-2 text-left text-sm transition-colors ${
                            active ? "text-text" : "text-text-muted hover:text-text"
                          }`}
                        >
                          <span
                            className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors ${
                              done
                                ? "border-good bg-good text-white"
                                : active
                                  ? "border-accent bg-surface text-accent-text"
                                  : "border-border bg-bg text-text-subtle"
                            }`}
                          >
                            <Icon name={done ? "check" : TYPE_ICON[l.type] ?? "file"} size={11} strokeWidth={done ? 3 : 2} />
                          </span>
                          <span className={`min-w-0 flex-1 leading-snug ${active ? "font-semibold" : ""}`}>{l.title}</span>
                          <span className="mt-0.5 shrink-0 text-[10px] text-text-subtle tnum">{l.xp ?? 10}</span>
                          <span className="sr-only">{done ? t("course.completed") : ""}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
          <p className="mt-6 hidden text-xs text-text-subtle lg:block">
            {t("learn.keys")} <span className="kbd">←</span> <span className="kbd">→</span>
          </p>
        </nav>

        {/* ---- Lesson ------------------------------------------------------- */}
        <div className="min-w-0">
          <article className="mx-auto max-w-[72ch]">
            <LessonView
              key={current.lesson.id}
              formationId={formationId}
              lesson={current.lesson}
              me={me}
              done={isDone}
              position={t("learn.lessonOf", { n: idx + 1, total: flat.length })}
              moduleLabel={`${String(current.moduleIndex + 1).padStart(2, "0")} · ${current.module}`}
              onComplete={markComplete}
              onChallengePassed={onChallengePassed}
            />

            <div className="mt-10 border-t border-border pt-6">
              {!gradedHere && !isDone && (
                <button type="button" className="btn mb-6 w-full justify-center py-3 text-[15px] sm:w-auto sm:px-6" onClick={() => markComplete()}>
                  <Icon name="check" size={16} /> {idx < flat.length - 1 ? t("learn.completeNext") : t("learn.finishTraining")}
                </button>
              )}
              {gradedHere && !isDone && (
                <p className="mb-6 text-sm text-text-subtle">{t("learn.gradedHere")}</p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {prev ? (
                  <button type="button" onClick={() => go(idx - 1)} className="group rounded-xl border border-border p-4 text-left transition-colors hover:border-border-strong hover:bg-surface">
                    <span className="flex items-center gap-1 text-xs text-text-subtle">
                      <Icon name="arrow-right" size={12} className="rotate-180" /> {t("learn.previous")}
                    </span>
                    <span className="mt-1 block truncate text-sm font-medium group-hover:text-accent-text">{prev.lesson.title}</span>
                  </button>
                ) : (
                  <span />
                )}
                {next && (
                  <button
                    type="button"
                    onClick={() => go(idx + 1)}
                    className={`group rounded-xl border p-4 text-right transition-colors hover:bg-surface ${
                      isDone ? "border-accent/50 hover:border-accent" : "border-border hover:border-border-strong"
                    }`}
                  >
                    <span className="flex items-center justify-end gap-1 text-xs text-text-subtle">
                      {gradedHere && !isDone ? t("form.skipForNow") : t("learn.next")} <Icon name="arrow-right" size={12} />
                    </span>
                    <span className="mt-1 block truncate text-sm font-medium group-hover:text-accent-text">{next.lesson.title}</span>
                  </button>
                )}
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Lesson renderers                                                           */
/* ------------------------------------------------------------------------- */

function LessonView({
  formationId,
  lesson,
  me,
  done,
  position,
  moduleLabel,
  onComplete,
  onChallengePassed,
}: {
  formationId: number;
  lesson: FormationLesson;
  me: Learner | null;
  done: boolean;
  position: string;
  moduleLabel: string;
  onComplete: (data?: Record<string, unknown>) => void;
  onChallengePassed: (r: ChallengeResult) => void;
}) {
  const t = useT();
  const meta = F_LESSON_META[lesson.type] ?? F_LESSON_META.article;
  const embed = useMemo(
    () => (lesson.video_url ? embedUrl(lesson.video_url) : null),
    [lesson.video_url],
  );

  return (
    <div className="space-y-6 [&_.my-2>li]:text-[15px] [&_li]:leading-7 [&_p.my-2]:text-[15px] [&_p.my-2]:leading-7">
      <header>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-subtle">
          <span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 font-medium text-accent-text">
            <Icon name={TYPE_ICON[lesson.type] ?? "file"} size={11} /> {meta.label}
          </span>
          <span>{moduleLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="tnum">{position}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1 tnum">
            <Icon name="clock" size={11} /> {fmtDuration(lesson.duration_min ?? 5)}
          </span>
          <span className="inline-flex items-center gap-1 tnum">
            <Icon name="bolt" size={11} className="text-iris" /> {lesson.xp ?? 10}&nbsp;XP
          </span>
          {done && (
            <span className="inline-flex items-center gap-1 text-good">
              <Icon name="check" size={12} /> {t("course.completed")}
            </span>
          )}
        </p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.025em]">{lesson.title}</h1>
      </header>

      {lesson.type === "video" && lesson.video_url && (
        embed ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black shadow-sm">
            <iframe src={embed} className="h-full w-full" allowFullScreen title={lesson.title} />
          </div>
        ) : (
          <a href={lesson.video_url} target="_blank" rel="noopener noreferrer" className="btn">
            <Icon name="play" size={16} /> {t("learn.watch")}
          </a>
        )
      )}

      {lesson.type === "external_course" && lesson.course_id && (
        <ProviderCourseLesson courseId={lesson.course_id} done={done} />
      )}

      {lesson.type === "lab" && lesson.lab_id && (
        <Link
          href={`/labs/${lesson.lab_id}`}
          target="_blank"
          className="group flex items-center gap-4 rounded-xl border border-accent/30 bg-accent/5 p-5 transition-colors hover:border-accent"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg">
            <Icon name="labs" size={20} />
          </span>
          <span className="flex-1">
            <span className="block font-semibold">{t("learn.openLab")}</span>
            <span className="block text-sm text-text-muted">{t("learn.openLabHint")}</span>
          </span>
          <Icon name="external" size={16} className="text-accent-text" />
        </Link>
      )}

      {lesson.body_md && <MarkdownLite>{lesson.body_md}</MarkdownLite>}

      {lesson.type === "quiz" && <QuizLesson lesson={lesson} done={done} onPass={() => onComplete()} />}

      {lesson.type === "prompt_playground" && (
        <PlaygroundLesson formationId={formationId} lesson={lesson} done={done} onComplete={onComplete} />
      )}

      {lesson.type === "prompt_challenge" && (
        <ChallengeLesson
          formationId={formationId}
          lesson={lesson}
          me={me}
          done={done}
          onPassed={onChallengePassed}
        />
      )}
    </div>
  );
}

/* ---- quiz: multi-question with explanations ---- */

/** A step the trainee does on the provider. The link goes out; the tick comes
 *  back from the sync, so there is nothing here to click to call it finished. */
function ProviderCourseLesson({ courseId, done }: { courseId: number; done: boolean }) {
  const [course, setCourse] = useState<Course | null>(null);

  useEffect(() => {
    api.getCourse(courseId).then(setCourse).catch(() => setCourse(null));
  }, [courseId]);

  if (!course) return <p className="text-sm text-text-subtle">Loading…</p>;

  return (
    <div className="space-y-3">
      <div className="card space-y-1">
        <p className="font-medium">
          {course.emoji} {course.title}
        </p>
        <p className="text-xs text-text-subtle">
          {course.provider}
          {course.external_hours ? ` · ${course.external_hours} h` : ""}
        </p>
        {course.summary && <p className="text-sm text-text-muted">{course.summary}</p>}
      </div>
      <a
        href={course.external_url}
        target="_blank"
        rel="noopener noreferrer"
        className="btn inline-flex"
      >
        🎓 Open on {course.provider || "the provider"}
      </a>
      <p className="text-sm text-text-subtle">
        {done
          ? "Finished — the provider reported this course complete."
          : "This step ticks itself off once the provider reports the course finished (the sync runs nightly)."}
      </p>
    </div>
  );
}

function QuizLesson({
  lesson,
  done,
  onPass,
}: {
  lesson: FormationLesson;
  done: boolean;
  onPass: () => void;
}) {
  const t = useT();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const qs = lesson.questions ?? [];
  const allAnswered = qs.every((_, i) => answers[i] !== undefined);
  const allCorrect = qs.every((q, i) => answers[i] === q.answer_index);

  function check() {
    setChecked(true);
    if (qs.every((q, i) => answers[i] === q.answer_index)) onPass();
  }

  return (
    <div className="space-y-5">
      {qs.map((q, qi) => {
        const picked = answers[qi];
        return (
          <div key={qi} className="space-y-2">
            <p className="font-medium">
              {qi + 1}. {q.question}
            </p>
            {q.options.map((o, oi) => {
              const isPicked = picked === oi;
              const showState = checked && isPicked;
              const correct = oi === q.answer_index;
              return (
                <label
                  key={oi}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                    showState
                      ? correct
                        ? "border-good bg-good/10"
                        : "border-bad bg-bad/10"
                      : isPicked
                        ? "border-accent bg-accent/10"
                        : "border-border hover:bg-surface-2"
                  }`}
                >
                  <input
                    type="radio"
                    name={`q${qi}`}
                    checked={isPicked}
                    onChange={() => {
                      setAnswers((a) => ({ ...a, [qi]: oi }));
                      setChecked(false);
                    }}
                  />
                  {o}
                </label>
              );
            })}
            {checked && picked !== undefined && (
              <p className={`text-xs ${picked === q.answer_index ? "text-good" : "text-bad"}`}>
                {picked === q.answer_index ? "✓ " : "✗ "}
                {q.explanation}
              </p>
            )}
          </div>
        );
      })}
      {!done && (
        <button className="btn" onClick={check} disabled={!allAnswered}>
          {t("form.checkAnswers")}
        </button>
      )}
      {checked && allAnswered && !allCorrect && (
        <p className="text-sm text-warn">{t("form.notAllCorrect")}</p>
      )}
      {(done || (checked && allCorrect)) && (
        <p className="text-sm text-good">✓ Checkpoint passed!</p>
      )}
    </div>
  );
}

/* ---- prompt playground: live LLM experimentation ---- */

function PlaygroundLesson({
  formationId,
  lesson,
  done,
  onComplete,
}: {
  formationId: number;
  lesson: FormationLesson;
  done: boolean;
  onComplete: (data?: Record<string, unknown>) => void;
}) {
  const t = useT();
  const [promptText, setPromptText] = useState(lesson.starter_prompt ?? "");
  const [output, setOutput] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setErr(null);
    try {
      const r = await api.runPlayground(formationId, lesson.id, promptText);
      setOutput(r.output);
      setRuns((n) => n + 1);
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      {lesson.goal_md && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent-text">🎯 Your goal</p>
          <MarkdownLite>{lesson.goal_md}</MarkdownLite>
        </div>
      )}

      {lesson.challenge_input && <InputData text={lesson.challenge_input} />}

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-subtle">
          ✍️ Your prompt
        </p>
        <textarea
          className="input h-36 w-full font-mono text-xs leading-relaxed"
          placeholder={t("form.promptHere")}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-3">
          <button className="btn" onClick={run} disabled={running || !promptText.trim()}>
            {running ? "Running…" : "▶ Run prompt"}
          </button>
          {runs > 0 && (
            <span className="text-xs text-text-subtle">
              {runs} run{runs > 1 ? "s" : ""} this session
            </span>
          )}
        </div>
      </div>

      {err && <p className="text-sm text-bad">{err}</p>}

      {output !== null && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-subtle">
            🤖 Model output
          </p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-ink p-3 font-mono text-xs leading-relaxed text-text">
            {output}
          </pre>
        </div>
      )}

      {!done && runs > 0 && (
        <button className="btn-soft" onClick={() => onComplete({ runs })}>
          ✓ I&apos;m happy with my prompt — mark done
        </button>
      )}
      {!done && runs === 0 && (
        <p className="text-xs text-text-subtle">{t("form.runOnce")}</p>
      )}
    </div>
  );
}

/* ---- prompt challenge: LLM-judged, rubric-scored ---- */

function ChallengeLesson({
  formationId,
  lesson,
  me,
  done,
  onPassed,
}: {
  formationId: number;
  lesson: FormationLesson;
  me: Learner | null;
  done: boolean;
  onPassed: (r: ChallengeResult) => void;
}) {
  const t = useT();
  const [promptText, setPromptText] = useState("");
  const [result, setResult] = useState<ChallengeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!me) {
      setErr("Pick a handle first (top-right) so your score can be saved.");
      return;
    }
    setRunning(true);
    setErr(null);
    try {
      const r = await api.runChallenge(formationId, lesson.id, promptText, me.id);
      setResult(r);
      if (r.passed) onPassed(r);
    } catch (e) {
      setErr(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      {lesson.task && (
        <div className="rounded-lg border border-warn/40 bg-warn/5 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-warn">🏆 Your mission</p>
          <p className="text-sm leading-relaxed text-text-muted">{lesson.task}</p>
        </div>
      )}

      {lesson.rubric.length > 0 && (
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">
            📋 Grading rubric — pass at {lesson.min_score}/100
          </p>
          <ul className="space-y-1.5">
            {lesson.rubric.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text-muted">
                <span className="mt-0.5 text-text-subtle">{i + 1}.</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lesson.challenge_input && <InputData text={lesson.challenge_input} />}

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-subtle">
          ✍️ Your prompt
        </p>
        <textarea
          className="input h-44 w-full font-mono text-xs leading-relaxed"
          placeholder={t("form.promptShip")}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
        />
        <button className="btn mt-2" onClick={submit} disabled={running || !promptText.trim()}>
          {running ? "Running & grading…" : "Run & submit for grading"}
        </button>
        {running && (
          <p className="mt-1 text-xs text-text-subtle">
            {t("form.examinerHint")}
          </p>
        )}
      </div>

      {err && <p className="text-sm text-bad">{err}</p>}

      {result && (
        <div className="space-y-4">
          <div
            className={`rounded-lg border p-4 ${
              result.passed ? "border-good/50 bg-good/10" : "border-warn/50 bg-warn/10"
            }`}
          >
            <div className="flex items-center gap-4">
              <ScoreDial score={result.judgement.score} passed={result.passed} />
              <div className="min-w-0">
                <p className="font-semibold">
                  {result.passed ? "Challenge passed! 🎉" : `Not yet — pass mark is ${result.min_score}.`}
                </p>
                <p className="mt-0.5 text-sm text-text-muted">{result.judgement.verdict}</p>
              </div>
            </div>
          </div>

          {result.judgement.criteria.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">
                {t("form.rubric")}
              </p>
              <ul className="space-y-1.5 text-sm text-text-muted">
                {result.judgement.criteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {result.judgement.strengths.length > 0 && (
              <div className="rounded-lg border border-good/30 p-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-good">{t("form.strengths")}</p>
                <ul className="list-disc space-y-1 pl-4 text-sm text-text-muted">
                  {result.judgement.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.judgement.improvements.length > 0 && (
              <div className="rounded-lg border border-warn/30 p-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-warn">{t("form.improve")}</p>
                <ul className="list-disc space-y-1 pl-4 text-sm text-text-muted">
                  {result.judgement.improvements.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-text-subtle">
              🤖 What your prompt produced
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-text">
              {result.output}
            </pre>
          </details>
        </div>
      )}

      {done && !result && <p className="text-sm text-good">✓ Already passed — feel free to retry for a higher score.</p>}
    </div>
  );
}

function ScoreDial({ score, passed }: { score: number; passed: boolean }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" className="shrink-0">
      <circle cx="36" cy="36" r={r} fill="none" strokeWidth="7" className="stroke-surface-2" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform="rotate(-90 36 36)"
        className={passed ? "stroke-good" : "stroke-warn"}
      />
      <text x="36" y="41" textAnchor="middle" className="fill-current font-sans text-[16px] font-bold">
        {score}
      </text>
    </svg>
  );
}

function InputData({ text }: { text: string }) {
  return (
    <details open className="rounded-lg border border-border">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">
        📥 Input data (wired into your prompt automatically)
      </summary>
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap border-t border-border bg-ink p-3 font-mono text-xs leading-relaxed text-text-muted">
        {text}
      </pre>
    </details>
  );
}
