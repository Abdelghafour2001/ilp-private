"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AssignPanel from "@/components/AssignPanel";
import { api, type Course, type CourseProgress } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { LESSON_ICON } from "@/lib/courseLessons";
import SocialSection from "@/components/SocialSection";

export default function CourseOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const courseId = Number(id);
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.getCourse(courseId).then(setCourse).catch((e) => setError(String(e)));
    const me = getStoredLearner();
    if (me) api.courseProgress(courseId, me.id).then(setProgress).catch(() => {});
  }, [courseId]);

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!course) return <p className="text-sm text-text-subtle">Loading…</p>;

  const me = getStoredLearner();
  const canEdit = course.learner_id != null && me?.id === course.learner_id;
  // The same list the server enforces in `can_curate`.
  const canAssign = ["trainer", "manager", "bu_head", "hr", "hr_lead", "admin"].includes(
    me?.role ?? "",
  );

  async function submit() {
    setSubmitting(true);
    try {
      const r = await api.submitCourse(courseId, me?.id);
      setCourse({ ...course!, status: r.status });
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSubmitting(false);
    }
  }
  // A provider entry is a link, not a curriculum: its `curriculum` is {} and
  // reading `.sections` off it crashed the whole page.
  const sections = course.curriculum?.sections ?? [];
  const totalLessons = sections.reduce((n, s) => n + s.lessons.length, 0);

  async function remove() {
    if (!confirm("Delete this course?")) return;
    await api.deleteCourse(courseId, me?.id);
    router.push("/courses");
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/courses" className="text-xs text-text-subtle hover:text-text-muted">
          ← All courses
        </Link>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-4xl">{course.emoji}</span>
            <div>
              <h1 className="text-2xl font-semibold">{course.title}</h1>
              <p className="text-xs text-text-subtle">
                by {course.author} · {course.level} · {totalLessons} lessons
              </p>
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              {course.status === "draft" && (
                <button className="btn" onClick={submit} disabled={submitting}>
                  {submitting ? "Sending…" : "Submit for review"}
                </button>
              )}
              <Link href={`/courses/${courseId}/edit`} className="btn-ghost">Edit</Link>
              <button className="btn-ghost text-bad" onClick={remove}>Delete</button>
            </div>
          )}
        </div>
        <p className="mt-3 text-text-subtle">{course.summary}</p>
        {course.status !== "published" && (
          <p className="mt-3 card border-warn/40 text-sm text-text-muted">
            {course.status === "draft"
              ? "Draft — not on the catalogue yet."
              : course.status === "pending"
                ? "Waiting for a curator to review it."
                : "Archived — off the catalogue, kept on the records of people who took it."}
            {course.review_note && (
              <span className="mt-1 block text-text-subtle">
                {course.reviewed_by}: {course.review_note}
              </span>
            )}
          </p>
        )}
      </div>

      {progress && progress.total > 0 && (
        <div className="card">
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-text-subtle">Your progress</span>
            <span className="text-accent">{progress.percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-edge">
            <div className="h-full bg-accent transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}

      {course.external_url ? (
        <a
          href={course.external_url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn inline-flex"
        >
          🎓 Open on {course.provider || "the provider"}
        </a>
      ) : (
        <Link href={`/courses/${courseId}/learn`} className="btn inline-flex">
          {progress && progress.completed.length > 0 ? "▶ Continue learning" : "▶ Start course"}
        </Link>
      )}

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-subtle">Curriculum</h2>
        {course.external_url && sections.length === 0 && (
          <p className="text-sm text-text-subtle">
            This course is followed on {course.provider || "the provider"}. Progress and the
            certificate come back from their reporting, not from lessons here.
          </p>
        )}
        {sections.map((s, i) => (
          <div key={i} className="card">
            <h3 className="font-medium">{s.title}</h3>
            <ul className="mt-2 space-y-1">
              {s.lessons.map((l) => (
                <li key={l.id} className="flex items-center gap-2 text-sm text-text-muted">
                  <span>{LESSON_ICON[l.type] ?? "•"}</span>
                  {l.title}
                  {progress?.completed.includes(l.id) && <span className="text-good">✓</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* comments, likes & shares */}
      <SocialSection etype="course" eid={courseId} />
      {/* Hand it out, and see who has it already — the panel carries both.
          Only the people who may assign see it; for everybody else it is a
          form that would be refused by the server anyway. */}
      {canAssign && <AssignPanel entityType="course" entityId={courseId} onAssigned={() => {}} />}
    </div>
  );
}
