"use client";

/**
 * "I learned this" — logging learning that happened outside the platform.
 *
 * Most of what people actually learn is an article, a book, a conference talk
 * or an afternoon with a colleague. None of that is instrumented, so an hours
 * figure built only from platform activity is not merely incomplete, it is
 * biased towards whatever happens to be measurable.
 *
 * Records count as soon as they are saved. Requiring approval first would kill
 * the habit the feature depends on; a manager can vouch for one afterwards,
 * and HR reporting keeps declared time in its own bucket.
 */

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Learner,
  type LearningKind,
  type LearningRecord,
  type SkillRow,
} from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";

const KIND_META: Record<LearningKind, { icon: string; key: string; fallback: string }> = {
  article: { icon: "📄", key: "learning.kind.article", fallback: "Article" },
  book: { icon: "📚", key: "learning.kind.book", fallback: "Book" },
  video: { icon: "🎬", key: "learning.kind.video", fallback: "Video" },
  podcast: { icon: "🎧", key: "learning.kind.podcast", fallback: "Podcast" },
  course: { icon: "🎓", key: "learning.kind.course", fallback: "Course" },
  conference: { icon: "🎤", key: "learning.kind.conference", fallback: "Conference" },
  mentoring: { icon: "🤝", key: "learning.kind.mentoring", fallback: "Mentoring" },
  on_the_job: { icon: "🛠", key: "learning.kind.on_the_job", fallback: "On the job" },
  other: { icon: "✨", key: "learning.kind.other", fallback: "Other" },
};

const BLANK = {
  kind: "article" as LearningKind,
  title: "",
  url: "",
  provider: "",
  minutes: 30,
  notes: "",
  skill_ids: [] as number[],
};

