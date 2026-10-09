"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type Course, type CourseLesson } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";
import MarkdownLite from "@/components/MarkdownLite";
import Icon, { type IconName } from "@/components/Icon";

const TYPE_ICON: Record<string, IconName> = { article: "file", video: "play", lab: "labs", quiz: "quiz" };

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

export default function CoursePlayer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const courseId = Number(id);
  const t = useT();
  const [course, setCourse] = useState<Course | null>(null);
  const [flat, setFlat] = useState<{ lesson: CourseLesson; section: string }[]>([]);
  const [idx, setIdx] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getCourse(courseId)
      .then((c) => {
        setCourse(c);
        const all = (c.curriculum?.sections ?? []).flatMap((s) => s.lessons.map((lesson) => ({ lesson, section: s.title })));
        setFlat(all);
        const me = getStoredLearner();
        if (me)
          api
            .courseProgress(courseId, me.id)
            .then((p) => {
              const done = new Set(p.completed);
              setCompleted(done);
              // Open where they left off, not on lesson one every time.
              const next = all.findIndex((f) => !done.has(f.lesson.id));
              if (next > 0) setIdx(next);
            })
            .catch(() => {});
      })
      .catch((e) => setError(String(e)));
  }, [courseId]);

  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= flat.length) return;
      setIdx(i);
      setFinished(false);
      window.scrollTo({ top: 0 });
    },
    [flat.length],
  );

  // ← / → move between lessons when the reader isn't typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") go(idx + 1);
      if (e.key === "ArrowLeft") go(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, idx]);

  if (error)
    return (
      <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
        {error}
      </p>
    );
  if (!course || flat.length === 0)
    return (
      <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]" aria-busy="true">
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
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

  const current = flat[idx];
  const pct = Math.round((100 * completed.size) / flat.length);
  const prev = flat[idx - 1];
  const next = flat[idx + 1];
  const sectionIndex = course.curriculum.sections.findIndex((s) => s.title === current.section);

  async function markComplete() {
    const me = getStoredLearner();
    if (!me) return setError(t("form.hub.signIn"));
    setSaving(true);
    try {
      const p = await api.completeLesson(courseId, current.lesson.id, me.id);
      setCompleted(new Set(p.completed));
      window.dispatchEvent(new Event("dqai-learner-changed"));
      if (idx < flat.length - 1) go(idx + 1);
      else setFinished(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ---- Course bar ---------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border pb-4">
        <Link href={`/courses/${courseId}`} className="group flex min-w-0 items-center gap-2 text-sm">
          <Icon name="arrow-right" size={14} className="rotate-180 text-text-subtle group-hover:text-text" />
          <span className="text-lg" aria-hidden="true">{course.emoji}</span>
          <span className="truncate font-medium text-text group-hover:text-accent-text">{course.title}</span>
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-text-subtle tnum">{t("learn.doneOf", { done: completed.size, total: flat.length })}</span>
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

      <div className="grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* ---- Outline ----------------------------------------------------- */}
        <nav aria-label={t("course.curriculum")} className="lg:sticky lg:top-24 lg:self-start">
          <ol className="space-y-5">
            {course.curriculum.sections.map((s, si) => (
              <li key={si}>
                <p className="mb-2 text-xs font-semibold text-text-subtle">
                  <span className="mr-1.5 font-mono tnum">{String(si + 1).padStart(2, "0")}</span>
                  {s.title}
                </p>
                <ol className="relative">
                  {s.lessons.map((l, li) => {
                    const fi = flat.findIndex((f) => f.lesson.id === l.id);
                    const active = fi === idx && !finished;
                    const done = completed.has(l.id);
                    return (
                      <li key={l.id} className="relative">
                        {li < s.lessons.length - 1 && (
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
                          <span className={`leading-snug ${active ? "font-semibold" : ""}`}>{l.title}</span>
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

        {/* ---- Reading column ---------------------------------------------- */}
        <div className="min-w-0">
          {finished ? (
            <div className="mx-auto max-w-lg animate-scale-in py-10 text-center">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-good/15 text-good">
                <Icon name="trophy" size={28} />
              </span>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight">{t("learn.finishedTitle")}</h1>
              <p className="mt-2 text-text-muted">{t("learn.finishedBody", { course: course.title })}</p>
              <div className="mt-7 flex flex-wrap justify-center gap-2">
                <Link href="/courses" className="btn">
                  {t("learn.nextCourse")} <Icon name="arrow-right" size={15} />
                </Link>
                <Link href={`/courses/${courseId}`} className="btn-ghost">
                  {t("learn.backToCourse")}
                </Link>
              </div>
            </div>
          ) : (
            <article className="mx-auto max-w-[68ch]">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-subtle">
                <span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 font-medium text-accent-text">
                  <Icon name={TYPE_ICON[current.lesson.type] ?? "file"} size={11} />
                  {t(`course.type.${current.lesson.type}`, current.lesson.type)}
                </span>
                <span>{sectionIndex >= 0 ? `${String(sectionIndex + 1).padStart(2, "0")} · ` : ""}{current.section}</span>
                <span aria-hidden="true">·</span>
                <span className="tnum">{t("learn.lessonOf", { n: idx + 1, total: flat.length })}</span>
                {completed.has(current.lesson.id) && (
                  <span className="inline-flex items-center gap-1 text-good">
                    <Icon name="check" size={12} /> {t("course.completed")}
                  </span>
                )}
              </p>
              <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.025em]">{current.lesson.title}</h1>

              <div className="mt-6">
                <LessonView key={current.lesson.id} lesson={current.lesson} onPass={markComplete} />
              </div>

              {/* ---- Prev / next ----------------------------------------- */}
              <div className="mt-10 border-t border-border pt-6">
                {current.lesson.type !== "quiz" && (
                  <button type="button" className="btn mb-6 w-full justify-center py-3 text-[15px] sm:w-auto sm:px-6" onClick={markComplete} disabled={saving} aria-busy={saving}>
                    {saving ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                    ) : (
                      <Icon name="check" size={16} />
                    )}
                    {idx < flat.length - 1 ? t("learn.completeNext") : t("learn.finish")}
                  </button>
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
                    <button type="button" onClick={() => go(idx + 1)} className="group rounded-xl border border-border p-4 text-right transition-colors hover:border-border-strong hover:bg-surface">
                      <span className="flex items-center justify-end gap-1 text-xs text-text-subtle">
                        {t("learn.next")} <Icon name="arrow-right" size={12} />
                      </span>
                      <span className="mt-1 block truncate text-sm font-medium group-hover:text-accent-text">{next.lesson.title}</span>
                    </button>
                  )}
                </div>
              </div>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

function LessonView({ lesson, onPass }: { lesson: CourseLesson; onPass: () => void }) {
  const t = useT();
  const [choice, setChoice] = useState("");
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const embed = useMemo(() => (lesson.video_url ? embedUrl(lesson.video_url) : null), [lesson.video_url]);

  function checkQuiz() {
    if (choice.toLowerCase().trim() === (lesson.answer ?? "").toLowerCase().trim()) {
      setFeedback("correct");
      // A beat to see the green before the next lesson slides in.
      setTimeout(onPass, 900);
    } else {
      setFeedback("wrong");
    }
  }

  return (
    <div className="space-y-6">
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

      {lesson.body_md && (
        <div className="[&_li]:text-[15px] [&_li]:leading-7 [&_p]:text-[15px] [&_p]:leading-7">
          <MarkdownLite>{lesson.body_md}</MarkdownLite>
        </div>
      )}

      {lesson.type === "quiz" && (
        <fieldset className="space-y-3">
          <legend className="mb-3 text-lg font-semibold">{lesson.question}</legend>
          {lesson.options.map((o, i) => {
            const picked = choice === o;
            const state = picked && feedback === "correct" ? "right" : picked && feedback === "wrong" ? "wrong" : picked ? "picked" : "idle";
            return (
              <label
                key={o}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-[15px] transition-[border-color,background-color,transform] ${
                  state === "right"
                    ? "border-good bg-good/10"
                    : state === "wrong"
                      ? "animate-[shake_0.3s] border-bad bg-bad/5"
                      : state === "picked"
                        ? "border-accent bg-accent/5"
                        : "border-border hover:border-border-strong hover:bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name="quiz"
                  value={o}
                  checked={picked}
                  onChange={(e) => {
                    setChoice(e.target.value);
                    setFeedback(null);
                  }}
                  className="sr-only"
                />
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg font-mono text-xs font-semibold ${
                    state === "right" ? "bg-good text-white" : state === "wrong" ? "bg-bad text-white" : picked ? "bg-accent text-accent-fg" : "bg-surface-2 text-text-muted"
                  }`}
                  aria-hidden="true"
                >
                  {state === "right" ? <Icon name="check" size={13} strokeWidth={3} /> : String.fromCharCode(65 + i)}
                </span>
                <span className="flex-1">{o}</span>
              </label>
            );
          })}
          <div className="flex flex-wrap items-center gap-3 pt-2" aria-live="polite">
            <button type="button" className="btn" onClick={checkQuiz} disabled={!choice || feedback === "correct"}>
              {t("learn.check")}
            </button>
            {feedback === "correct" && (
              <p className="flex items-center gap-1.5 text-sm font-medium text-good">
                <Icon name="check" size={15} /> {t("learn.correct")}
              </p>
            )}
            {feedback === "wrong" && <p className="text-sm text-bad">{t("learn.wrong")}</p>}
          </div>
        </fieldset>
      )}
    </div>
  );
}
