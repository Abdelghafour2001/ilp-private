"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ContentStatus, type Course } from "@/lib/api";
import { LESSON_TYPES } from "@/lib/courseLessons";
import { claimHandle, getStoredLearner } from "@/lib/learner";

interface ELesson {
  id: string;
  title: string;
  type: string;
  body_md: string;
  video_url: string;
  lab_id: string;
  question: string;
  options: string; // newline-separated
  answer: string;
}
interface ESection {
  title: string;
  lessons: ELesson[];
}

const newLesson = (): ELesson => ({
  id: `l${Math.random().toString(36).slice(2, 8)}`,
  title: "",
  type: "article",
  body_md: "",
  video_url: "",
  lab_id: "",
  question: "",
  options: "",
  answer: "",
});

function fromCourse(c: Course): { meta: Meta; sections: ESection[] } {
  return {
    meta: {
      title: c.title,
      summary: c.summary,
      level: c.level,
      emoji: c.emoji,
      tags: c.tags.join(", "),
      status: c.status,
      external_url: c.external_url ?? "",
      provider: c.provider ?? "",
    },
    sections: c.curriculum.sections.map((s) => ({
      title: s.title,
      lessons: s.lessons.map((l) => ({
        ...newLesson(),
        id: l.id,
        title: l.title,
        type: l.type,
        body_md: l.body_md ?? "",
        video_url: l.video_url ?? "",
        lab_id: l.lab_id ?? "",
        question: l.question ?? "",
        options: (l.options ?? []).join("\n"),
        answer: l.answer ?? "",
      })),
    })),
  };
}

interface Meta {
  title: string;
  summary: string;
  level: string;
  emoji: string;
  tags: string;
  status: ContentStatus;
  external_url: string;
  provider: string;
}

const STATUS_NOTE: Record<ContentStatus, string> = {
  draft: "Draft — only you can see it. Submit it when you want it reviewed.",
  pending: "Waiting for a curator to review it.",
  published: "On the catalogue. Editing it sends it back for review.",
  archived: "Archived — off the catalogue, kept on the records of people who took it.",
};

