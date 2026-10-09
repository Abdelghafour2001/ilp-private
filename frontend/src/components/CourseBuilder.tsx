"use client";

/**
 * Create or edit a course, in two steps.
 *
 *   1. Details — what the catalogue card will say, with the card itself
 *      rendered live beside the form, and the one real fork: is the content
 *      built here, or does it live on Coursera & co.?
 *   2. Content — sections of lessons. Each lesson is a row that opens into the
 *      editor its type needs: markdown for an article, a link (with its
 *      thumbnail) for a video, a lab from the real lab list, and a quiz whose
 *      correct answer is a radio on the option rather than a retyped string
 *      that had to match it character for character.
 *
 * The saved shape is unchanged: the editor converts on the way in and out.
 */

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, type ContentStatus, type Course, type LabSummary } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";
import Icon, { type IconName } from "@/components/Icon";
import CourseCover from "@/components/CourseCover";
import Field, { FormSection, Segmented } from "@/components/form/Field";
import EmojiPicker from "@/components/form/EmojiPicker";
import MarkdownField from "@/components/form/MarkdownField";
import TagInput from "@/components/form/TagInput";
import { usePopularTags } from "@/components/form/usePopularTags";

type LessonType = "article" | "video" | "lab" | "quiz";

interface ELesson {
  id: string;
  title: string;
  type: LessonType;
  body_md: string;
  video_url: string;
  lab_id: string;
  question: string;
  options: string[];
  /** Index into `options` of the right answer, or -1. */
  answer: number;
}
interface ESection {
  key: string;
  title: string;
  lessons: ELesson[];
}
interface Meta {
  title: string;
  summary: string;
  level: string;
  emoji: string;
  tags: string[];
  status: ContentStatus;
  external_url: string;
  provider: string;
}

const TYPE_ICON: Record<LessonType, IconName> = { article: "file", video: "play", lab: "labs", quiz: "quiz" };
const PROVIDERS = ["Coursera", "Udemy", "LinkedIn Learning", "DataCamp", "edX"];
const LEVEL_DOT: Record<string, string> = { beginner: "bg-good", intermediate: "bg-warn", advanced: "bg-bad" };

const rid = () => Math.random().toString(36).slice(2, 8);
const newLesson = (type: LessonType = "article"): ELesson => ({
  id: `l${rid()}`,
  title: "",
  type,
  body_md: "",
  video_url: "",
  lab_id: "",
  question: "",
  options: ["", ""],
  answer: -1,
});

function fromCourse(c: Course): { meta: Meta; sections: ESection[] } {
  return {
    meta: {
      title: c.title,
      summary: c.summary,
      level: c.level,
      emoji: c.emoji,
      tags: c.tags,
      status: c.status,
      external_url: c.external_url ?? "",
      provider: c.provider ?? "",
    },
    sections: (c.curriculum?.sections ?? []).map((s) => ({
      key: rid(),
      title: s.title,
      lessons: s.lessons.map((l) => {
        const options = l.options ?? [];
        return {
          ...newLesson(),
          id: l.id,
          title: l.title,
          type: (l.type as LessonType) ?? "article",
          body_md: l.body_md ?? "",
          video_url: l.video_url ?? "",
          lab_id: l.lab_id ?? "",
          question: l.question ?? "",
          options: options.length ? options : ["", ""],
          answer: l.answer ? options.indexOf(l.answer) : -1,
        };
      }),
    })),
  };
}

/** YouTube's still for a watch/short/embed link, so the author sees it worked. */
function youtubeThumb(url: string) {
  const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
  return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : null;
}