export default function LearningLog({
  me,
  skills,
  onChanged,
}: {
  me: Learner | null;
  skills: SkillRow[];
  onChanged?: () => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const [records, setRecords] = useState<LearningRecord[]>([]);
  const [draft, setDraft] = useState({ ...BLANK });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [courseraUrl, setCourseraUrl] = useState("");
  const [certificateUrl, setCertificateUrl] = useState("");
  const [note, setNote] = useState("");

  const refresh = useCallback(() => {
    if (!me) return;
    api.myLearning(me.id).then(setRecords).catch((e) => setError(String(e)));
  }, [me]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save() {
    if (!me || draft.title.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      await api.logLearning({ learner_id: me.id, ...draft, title: draft.title.trim() });
      setDraft({ ...BLANK });
      setOpen(false);
      refresh();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  /** The Coursera shortcut: paste the course link, we fetch the rest. */
  async function declareCoursera() {
    if (!me || !courseraUrl.includes("/learn/")) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.declareCourseraCourse({
        learner_id: me.id,
        course_url: courseraUrl.trim(),
        certificate_url: certificateUrl.trim() || undefined,
      });
      setCourseraUrl("");
      setCertificateUrl("");
      setNote(t("learning.declared", { title: saved.title }, "“{title}” logged — it now counts towards your programmes."));
      refresh();
      onChanged?.();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!me) return;
    await api.deleteLearning(id, me.id).catch((e) => setError(String(e)));
    refresh();
    onChanged?.();
  }

  function toggleSkill(id: number) {
    setDraft((d) => ({
      ...d,
      skill_ids: d.skill_ids.includes(id)
        ? d.skill_ids.filter((s) => s !== id)
        : [...d.skill_ids, id],
    }));
  }

  const totalHours = records.reduce((s, r) => s + r.hours, 0);

  if (!me) {
    return (
      <div className="card text-sm text-text-subtle">{t("common.signInFirst")}</div>
    );
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            📝 {t("learning.title", "Learning I logged myself")}
          </p>
          <p className="mt-0.5 text-xs text-text-subtle">
            {t("learning.summary", { count: records.length, hours: totalHours.toFixed(1) })}
          </p>
        </div>
        <button className="btn-soft btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? t("common.close") : `+ ${t("learning.add", "Log learning")}`}
        </button>
      </div>

      {/* Coursera courses taken outside the organisation's programmes. The
          enterprise report only carries programme enrolments — measured, 2889
          rows out of 2889 — so a course somebody took on their own account can
          only reach the platform this way. Paste the link and the catalogue
          fills in the title and the length, which keeps a declared row
          consistent with a synced one, and keeps the slug so the completion
          counts towards a specialization. */}
      <div className="space-y-2 rounded-xl border border-border bg-surface-2/40 p-3">
        <p className="text-xs text-text-muted">
          🎓 {t("learning.courseraHint", "Finished a Coursera course outside a company programme? It will not sync — tell us here.")}
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="input min-w-[15rem] flex-1"
            placeholder="https://www.coursera.org/learn/…"
            value={courseraUrl}
            onChange={(e) => setCourseraUrl(e.target.value)}
          />
          <input
            className="input min-w-[12rem] flex-1"
            placeholder={t("learning.certificateUrl", "Certificate link (optional)")}
            value={certificateUrl}
            onChange={(e) => setCertificateUrl(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={busy || !courseraUrl.includes("/learn/")}
            onClick={declareCoursera}
          >
            {busy ? t("common.saving", "Saving…") : t("learning.declare", "Add it")}
          </button>
        </div>
        {note && <p className="text-xs text-good">{note}</p>}
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      {open && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(KIND_META) as LearningKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setDraft({ ...draft, kind: k })}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  draft.kind === k
                    ? "border-accent bg-accent/10 font-medium text-text"
                    : "border-border text-text-subtle hover:text-text"
                }`}
              >
                {KIND_META[k].icon} {t(KIND_META[k].key, KIND_META[k].fallback)}
              </button>
            ))}
          </div>

          <input
            className="input"
            placeholder={t("learning.titlePlaceholder", "What did you learn? (title)")}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              className="input sm:col-span-2"
              placeholder={t("learning.urlPlaceholder", "Link (optional)")}
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            />
            <label className="text-xs text-text-subtle">
              {t("learning.minutes", "Minutes")}
              <input
                type="number"
                min={0}
                className="input mt-1"
                value={draft.minutes}
                onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) || 0 })}
              />
            </label>
          </div>

          {skills.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-text-subtle">
                {t("learning.skills", "Which skills did this develop?")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => {
                  const on = draft.skill_ids.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleSkill(s.id)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                        on
                          ? "border-accent bg-accent/15 font-medium text-accent-text"
                          : "border-border text-text-subtle hover:text-text"
                      }`}
                    >
                      {on ? "✓ " : ""}
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            className="btn"
            disabled={busy || draft.title.trim().length < 2}
            onClick={save}
          >
            {t("learning.save", "Log it")}
          </button>
        </div>
      )}

      {records.length === 0 ? (
        <p className="text-sm text-text-subtle">
          {t("learning.empty", "Nothing logged yet — an article or a podcast counts.")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {records.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span className="text-lg">{KIND_META[r.kind]?.icon ?? "✨"}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-medium hover:text-accent hover:underline"
                    >
                      {r.title}
                    </a>
                  ) : (
                    <span className="truncate font-medium">{r.title}</span>
                  )}
                  {r.verified && (
                    <span
                      className="badge bg-good/15 text-good"
                      title={t("learning.verifiedBy", { name: r.verified_by_name })}
                    >
                      ✓ {t("learning.verified", "verified")}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-text-subtle">
                  {r.hours} h
                  {r.completed_on && ` · ${fmt.date(r.completed_on, { day: "numeric", month: "short" })}`}
                  {r.skills.length > 0 && ` · ${r.skills.map((s) => s.name).join(", ")}`}
                </span>
              </span>
              <button
                className="text-xs text-bad hover:underline"
                onClick={() => remove(r.id)}
              >
                {t("common.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