export default function CourseBuilder({ initial }: { initial?: Course }) {
  const router = useRouter();
  const seed = initial
    ? fromCourse(initial)
    : {
        meta: { title: "", summary: "", level: "beginner", emoji: "📚", tags: "", status: "draft" as ContentStatus, external_url: "", provider: "" },
        sections: [{ title: "Introduction", lessons: [newLesson()] }] as ESection[],
      };
  const [meta, setMeta] = useState<Meta>(seed.meta);
  const [sections, setSections] = useState<ESection[]>(seed.sections);
  // New courses start on the "Details" step; edits jump straight to content.
  const [step, setStep] = useState<1 | 2>(initial ? 2 : 1);
  const [handle, setHandle] = useState(getStoredLearner()?.handle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchLesson(si: number, li: number, patch: Partial<ELesson>) {
    setSections((cur) =>
      cur.map((s, i) =>
        i === si ? { ...s, lessons: s.lessons.map((l, j) => (j === li ? { ...l, ...patch } : l)) } : s,
      ),
    );
  }

  function build() {
    return {
      title: meta.title,
      summary: meta.summary,
      level: meta.level,
      emoji: meta.emoji || "📚",
      tags: meta.tags.split(",").map((t) => t.trim()).filter(Boolean),
      external_url: meta.external_url.trim(),
      provider: meta.provider.trim(),
      curriculum: {
        sections: sections.map((s) => ({
          title: s.title,
          lessons: s.lessons.map((l) => ({
            id: l.id,
            title: l.title,
            type: l.type,
            body_md: l.body_md,
            video_url: l.video_url || null,
            lab_id: l.lab_id || null,
            question: l.question || null,
            options: l.options.split("\n").map((o) => o.trim()).filter(Boolean),
            answer: l.answer || null,
          })),
        })),
      },
    };
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let me = getStoredLearner();
      if (!me) {
        if (handle.trim().length < 2) throw new Error("Pick a handle so people know who made it.");
        me = await claimHandle(handle);
      }
      const body = { ...build(), learner_id: me.id, author: me.handle };
      const course = initial
        ? await api.updateCourse(initial.id, body, me.id)
        : await api.createCourse(body);
      router.push(`/courses/${course.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const me = getStoredLearner();

  return (
    <div className="space-y-6">
      {/* step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { n: 1 as const, label: "Details" },
          { n: 2 as const, label: "Content" },
        ].map(({ n, label }, i) => (
          <div key={n} className="flex items-center gap-2">
            {i > 0 && <span className="text-text-subtle">→</span>}
            <button
              onClick={() => (n === 1 || meta.title.trim()) && setStep(n)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 transition ${
                step === n
                  ? "border-accent bg-accent/10 font-medium"
                  : "border-edge text-text-subtle hover:text-text"
              }`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-xs font-semibold ${
                  step > n ? "bg-good/20 text-good" : step === n ? "bg-accent/25" : "bg-edge"
                }`}
              >
                {step > n ? "✓" : n}
              </span>
              {label}
            </button>
          </div>
        ))}
      </div>

      {step === 1 && (
      <div className="card space-y-3">
        <h3 className="font-medium">Course details</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-xs text-text-subtle sm:col-span-3">
            Title
            <input className="input mt-1" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          </label>
          <label className="text-xs text-text-subtle">
            Emoji
            <input className="input mt-1" value={meta.emoji} onChange={(e) => setMeta({ ...meta, emoji: e.target.value })} />
          </label>
        </div>
        <label className="text-xs text-text-subtle">
          Summary
          <input className="input mt-1" value={meta.summary} onChange={(e) => setMeta({ ...meta, summary: e.target.value })} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-text-subtle">
            Level
            <select className="input mt-1" value={meta.level} onChange={(e) => setMeta({ ...meta, level: e.target.value })}>
              <option value="beginner">beginner</option>
              <option value="intermediate">intermediate</option>
              <option value="advanced">advanced</option>
            </select>
          </label>
          <label className="text-xs text-text-subtle">
            Tags (comma-separated)
            <input className="input mt-1" value={meta.tags} onChange={(e) => setMeta({ ...meta, tags: e.target.value })} />
          </label>
        </div>
        {/* Publishing is not the author's switch any more: a course reaches
            the catalogue through review. This says where it stands. */}
        <p className="text-sm text-text-muted">
          {STATUS_NOTE[meta.status]}
        </p>

        <div className="space-y-2 rounded-lg border border-edge p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            🌐 External course (optional)
          </p>
          <p className="text-xs text-text-subtle">
            Link a course on Coursera, Udemy, LinkedIn Learning… — no in-app content needed.
            Leave empty to build the content here instead.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-text-subtle sm:col-span-2">
              Course URL
              <input
                className="input mt-1"
                placeholder="https://www.coursera.org/learn/…"
                value={meta.external_url}
                onChange={(e) => setMeta({ ...meta, external_url: e.target.value })}
              />
            </label>
            <label className="text-xs text-text-subtle">
              Platform
              <input
                className="input mt-1"
                placeholder="Coursera"
                value={meta.provider}
                onChange={(e) => setMeta({ ...meta, provider: e.target.value })}
              />
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-edge pt-3">
          {meta.external_url.trim() ? (
            <>
              <p className="text-xs text-text-subtle">External course — no content step needed.</p>
              <button className="btn" disabled={busy || !meta.title.trim()} onClick={save}>
                {busy ? "Saving…" : initial ? "Save changes" : "Save external course"}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-text-subtle">Next: add sections and lessons.</p>
              <button className="btn" disabled={!meta.title.trim()} onClick={() => setStep(2)}>
                Continue to content →
              </button>
            </>
          )}
        </div>
      </div>
      )}

      {step === 2 && (
      <>
      {/* compact recap of step 1 */}
      <div className="card flex flex-wrap items-center gap-3 py-3">
        <span className="text-2xl">{meta.emoji || "📚"}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{meta.title || "Untitled course"}</p>
          <p className="truncate text-xs text-text-subtle">
            {meta.level}
            {meta.summary && ` · ${meta.summary}`}
          </p>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => setStep(1)}>
          ← Edit details
        </button>
      </div>

      {sections.map((s, si) => (
        <div key={si} className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <input
              className="input font-medium"
              value={s.title}
              onChange={(e) => setSections((cur) => cur.map((x, i) => (i === si ? { ...x, title: e.target.value } : x)))}
              placeholder="Section title"
            />
            <button
              className="text-xs text-bad hover:underline"
              onClick={() => setSections((cur) => cur.filter((_, i) => i !== si))}
            >
              remove section
            </button>
          </div>

          {s.lessons.map((l, li) => (
            <div key={l.id} className="rounded-lg border border-edge p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  className="input"
                  placeholder="Lesson title"
                  value={l.title}
                  onChange={(e) => patchLesson(si, li, { title: e.target.value })}
                />
                <select
                  className="input max-w-[140px]"
                  value={l.type}
                  onChange={(e) => patchLesson(si, li, { type: e.target.value })}
                >
                  {LESSON_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button
                  className="text-xs text-bad hover:underline"
                  onClick={() =>
                    setSections((cur) => cur.map((x, i) => (i === si ? { ...x, lessons: x.lessons.filter((_, j) => j !== li) } : x)))
                  }
                >
                  ✕
                </button>
              </div>

              {l.type === "video" && (
                <input className="input" placeholder="Video URL (YouTube/Vimeo)" value={l.video_url} onChange={(e) => patchLesson(si, li, { video_url: e.target.value })} />
              )}
              {l.type === "lab" && (
                <input className="input" placeholder="Lab id (e.g. python-basics)" value={l.lab_id} onChange={(e) => patchLesson(si, li, { lab_id: e.target.value })} />
              )}
              {l.type === "quiz" && (
                <div className="space-y-2">
                  <input className="input" placeholder="Question" value={l.question} onChange={(e) => patchLesson(si, li, { question: e.target.value })} />
                  <textarea className="input h-16 font-mono text-xs" placeholder="Options, one per line" value={l.options} onChange={(e) => patchLesson(si, li, { options: e.target.value })} />
                  <input className="input" placeholder="Correct answer (must match an option)" value={l.answer} onChange={(e) => patchLesson(si, li, { answer: e.target.value })} />
                </div>
              )}
              {l.type !== "quiz" && (
                <textarea className="input h-24 font-mono text-xs" placeholder="Content (markdown)" value={l.body_md} onChange={(e) => patchLesson(si, li, { body_md: e.target.value })} />
              )}
            </div>
          ))}

          <button
            className="btn-ghost"
            onClick={() => setSections((cur) => cur.map((x, i) => (i === si ? { ...x, lessons: [...x.lessons, newLesson()] } : x)))}
          >
            + Add lesson
          </button>
        </div>
      ))}

      <button className="btn-ghost" onClick={() => setSections((cur) => [...cur, { title: "New section", lessons: [newLesson()] }])}>
        + Add section
      </button>

      {!me && (
        <div className="card">
          <label className="text-xs text-text-subtle">
            Your handle (course author)
            <input className="input mt-1 max-w-xs" value={handle} onChange={(e) => setHandle(e.target.value)} />
          </label>
        </div>
      )}

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <button className="btn" onClick={save} disabled={busy || !meta.title.trim()}>
        {busy ? "Saving…" : initial ? "Save changes" : "Save draft"}
      </button>
      </>
      )}
    </div>
  );
}
