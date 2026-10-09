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
    <Suspense fallback={<p className="text-sm text-text-subtle">Loading…</p>}>
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
      })
      .catch((e) => setError(String(e)));
    if (learner) {
      api
        .formationProgress(formationId, learner.id)
        .then((p) => {
          setCompleted(new Set(p.completed));
          setXpEarned(p.xp_earned);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formationId]);

  const current = flat[idx];

  async function markComplete(data?: Record<string, unknown>) {
    if (!me) {
      setError("Pick a handle first (top-right) so your progress can be saved.");
      return;
    }
    try {
      const p = await api.completeFormationLesson(formationId, current.lesson.id, me.id, data);
      setCompleted(new Set(p.completed));
      setXpEarned(p.xp_earned);
      window.dispatchEvent(new Event("dqai-learner-changed"));
      if (idx < flat.length - 1) setIdx(idx + 1);
    } catch (e) {
      setError(String(e));
    }
  }

  function onChallengePassed(result: ChallengeResult) {
    setCompleted(new Set(result.progress.completed));
    setXpEarned(result.progress.xp_earned);
    window.dispatchEvent(new Event("dqai-learner-changed"));
  }

  if (error && !formation) return <p className="text-sm text-bad">{error}</p>;
  if (!formation || flat.length === 0)
    return <p className="text-sm text-text-subtle">Loading…</p>;

  const pct = Math.round((100 * completed.size) / flat.length);
  // Lessons that complete through their own interaction, not the bottom bar.
  // Lessons the bottom bar cannot tick off. A provider course is one of them:
  // it is done when the provider says so, not when the trainee says so.
  const gradedHere = ["quiz", "prompt_challenge", "prompt_playground", "external_course"].includes(
    current.lesson.type,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/formations/${formationId}`} className="text-xs text-text-subtle hover:text-text">
          ← {formation.emoji} {formation.title}
        </Link>
        <div className="flex items-center gap-3 text-xs text-text-subtle">
          <span>⚡ {xpEarned} XP earned</span>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full ${pct === 100 ? "bg-good" : "bg-accent"}`}
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </div>
          <span className="font-medium text-text">{pct}%</span>
        </div>
      </div>

      {error && (
        <div className="card cursor-pointer border-bad/40 text-sm text-bad" onClick={() => setError(null)}>
          {error} <span className="text-xs text-text-subtle">(click to dismiss)</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Curriculum sidebar */}
        <nav className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          {(formation.curriculum.modules ?? []).map((m, mi) => (
            <div key={mi}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                Module {mi + 1} · {m.title}
              </p>
              <div className="space-y-1">
                {m.lessons.map((l) => {
                  const fi = flat.findIndex((f) => f.lesson.id === l.id);
                  const active = fi === idx;
                  const meta = F_LESSON_META[l.type] ?? F_LESSON_META.article;
                  return (
                    <button
                      key={l.id}
                      onClick={() => setIdx(fi)}
                      className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition ${
                        active
                          ? "border-accent bg-accent/10"
                          : "border-border hover:bg-surface-2"
                      }`}
                    >
                      <span>{completed.has(l.id) ? "✅" : meta.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{l.title}</span>
                      <span className="shrink-0 text-[10px] text-text-subtle">⚡{l.xp ?? 10}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Lesson */}
        <div className="space-y-4">
          <LessonView
            key={current.lesson.id}
            formationId={formationId}
            lesson={current.lesson}
            me={me}
            done={completed.has(current.lesson.id)}
            onComplete={markComplete}
            onChallengePassed={onChallengePassed}
          />

          <div className="flex items-center justify-between border-t border-border pt-4">
            <button className="btn-ghost" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}>
              ← Prev
            </button>
            <span className="text-xs text-text-subtle">
              {idx + 1} / {flat.length}
            </span>
            {gradedHere && !completed.has(current.lesson.id) ? (
              <button
                className="btn-ghost"
                onClick={() => setIdx(Math.min(flat.length - 1, idx + 1))}
                disabled={idx === flat.length - 1}
              >
                {t("form.skipForNow")}
              </button>
            ) : completed.has(current.lesson.id) ? (
              <button
                className="btn"
                onClick={() => setIdx(Math.min(flat.length - 1, idx + 1))}
                disabled={idx === flat.length - 1}
              >
                {t("form.next")}
              </button>
            ) : (
              <button className="btn" onClick={() => markComplete()}>
                {idx < flat.length - 1 ? "Complete & next →" : "Finish 🎉"}
              </button>
            )}
          </div>
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
  onComplete,
  onChallengePassed,
}: {
  formationId: number;
  lesson: FormationLesson;
  me: Learner | null;
  done: boolean;
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
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge bg-edge text-text-muted">
          {meta.icon} {meta.label}
        </span>
        <span className="badge bg-edge text-text-subtle">{fmtDuration(lesson.duration_min ?? 5)}</span>
        <span className="badge badge-accent">⚡ {lesson.xp ?? 10} XP</span>
        {done && <span className="badge badge-good">✓ completed</span>}
      </div>
      <h1 className="text-xl font-semibold">{lesson.title}</h1>

      {lesson.type === "video" && lesson.video_url && (
        embed ? (
          <div className="aspect-video w-full overflow-hidden rounded-lg border border-border">
            <iframe src={embed} className="h-full w-full" allowFullScreen title={lesson.title} />
          </div>
        ) : (
          <a href={lesson.video_url} target="_blank" rel="noopener noreferrer" className="btn inline-flex">
            🎬 Watch video
          </a>
        )
      )}

      {lesson.type === "external_course" && lesson.course_id && (
        <ProviderCourseLesson courseId={lesson.course_id} done={done} />
      )}

      {lesson.type === "lab" && lesson.lab_id && (
        <Link href={`/labs/${lesson.lab_id}`} target="_blank" className="btn inline-flex">
          🧪 Open the lab (new tab)
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
          {running ? "Running & grading…" : "🚀 Run & submit for grading"}
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
