"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AssignPanel from "@/components/AssignPanel";
import { api, type Course, type CourseProgress } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import CourseCover from "@/components/CourseCover";
import Icon, { type IconName } from "@/components/Icon";
import { useT } from "@/lib/i18n";
import SocialSection from "@/components/SocialSection";

const LESSON_ICON: Record<string, IconName> = {
  article: "file",
  video: "play",
  lab: "labs",
  quiz: "quiz",
};

const LEVEL_DOT: Record<string, string> = {
  beginner: "bg-good",
  intermediate: "bg-warn",
  advanced: "bg-bad",
};

export default function CourseOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const courseId = Number(id);
  const router = useRouter();
  const t = useT();
  const [course, setCourse] = useState<Course | null>(null);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.getCourse(courseId).then(setCourse).catch((e) => setError(String(e)));
    const me = getStoredLearner();
    if (me) api.courseProgress(courseId, me.id).then(setProgress).catch(() => {});
  }, [courseId]);

  if (error)
    return (
      <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
        {error}
      </p>
    );
  if (!course)
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="h-4 w-24 skeleton" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-3">
            <div className="h-10 w-2/3 skeleton" />
            <div className="h-4 w-full skeleton" />
            <div className="h-4 w-4/5 skeleton" />
          </div>
          <div className="aspect-[16/10] skeleton rounded-xl" />
        </div>
      </div>
    );

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
    if (!confirm(t("course.confirmDelete"))) return;
    await api.deleteCourse(courseId, me?.id);
    router.push("/courses");
  }

  const done = new Set(progress?.completed ?? []);
  const started = done.size > 0;
  const pct = progress?.percent ?? 0;
  // The next lesson not yet done, so "Continue" says where it goes.
  const nextLesson = sections.flatMap((sec) => sec.lessons).find((l) => !done.has(l.id));

  const cta = course.external_url ? (
    <a href={course.external_url} target="_blank" rel="noopener noreferrer" className="btn px-4 py-2.5">
      {t("courses.openOn", { provider: course.provider || t("courses.external") })}
      <Icon name="external" size={15} />
    </a>
  ) : (
    <Link href={`/courses/${courseId}/learn`} className="btn px-4 py-2.5">
      <Icon name="play" size={16} />
      {started ? t("course.continue") : t("courses.start")}
    </Link>
  );

  return (
    <div className="space-y-10">
      {/* ---- Header ------------------------------------------------------ */}
      <header>
        <Link
          href="/courses"
          className="inline-flex items-center gap-1 text-sm text-text-subtle hover:text-text"
        >
          <Icon name="arrow-right" size={14} className="rotate-180" /> {t("course.back")}
        </Link>

        <div className="mt-5 grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-subtle">
              <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[course.level] ?? "bg-text-subtle"}`} aria-hidden="true" />
              <span className="capitalize">{t(`common.${course.level}`, course.level)}</span>
              {totalLessons > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tnum">{t("course.lessons", { n: totalLessons })}</span>
                </>
              )}
              {course.external_hours > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tnum">{course.external_hours}&nbsp;h</span>
                </>
              )}
              {course.provider && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{course.provider}</span>
                </>
              )}
            </p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.03em] sm:text-4xl">
              {course.title}
            </h1>
            {course.summary && (
              <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-text-muted">{course.summary}</p>
            )}
            <p className="mt-4 text-sm text-text-subtle">
              {t("common.by")} <span className="font-medium text-text-muted">{course.author}</span>
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              {cta}
              {canEdit && (
                <>
                  {course.status === "draft" && (
                    <button className="btn-ghost" onClick={submit} disabled={submitting}>
                      {submitting ? t("course.sending") : t("course.submit")}
                    </button>
                  )}
                  <Link href={`/courses/${courseId}/edit`} className="btn-ghost">
                    <Icon name="pencil" size={15} /> {t("course.edit")}
                  </Link>
                  <button
                    className="btn-icon hover:border-bad/40 hover:text-bad"
                    onClick={remove}
                    aria-label={t("course.delete")}
                    title={t("course.delete")}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border shadow-sm">
            <CourseCover
              coverUrl={course.cover_url}
              provider={course.provider}
              emoji={course.emoji}
              className="aspect-[16/10] rounded-none"
            />
          </div>
        </div>

        {course.status !== "published" && (
          <div className="mt-6 flex gap-3 rounded-xl border border-warn/40 bg-warn/5 px-4 py-3 text-sm">
            <Icon name="clock" size={16} className="mt-0.5 shrink-0 text-warn" />
            <div>
              <p className="text-text">
                {course.status === "draft"
                  ? t("course.status.draft")
                  : course.status === "pending"
                    ? t("course.status.pending")
                    : t("course.status.archived")}
              </p>
              {course.review_note && (
                <p className="mt-1 text-text-muted">
                  <span className="font-medium">{course.reviewed_by}:</span> {course.review_note}
                </p>
              )}
            </div>
          </div>
        )}
      </header>

      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ---- Curriculum ------------------------------------------------- */}
        <section className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base font-semibold">{t("course.curriculum")}</h2>
            {totalLessons > 0 && progress && (
              <span className="text-xs text-text-subtle tnum">
                {t("course.doneOf", { done: done.size, total: totalLessons })}
              </span>
            )}
          </div>

          {course.external_url && sections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-strong px-5 py-6 text-sm leading-relaxed text-text-muted">
              {t("course.externalNote", { provider: course.provider || t("courses.external") })}
            </div>
          ) : (
            <div className="panel overflow-hidden">
              {sections.map((sec, i) => (
                <div key={i} className={i > 0 ? "border-t border-border" : ""}>
                  <div className="flex items-baseline gap-3 bg-surface-2/60 px-5 py-3">
                    <span className="font-mono text-xs text-text-subtle tnum">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-sm font-semibold">{sec.title}</h3>
                    <span className="ml-auto text-xs text-text-subtle tnum">
                      {sec.lessons.filter((l) => done.has(l.id)).length}/{sec.lessons.length}
                    </span>
                  </div>
                  <ol>
                    {sec.lessons.map((l) => {
                      const isDone = done.has(l.id);
                      const isNext = !course.external_url && nextLesson?.id === l.id && started;
                      return (
                        <li
                          key={l.id}
                          className={`flex items-center gap-3 border-t border-border px-5 py-3 text-sm ${
                            isNext ? "bg-accent/5" : ""
                          }`}
                        >
                          <span
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                              isDone ? "bg-good/15 text-good" : "bg-surface-2 text-text-subtle"
                            }`}
                          >
                            <Icon name={isDone ? "check" : (LESSON_ICON[l.type] ?? "file")} size={14} />
                          </span>
                          <span className={`min-w-0 flex-1 truncate ${isDone ? "text-text-muted" : "text-text"}`}>
                            {l.title}
                          </span>
                          {isNext && (
                            <Link href={`/courses/${courseId}/learn`} className="link shrink-0 text-xs">
                              {t("course.upNext")} →
                            </Link>
                          )}
                          <span className="shrink-0 text-xs capitalize text-text-subtle">
                            {t(`course.type.${l.type}`, l.type)}
                          </span>
                          {isDone && <span className="sr-only">{t("course.completed")}</span>}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---- Aside ------------------------------------------------------ */}
        <aside className="min-w-0 space-y-8">
          {progress && progress.total > 0 && (
            <section className="panel p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{t("course.progress")}</h2>
                <span className="text-2xl font-semibold tracking-tight tnum">{pct}%</span>
              </div>
              <div
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3"
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
              <p className="mt-3 text-sm text-text-muted">
                {pct === 100
                  ? t("course.allDone")
                  : nextLesson
                    ? t("course.nextIs", { title: nextLesson.title })
                    : t("course.notStarted")}
              </p>
            </section>
          )}

        </aside>
      </div>

      {/* Hand it out, and see who has it already — the panel carries both.
          Only the people who may assign see it; for everybody else it is a
          form that would be refused by the server anyway. */}
      {canAssign && <AssignPanel entityType="course" entityId={courseId} onAssigned={() => {}} />}

      {/* comments, likes & shares */}
      <section className="border-t border-border pt-8">
        <h2 className="mb-4 text-base font-semibold">{t("course.discussion")}</h2>
        <SocialSection etype="course" eid={courseId} />
      </section>
    </div>
  );
}
