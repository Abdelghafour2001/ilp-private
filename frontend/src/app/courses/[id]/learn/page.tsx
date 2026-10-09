"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type Course, type CourseLesson } from "@/lib/api";
import { getStoredLearner, claimHandle } from "@/lib/learner";
import MarkdownLite from "@/components/MarkdownLite";
import { LESSON_ICON } from "@/lib/courseLessons";

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
  const [course, setCourse] = useState<Course | null>(null);
  const [flat, setFlat] = useState<{ lesson: CourseLesson; section: string }[]>([]);
  const [idx, setIdx] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getCourse(courseId).then((c) => {
      setCourse(c);
      setFlat(
        c.curriculum.sections.flatMap((s) =>
          s.lessons.map((lesson) => ({ lesson, section: s.title })),
        ),
      );
    }).catch((e) => setError(String(e)));
    const me = getStoredLearner();
    if (me) api.courseProgress(courseId, me.id).then((p) => setCompleted(new Set(p.completed))).catch(() => {});
  }, [courseId]);

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!course || flat.length === 0) return <p className="text-sm text-text-subtle">Loading…</p>;

  const current = flat[idx];

  async function markComplete() {
    let me = getStoredLearner();
    if (!me) {
      const h = prompt("Pick a handle to save your progress:");
      if (!h || h.trim().length < 2) return;
      me = await claimHandle(h);
    }
    const p = await api.completeLesson(courseId, current.lesson.id, me.id);
    setCompleted(new Set(p.completed));
    window.dispatchEvent(new Event("dqai-learner-changed"));
    if (idx < flat.length - 1) setIdx(idx + 1);
  }

  return (
    <div className="space-y-4">
      <Link href={`/courses/${courseId}`} className="text-xs text-text-subtle hover:text-text-muted">
        ← {course.title}
      </Link>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Curriculum sidebar */}
        <nav className="space-y-3">
          {course.curriculum.sections.map((s, si) => (
            <div key={si}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-subtle">{s.title}</p>
              <div className="space-y-1">
                {s.lessons.map((l) => {
                  const fi = flat.findIndex((f) => f.lesson.id === l.id);
                  const active = fi === idx;
                  return (
                    <button
                      key={l.id}
                      onClick={() => setIdx(fi)}
                      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                        active ? "border-accent bg-accent/10" : "border-edge hover:bg-edge"
                      }`}
                    >
                      <span>{completed.has(l.id) ? "✅" : LESSON_ICON[l.type] ?? "•"}</span>
                      <span className="truncate">{l.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Lesson content */}
        <div className="space-y-4">
          <LessonView key={current.lesson.id} lesson={current.lesson} onPass={markComplete} />

          <div className="flex items-center justify-between border-t border-edge pt-4">
            <button className="btn-ghost" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}>
              ← Prev
            </button>
            <span className="text-xs text-text-subtle">
              {idx + 1} / {flat.length}
            </span>
            {current.lesson.type === "quiz" ? (
              <span className="text-xs text-text-subtle">answer to continue</span>
            ) : (
              <button className="btn" onClick={markComplete}>
                {idx < flat.length - 1 ? "Complete & next →" : "Finish 🎉"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LessonView({ lesson, onPass }: { lesson: CourseLesson; onPass: () => void }) {
  const [choice, setChoice] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const embed = useMemo(() => (lesson.video_url ? embedUrl(lesson.video_url) : null), [lesson.video_url]);

  function checkQuiz() {
    if (choice.toLowerCase().trim() === (lesson.answer ?? "").toLowerCase().trim()) {
      setFeedback("correct");
      onPass();
    } else {
      setFeedback("wrong");
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <span className="badge bg-edge text-text-subtle">{lesson.type}</span>
      </div>
      <h1 className="text-xl font-semibold">{lesson.title}</h1>

      {lesson.type === "video" && lesson.video_url && (
        embed ? (
          <div className="aspect-video w-full overflow-hidden rounded-lg border border-edge">
            <iframe src={embed} className="h-full w-full" allowFullScreen title={lesson.title} />
          </div>
        ) : (
          <a href={lesson.video_url} target="_blank" rel="noopener noreferrer" className="btn inline-flex">
            🎬 Watch video
          </a>
        )
      )}

      {lesson.type === "lab" && lesson.lab_id && (
        <Link href={`/labs/${lesson.lab_id}`} target="_blank" className="btn inline-flex">
          🧪 Open the lab (new tab)
        </Link>
      )}

      {lesson.body_md && <MarkdownLite>{lesson.body_md}</MarkdownLite>}

      {lesson.type === "quiz" && (
        <div className="space-y-2">
          <p className="font-medium">{lesson.question}</p>
          {lesson.options.map((o) => (
            <label
              key={o}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                choice === o ? "border-accent bg-accent/10" : "border-edge hover:bg-edge"
              }`}
            >
              <input type="radio" name="quiz" value={o} checked={choice === o} onChange={(e) => setChoice(e.target.value)} />
              {o}
            </label>
          ))}
          <button className="btn" onClick={checkQuiz} disabled={!choice}>
            Check answer
          </button>
          {feedback === "correct" && <p className="text-sm text-good">✓ Correct!</p>}
          {feedback === "wrong" && <p className="text-sm text-bad">Not quite — try again.</p>}
        </div>
      )}
    </div>
  );
}