function move<T>(arr: T[], from: number, to: number) {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export default function CourseBuilder({
  initial,
  back,
  title,
  lede,
}: {
  initial?: Course;
  back: { href: string; label: string };
  title: string;
  lede?: string;
}) {
  const router = useRouter();
  const t = useT();
  const seed = initial
    ? fromCourse(initial)
    : {
        meta: { title: "", summary: "", level: "beginner", emoji: "📚", tags: [], status: "draft" as ContentStatus, external_url: "", provider: "" },
        sections: [{ key: rid(), title: t("cb.firstSection"), lessons: [newLesson()] }] as ESection[],
      };
  const [meta, setMeta] = useState<Meta>(seed.meta);
  const [sections, setSections] = useState<ESection[]>(seed.sections);
  // External or built here: decided up front, because it decides whether
  // there is a step 2 at all.
  const [external, setExternal] = useState(!!seed.meta.external_url);
  // New courses start on the "Details" step; edits jump straight to content.
  const [step, setStep] = useState<1 | 2>(initial && !seed.meta.external_url ? 2 : 1);
  const [open, setOpen] = useState<string | null>(seed.sections[0]?.lessons[0]?.id ?? null);
  const [labs, setLabs] = useState<LabSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popular = usePopularTags(() => api.listCourses());

  useEffect(() => {
    api.listLabs().then(setLabs).catch(() => {});
  }, []);

  const patchMeta = (p: Partial<Meta>) => setMeta((m) => ({ ...m, ...p }));
  const patchSection = (si: number, p: Partial<ESection>) =>
    setSections((cur) => cur.map((s, i) => (i === si ? { ...s, ...p } : s)));
  const patchLesson = (si: number, li: number, p: Partial<ELesson>) =>
    setSections((cur) =>
      cur.map((s, i) => (i === si ? { ...s, lessons: s.lessons.map((l, j) => (j === li ? { ...l, ...p } : l)) } : s)),
    );

  function build() {
    return {
      title: meta.title.trim(),
      summary: meta.summary.trim(),
      level: meta.level,
      emoji: meta.emoji || "📚",
      tags: meta.tags,
      external_url: external ? meta.external_url.trim() : "",
      provider: external ? meta.provider.trim() : "",
      curriculum: {
        sections: external
          ? []
          : sections.map((s) => ({
              title: s.title,
              lessons: s.lessons.map((l) => {
                const options = l.options.map((o) => o.trim()).filter(Boolean);
                return {
                  id: l.id,
                  title: l.title,
                  type: l.type,
                  body_md: l.body_md,
                  video_url: l.video_url || null,
                  lab_id: l.lab_id || null,
                  question: l.question || null,
                  options: l.type === "quiz" ? options : [],
                  answer: l.type === "quiz" && l.answer >= 0 ? l.options[l.answer]?.trim() || null : null,
                };
              }),
            })),
      },
    };
  }

  async function save() {
    const me = getStoredLearner();
    if (!me) return setError(t("form.hub.signIn"));
    setBusy(true);
    setError(null);
    try {
      const body = { ...build(), learner_id: me.id, author: me.handle };
      const course = initial ? await api.updateCourse(initial.id, body, me.id) : await api.createCourse(body);
      router.push(`/courses/${course.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  // ---- What blocks each step, named -----------------------------------
  const urlOk = /^https?:\/\/\S+\.\S+/.test(meta.external_url.trim());
  const detailsBlocker = !meta.title.trim()
    ? t("cb.need.title")
    : external && !urlOk
      ? t("cb.need.url")
      : null;
  const allLessons = sections.flatMap((s) => s.lessons);
  const lessonProblem = (l: ELesson): string | null => {
    if (!l.title.trim()) return t("cb.need.lessonTitle");
    if (l.type === "quiz") {
      if (!l.question.trim()) return t("cb.need.question");
      if (l.options.filter((o) => o.trim()).length < 2) return t("cb.need.options");
      if (l.answer < 0 || !l.options[l.answer]?.trim()) return t("cb.need.answer");
    }
    if (l.type === "lab" && !l.lab_id) return t("cb.need.lab");
    if (l.type === "video" && !/^https?:\/\//.test(l.video_url)) return t("cb.need.video");
    return null;
  };
  const firstBad = allLessons.find((l) => lessonProblem(l));
  const contentBlocker = detailsBlocker ?? (allLessons.length === 0 ? t("cb.need.oneLesson") : firstBad ? lessonProblem(firstBad) : null);
  const counts = allLessons.reduce<Record<string, number>>((acc, l) => ((acc[l.type] = (acc[l.type] ?? 0) + 1), acc), {});

  const card = (
    <article>
      <div className="overflow-hidden rounded-xl border border-border shadow-sm">
        <CourseCover provider={external ? meta.provider : ""} emoji={meta.emoji || "📚"} className="aspect-[16/9] rounded-none" />
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-text-subtle">
        <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[meta.level]}`} />
        <span className="capitalize">{t(`common.${meta.level}`, meta.level)}</span>
        {external && meta.provider && (
          <>
            <span>·</span>
            <span>{meta.provider} ↗</span>
          </>
        )}
        {!external && allLessons.length > 0 && (
          <>
            <span>·</span>
            <span className="tnum">{t("course.lessons", { n: allLessons.length })}</span>
          </>
        )}
      </p>
      <h3 className={`mt-1 font-semibold leading-snug ${meta.title ? "text-text" : "text-text-subtle"}`}>
        {meta.title || t("cb.titlePh")}
      </h3>
      <p className="mt-1 line-clamp-2 text-sm text-text-muted">{meta.summary || t("cb.summaryPh")}</p>
      {meta.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {meta.tags.map((tag) => (
            <span key={tag} className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">{tag}</span>
          ))}
        </div>
      )}
    </article>
  );

  const steps = external ? [{ n: 1 as const, label: t("cb.step.details") }] : [
    { n: 1 as const, label: t("cb.step.details") },
    { n: 2 as const, label: t("cb.step.content") },
  ];

  return (
    <div className="space-y-8">
      <header>
        <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-text-subtle hover:text-text">
          <Icon name="arrow-right" size={14} className="rotate-180" /> {back.label}
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em]">{title}</h1>
            {lede && <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-text-muted">{lede}</p>}
          </div>
          <ol className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1" aria-label={t("cb.steps")}>
            {steps.map(({ n, label }) => {
              const reachable = n === 1 || !detailsBlocker;
              const on = step === n;
              return (
                <li key={n}>
                  <button
                    type="button"
                    disabled={!reachable}
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

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          {step === 1 ? (
            <div className="panel p-6 sm:p-7">
              <FormSection step={1} title={t("cb.s.card")} lede={t("cb.s.cardLede")}>
                <Field id="cb-title" label={t("cb.f.title")} count={meta.title.length} max={70}>
                  <div className="flex gap-2">
                    <EmojiPicker id="cb-emoji" value={meta.emoji} onChange={(emoji) => patchMeta({ emoji })} />
                    <input
                      id="cb-title"
                      name="title"
                      className="input py-2.5 text-base font-medium"
                      autoComplete="off"
                      autoFocus={!initial}
                      placeholder={t("cb.titlePh")}
                      value={meta.title}
                      onChange={(e) => patchMeta({ title: e.target.value })}
                    />
                  </div>
                </Field>
                <Field id="cb-summary" label={t("cb.f.summary")} hint={t("cb.f.summaryHint")} count={meta.summary.length} max={140}>
                  <input id="cb-summary" name="summary" className="input" autoComplete="off" placeholder={t("cb.summaryPh")} value={meta.summary} onChange={(e) => patchMeta({ summary: e.target.value })} />
                </Field>
                <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
                  <div>
                    <p className="mb-1.5 text-sm font-medium">{t("cb.f.level")}</p>
                    <Segmented
                      label={t("cb.f.level")}
                      value={meta.level as "beginner"}
                      onChange={(level) => patchMeta({ level })}
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
                  <Field id="cb-tags" label={t("cb.f.tags")} optional>
                    <TagInput id="cb-tags" value={meta.tags} onChange={(tags) => patchMeta({ tags })} suggestions={popular} />
                  </Field>
                </div>
              </FormSection>

              <FormSection step={2} title={t("cb.s.where")} lede={t("cb.s.whereLede")}>
                <div role="radiogroup" aria-label={t("cb.s.where")} className="grid gap-3 sm:grid-cols-2">
                  <ChoiceCard on={!external} onClick={() => setExternal(false)} icon="formations" title={t("cb.here")} body={t("cb.hereBody")} />
                  <ChoiceCard on={external} onClick={() => setExternal(true)} icon="external" title={t("cb.ext")} body={t("cb.extBody")} />
                </div>
                {external && (
                  <div className="space-y-5 animate-fade-in">
                    <Field id="cb-url" label={t("cb.f.url")} error={meta.external_url && !urlOk ? t("sess.new.badUrl") : null}>
                      <input
                        id="cb-url"
                        name="external_url"
                        type="url"
                        inputMode="url"
                        className="input"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="https://www.coursera.org/learn/…"
                        value={meta.external_url}
                        onChange={(e) => {
                          const v = e.target.value;
                          // Name the platform from the link when it is obvious.
                          const guess = PROVIDERS.find((p) => v.toLowerCase().includes(p.split(" ")[0].toLowerCase()));
                          patchMeta({ external_url: v, ...(guess && !meta.provider ? { provider: guess } : {}) });
                        }}
                      />
                    </Field>
                    <Field id="cb-provider" label={t("cb.f.provider")}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {PROVIDERS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            aria-pressed={meta.provider === p}
                            onClick={() => patchMeta({ provider: p })}
                            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                              meta.provider === p ? "border-accent bg-accent/10 font-medium text-accent-text" : "border-border text-text-muted hover:border-border-strong hover:text-text"
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                        <input
                          id="cb-provider"
                          className="input h-[2.125rem] w-36 py-1 text-sm"
                          placeholder={t("chal.new.otherTheme")}
                          value={PROVIDERS.includes(meta.provider) ? "" : meta.provider}
                          onChange={(e) => patchMeta({ provider: e.target.value })}
                        />
                      </div>
                    </Field>
                  </div>
                )}
              </FormSection>

              <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-text-muted">
                <Icon name="clock" size={14} className="mt-px shrink-0 text-text-subtle" />
                {t(`cb.status.${meta.status}`)}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {sections.map((s, si) => (
                <section key={s.key} className="panel overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2.5">
                    <span className="font-mono text-xs text-text-subtle tnum">{String(si + 1).padStart(2, "0")}</span>
                    <input
                      aria-label={t("cb.sectionTitle")}
                      className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-sm font-semibold outline-none hover:bg-surface focus:bg-surface focus:ring-2 focus:ring-accent/25"
                      value={s.title}
                      placeholder={t("cb.sectionTitle")}
                      onChange={(e) => patchSection(si, { title: e.target.value })}
                    />
                    <IconBtn label={t("cb.moveUp")} icon="chevron-down" className="rotate-180" disabled={si === 0} onClick={() => setSections((c) => move(c, si, si - 1))} />
                    <IconBtn label={t("cb.moveDown")} icon="chevron-down" disabled={si === sections.length - 1} onClick={() => setSections((c) => move(c, si, si + 1))} />
                    <IconBtn
                      label={t("cb.removeSection")}
                      icon="trash"
                      danger
                      onClick={() => {
                        if (s.lessons.some((l) => l.title || l.body_md) && !confirm(t("cb.confirmRemoveSection"))) return;
                        setSections((c) => c.filter((_, i) => i !== si));
                      }}
                    />
                  </div>

                  <ol className="divide-y divide-border">
                    {s.lessons.map((l, li) => {
                      const isOpen = open === l.id;
                      const problem = lessonProblem(l);
                      return (
                        <li key={l.id} className={isOpen ? "bg-surface" : ""}>
                          <div className="flex items-center gap-2 px-4 py-2.5">
                            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${problem ? "bg-surface-2 text-text-subtle" : "bg-accent/10 text-accent-text"}`}>
                              <Icon name={TYPE_ICON[l.type]} size={14} />
                            </span>
                            <input
                              aria-label={t("cb.lessonTitle")}
                              className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-sm outline-none hover:bg-surface-2 focus:bg-surface-2 focus:ring-2 focus:ring-accent/25"
                              placeholder={t("cb.lessonTitlePh")}
                              value={l.title}
                              onChange={(e) => patchLesson(si, li, { title: e.target.value })}
                              onFocus={() => setOpen(l.id)}
                            />
                            {problem && !isOpen && <span className="hidden text-xs text-warn sm:inline">{problem}</span>}
                            <IconBtn label={t("cb.moveUp")} icon="chevron-down" className="rotate-180" disabled={li === 0} onClick={() => patchSection(si, { lessons: move(s.lessons, li, li - 1) })} />
                            <IconBtn label={t("cb.moveDown")} icon="chevron-down" disabled={li === s.lessons.length - 1} onClick={() => patchSection(si, { lessons: move(s.lessons, li, li + 1) })} />
                            <IconBtn label={t("cb.removeLesson")} icon="trash" danger onClick={() => patchSection(si, { lessons: s.lessons.filter((_, j) => j !== li) })} />
                            <button
                              type="button"
                              onClick={() => setOpen(isOpen ? null : l.id)}
                              aria-expanded={isOpen}
                              aria-label={isOpen ? t("cb.collapse") : t("cb.expand")}
                              className="grid h-7 w-7 place-items-center rounded-md text-text-subtle hover:bg-surface-2 hover:text-text"
                            >
                              <Icon name="chevron-down" size={15} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
                            </button>
                          </div>

                          {isOpen && (
                            <div className="space-y-4 border-t border-dashed border-border px-4 pb-5 pt-4 sm:pl-[3.25rem]">
                              <Segmented
                                label={t("cb.lessonType")}
                                value={l.type}
                                onChange={(type) => patchLesson(si, li, { type })}
                                options={(["article", "video", "lab", "quiz"] as const).map((ty) => ({
                                  value: ty,
                                  label: (
                                    <span className="inline-flex items-center gap-1.5">
                                      <Icon name={TYPE_ICON[ty]} size={14} /> {t(`course.type.${ty}`)}
                                    </span>
                                  ),
                                }))}
                              />
                              <LessonEditor lesson={l} labs={labs} onChange={(p) => patchLesson(si, li, p)} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>

                  <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5">
                    <span className="mr-1 text-xs text-text-subtle">{t("cb.add")}</span>
                    {(["article", "video", "lab", "quiz"] as const).map((ty) => (
                      <button
                        key={ty}
                        type="button"
                        onClick={() => {
                          const l = newLesson(ty);
                          patchSection(si, { lessons: [...s.lessons, l] });
                          setOpen(l.id);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border-strong px-2 py-1 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent-text"
                      >
                        <Icon name={TYPE_ICON[ty]} size={12} /> {t(`course.type.${ty}`)}
                      </button>
                    ))}
                  </div>
                </section>
              ))}

              <button
                type="button"
                onClick={() => {
                  const l = newLesson();
                  setSections((c) => [...c, { key: rid(), title: t("cb.newSection"), lessons: [l] }]);
                  setOpen(l.id);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-strong py-4 text-sm font-medium text-text-muted transition-colors hover:border-accent hover:text-accent-text"
              >
                <Icon name="plus" size={16} /> {t("cb.addSection")}
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
              {error}
            </p>
          )}

          <div className="sticky bottom-0 z-10 -mx-1 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg/90 px-4 py-3 backdrop-blur-md">
            <p className="flex items-center gap-2 text-sm text-text-muted" aria-live="polite">
              {(step === 1 ? detailsBlocker : contentBlocker) ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" />
                  {step === 1 ? detailsBlocker : contentBlocker}
                </>
              ) : (
                <>
                  <Icon name="check" size={15} className="text-good" />
                  {step === 1 && !external ? t("cb.nextContent") : t("create.ready")}
                </>
              )}
            </p>
            <div className="flex gap-2">
              {step === 2 && (
                <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
                  <Icon name="arrow-right" size={15} className="rotate-180" /> {t("cb.step.details")}
                </button>
              )}
              {step === 1 && !external ? (
                <button type="button" className="btn" disabled={!!detailsBlocker} onClick={() => setStep(2)}>
                  {t("cb.toContent")} <Icon name="arrow-right" size={15} />
                </button>
              ) : (
                <button type="button" className="btn" disabled={busy || !!(step === 1 ? detailsBlocker : contentBlocker)} onClick={save} aria-busy={busy}>
                  {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
                  {busy ? t("common.saving", "Saving…") : initial ? t("cb.saveChanges") : t("cb.saveDraft")}
                </button>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-subtle">
              <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" /> {t("create.preview")}
            </p>
            <div aria-hidden="true" className="pointer-events-none select-none">{card}</div>
          </div>
          {step === 2 && (
            <div className="panel p-4">
              <p className="mb-3 text-sm font-semibold">{t("cb.outline")}</p>
              <ol className="space-y-2.5 text-sm">
                {sections.map((s) => (
                  <li key={s.key}>
                    <p className="truncate font-medium">{s.title || t("cb.sectionTitle")}</p>
                    <ul className="mt-1 space-y-1 border-l border-border pl-3">
                      {s.lessons.map((l) => (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() => setOpen(l.id)}
                            className={`flex w-full items-center gap-1.5 truncate text-left text-xs hover:text-text ${open === l.id ? "text-accent-text" : "text-text-muted"}`}
                          >
                            <Icon name={TYPE_ICON[l.type]} size={11} className="shrink-0" />
                            <span className="truncate">{l.title || t("cb.untitled")}</span>
                            {lessonProblem(l) && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-label={lessonProblem(l) ?? ""} />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
              <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-text-subtle tnum">
                {(["article", "video", "lab", "quiz"] as const).filter((ty) => counts[ty]).map((ty) => (
                  <span key={ty} className="inline-flex items-center gap-1">
                    <Icon name={TYPE_ICON[ty]} size={11} /> {counts[ty]} {t(`course.type.${ty}`).toLowerCase()}
                  </span>
                ))}
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function ChoiceCard({ on, onClick, icon, title, body }: { on: boolean; onClick: () => void; icon: IconName; title: string; body: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-[border-color,background-color,box-shadow] ${
        on ? "border-accent bg-accent/5 ring-1 ring-accent/30" : "border-border hover:border-border-strong"
      }`}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${on ? "bg-accent text-accent-fg" : "bg-surface-2 text-text-muted"}`}>
        <Icon name={icon} size={17} />
      </span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{body}</span>
      </span>
    </button>
  );
}

function IconBtn({
  label,
  icon,
  onClick,
  disabled,
  danger,
  className = "",
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-subtle transition-colors disabled:opacity-30 ${
        danger ? "hover:bg-bad/10 hover:text-bad" : "hover:bg-surface-2 hover:text-text"
      }`}
    >
      <Icon name={icon} size={14} className={className} />
    </button>
  );
}

function LessonEditor({ lesson: l, labs, onChange }: { lesson: ELesson; labs: LabSummary[]; onChange: (p: Partial<ELesson>) => void }) {
  const t = useT();
  const id = `le-${l.id}`;
  const thumb = l.type === "video" ? youtubeThumb(l.video_url) : null;

  let body: ReactNode = null;
  if (l.type === "video") {
    body = (
      <Field id={`${id}-url`} label={t("cb.f.videoUrl")} hint={t("cb.f.videoHint")}>
        <div className="flex gap-3">
          <input
            id={`${id}-url`}
            type="url"
            inputMode="url"
            className="input"
            spellCheck={false}
            placeholder="https://www.youtube.com/watch?v=…"
            value={l.video_url}
            onChange={(e) => onChange({ video_url: e.target.value })}
          />
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" width={96} height={54} className="h-[54px] w-24 shrink-0 rounded-md border border-border object-cover" />
          )}
        </div>
      </Field>
    );
  } else if (l.type === "lab") {
    body = (
      <Field id={`${id}-lab`} label={t("cb.f.lab")} hint={labs.length ? undefined : t("cb.f.labHint")}>
        {labs.length ? (
          <select id={`${id}-lab`} className="input" value={l.lab_id} onChange={(e) => onChange({ lab_id: e.target.value })}>
            <option value="">{t("cb.f.pickLab")}</option>
            {labs.map((lab) => (
              <option key={lab.id} value={lab.id}>
                {lab.title} · {lab.step_count} steps · {lab.total_xp} XP
              </option>
            ))}
          </select>
        ) : (
          <input id={`${id}-lab`} className="input font-mono text-sm" spellCheck={false} placeholder="python-basics" value={l.lab_id} onChange={(e) => onChange({ lab_id: e.target.value })} />
        )}
      </Field>
    );
  } else if (l.type === "quiz") {
    const setOpt = (i: number, v: string) => onChange({ options: l.options.map((o, j) => (j === i ? v : o)) });
    body = (
      <>
        <Field id={`${id}-q`} label={t("cb.f.question")}>
          <input id={`${id}-q`} className="input" placeholder={t("cb.f.questionPh")} value={l.question} onChange={(e) => onChange({ question: e.target.value })} />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t("cb.f.options")}</legend>
          <p className="mb-2 text-xs text-text-subtle">{t("cb.f.optionsHint")}</p>
          <div className="space-y-2">
            {l.options.map((o, i) => {
              const right = l.answer === i;
              return (
                <div key={i} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${right ? "border-good/60 bg-good/5" : "border-border"}`}>
                  <input
                    type="radio"
                    name={`${id}-answer`}
                    checked={right}
                    onChange={() => onChange({ answer: i })}
                    aria-label={t("cb.f.markRight", { n: i + 1 })}
                    className="h-4 w-4 accent-[rgb(var(--good))]"
                  />
                  <span className="w-5 text-center font-mono text-xs text-text-subtle">{String.fromCharCode(65 + i)}</span>
                  <input
                    className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none"
                    aria-label={t("cb.f.option", { n: i + 1 })}
                    placeholder={t("cb.f.option", { n: i + 1 })}
                    value={o}
                    onChange={(e) => setOpt(i, e.target.value)}
                  />
                  {right && <span className="text-xs font-medium text-good">{t("cb.f.correct")}</span>}
                  {l.options.length > 2 && (
                    <IconBtn
                      label={t("cb.f.removeOption")}
                      icon="x"
                      danger
                      onClick={() =>
                        onChange({
                          options: l.options.filter((_, j) => j !== i),
                          answer: l.answer === i ? -1 : l.answer > i ? l.answer - 1 : l.answer,
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
          {l.options.length < 6 && (
            <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline" onClick={() => onChange({ options: [...l.options, ""] })}>
              <Icon name="plus" size={12} /> {t("cb.f.addOption")}
            </button>
          )}
        </fieldset>
      </>
    );
  }

  return (
    <div className="space-y-4">
      {body}
      {l.type !== "quiz" && (
        <Field id={`${id}-md`} label={l.type === "article" ? t("cb.f.content") : t("cb.f.notes")} optional={l.type !== "article"}>
          <MarkdownField id={`${id}-md`} value={l.body_md} onChange={(v) => onChange({ body_md: v })} rows={l.type === "article" ? 10 : 4} />
        </Field>
      )}
    </div>
  );
}
