"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  api,
  type Formation,
  type FormationProgress,
  type FormationSession,
  type Learner,
} from "@/lib/api";
import { getStoredLearner, claimHandle } from "@/lib/learner";
import { F_LESSON_META, FORMAT_META, LEVEL_BADGE, fmtDuration } from "@/lib/formationLessons";
import AssignPanel from "@/components/AssignPanel";
import SocialSection from "@/components/SocialSection";
import { useT } from "@/lib/i18n";

export default function FormationOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const formationId = Number(id);
  const router = useRouter();

  const [me, setMe] = useState<Learner | null>(null);
  const [formation, setFormation] = useState<Formation | null>(null);
  const [progress, setProgress] = useState<FormationProgress | null>(null);
  const t = useT();
  const [myStatus, setMyStatus] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<FormationSession[]>([]);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [sess, setSess] = useState({ title: "", starts_at: "", duration_min: 60, location: "", meeting_url: "" });

  const refresh = useCallback(() => {
    const learner = getStoredLearner();
    setMe(learner);
    api.getFormation(formationId, learner?.id).then(setFormation).catch((e) => setError(String(e)));
    api
      .listFormations(learner?.id)
      .then((cards) => {
        const mine = cards.find((c) => c.id === formationId);
        setMyStatus(mine?.my_status ?? null);
      })
      .catch(() => {});
    if (learner) {
      api.formationProgress(formationId, learner.id).then(setProgress).catch(() => {});
    }
    api.listFormationSessions(formationId).then(setSessions).catch(() => {});
  }, [formationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error && !formation) return <p className="text-sm text-bad">{error}</p>;
  if (!formation) return <p className="text-sm text-text-subtle">Loading…</p>;

  const modules = formation.curriculum.modules ?? [];
  const lessons = modules.flatMap((m) => m.lessons);
  const totalXp = lessons.reduce((s, l) => s + (l.xp ?? 10), 0);
  const totalMin = lessons.reduce((s, l) => s + (l.duration_min ?? 5), 0);
  // The trainer's stated length wins; the lesson total is only a fallback,
  // and undersells anything taught mostly in the room.
  const displayMin = formation?.duration_hours
    ? Math.round(formation.duration_hours * 60)
    : totalMin;
  const completed = new Set(progress?.completed ?? []);
  const isTrainer = myStatus === "trainer" || me?.role === "admin";
  const enrolled = myStatus === "active" || myStatus === "completed";

  async function ensureLearner(): Promise<Learner | null> {
    let learner = getStoredLearner();
    if (!learner) {
      const h = prompt("Pick a handle so your progress can be saved:");
      if (!h || h.trim().length < 2) return null;
      learner = await claimHandle(h);
      setMe(learner);
    }
    return learner;
  }

  async function accept(acceptIt: boolean) {
    if (!me) return;
    setBusy(true);
    try {
      await api.respondToInvite(formationId, me.id, acceptIt);
      if (acceptIt) router.push(`/formations/${formationId}/learn`);
      else refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function scheduleSession() {
    if (!sess.title.trim() || !sess.starts_at) return;
    setBusy(true);
    try {
      await api.createFormationSession(formationId, {
        title: sess.title.trim(),
        starts_at: new Date(sess.starts_at).toISOString(),
        duration_min: sess.duration_min,
        location: sess.location.trim(),
        meeting_url: sess.meeting_url.trim(),
        learner_id: me?.id,
      });
      setSess({ title: "", starts_at: "", duration_min: 60, location: "", meeting_url: "" });
      setShowSessionForm(false);
      api.listFormationSessions(formationId).then(setSessions).catch(() => {});
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancelSession(sessionId: number) {
    if (!confirm("Cancel this session?")) return;
    await api.deleteFormationSession(formationId, sessionId, me?.id ?? undefined).catch((e) => setError(String(e)));
    api.listFormationSessions(formationId).then(setSessions).catch(() => {});
  }

  async function join(code?: string) {
    setBusy(true);
    try {
      const learner = await ensureLearner();
      if (!learner) return;
      await api.enrollFormation(formationId, learner.id, code);
      router.push(`/formations/${formationId}/learn`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/formations" className="text-xs text-text-subtle hover:text-text">
        ← All trainings
      </Link>

      {/* Hero */}
      <div className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="text-5xl">{formation.emoji}</span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold">{formation.title}</h1>
                <span className={`badge ${LEVEL_BADGE[formation.level] ?? "bg-edge"}`}>{formation.level}</span>
                <span
                  className="badge bg-iris/15 text-iris"
                  title={FORMAT_META[formation.format]?.desc}
                >
                  {FORMAT_META[formation.format]?.icon} {FORMAT_META[formation.format]?.label}
                </span>
                {formation.status !== "published" && (
                  <span className="badge bg-warn/15 text-warn">{formation.status}</span>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-sm text-text-muted">{formation.summary}</p>
              <p className="mt-2 text-xs text-text-subtle">
                {t("form.by")} <strong className="text-text">{formation.trainer_name}</strong>
                {" · "}{modules.length} modules · {lessons.length} lessons · {fmtDuration(displayMin)} · ⚡ {totalXp} XP
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {formation.tags.map((t) => (
                  <span key={t} className="badge bg-edge text-text-subtle">{t}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2">
            {isTrainer && (
              <>
                <Link href={`/formations/${formationId}/manage`} className="btn text-center">📊 Trainees & progress</Link>
                <Link href={`/formations/${formationId}/edit`} className="btn-ghost text-center">✏️ Edit training</Link>
              </>
            )}
            {enrolled && (
              <Link href={`/formations/${formationId}/learn`} className="btn text-center">
                {myStatus === "completed" ? "Review lessons" : progress && progress.completed.length > 0 ? "Continue →" : "Start learning →"}
              </Link>
            )}
            {myStatus === "invited" && (
              <>
                <button className="btn" disabled={busy} onClick={() => accept(true)}>✉️ Accept invitation</button>
                <button className="btn-ghost" disabled={busy} onClick={() => accept(false)}>{t("form.decline")}</button>
              </>
            )}
            {!enrolled && !isTrainer && myStatus !== "invited" && (
              formation.open_enrollment ? (
                <button className="btn" disabled={busy} onClick={() => join()}>{t("form.join")}</button>
              ) : (
                <div className="space-y-2 text-right">
                  <p className="text-xs text-text-subtle">{t("form.haveCode")}</p>
                  <div className="flex gap-2">
                    <input
                      className="input max-w-[140px]"
                      placeholder={t("form.joinCode")}
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value)}
                    />
                    <button className="btn-soft" disabled={busy || !joinCode.trim()} onClick={() => join(joinCode.trim())}>
                      {t("form.joinShort")}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        {enrolled && progress && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-text-subtle">
              <span>
                {progress.completed.length}/{progress.total} lessons · ⚡ {progress.xp_earned} XP earned
              </span>
              <span className="font-medium text-text">{progress.percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full ${progress.percent === 100 ? "bg-good" : "bg-accent"}`}
                style={{ width: `${Math.max(2, progress.percent)}%` }}
              />
            </div>

            {/* The entry baseline, once it exists. Shown next to the bar rather
                than buried in the lesson, because its whole value is being
                compared against the exit score later. */}
            {progress.entry_score !== null && (
              <p className="mt-1.5 text-xs text-text-subtle">
                📊 {t("catalog.entryScore", { score: progress.entry_score })}
              </p>
            )}

            {/* Why the bar is not at 100 when every lesson is done. Naming the
                remaining step beats leaving the learner to guess. */}
            {progress.feedback_required && !progress.feedback_given && (
              <div className="mt-2 rounded-lg border border-iris/30 bg-iris/[0.06] px-3 py-2">
                <p className="text-xs font-semibold text-iris">{t("catalog.feedbackStep")}</p>
                <p className="mt-0.5 text-xs text-text-subtle">
                  {t("catalog.feedbackStepHint")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Curriculum */}
        <div className="space-y-4">
          {modules.map((m, mi) => (
            <div key={mi} className="card space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                Module {mi + 1} — {m.title}
              </p>
              <div className="space-y-1">
                {m.lessons.map((l) => {
                  const meta = F_LESSON_META[l.type] ?? F_LESSON_META.article;
                  const done = completed.has(l.id);
                  return (
                    <div
                      key={l.id}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                        done ? "border-good/30 bg-good/5" : "border-border"
                      }`}
                    >
                      <span className="text-lg">{done ? "✅" : meta.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{l.title}</p>
                        <p className="text-xs text-text-subtle">
                          {meta.label} · {fmtDuration(l.duration_min ?? 5)} · ⚡{l.xp ?? 10} XP
                        </p>
                      </div>
                      {enrolled && (
                        <Link href={`/formations/${formationId}/learn?lesson=${l.id}`} className="btn-ghost btn-sm shrink-0">
                          {done ? "Review" : "Open"}
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Objectives */}
        <div className="space-y-4">
          {/* Live sessions */}
          <div className="card space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                📅 Live sessions
              </p>
              {isTrainer && (
                <button className="btn-ghost btn-sm" onClick={() => setShowSessionForm((v) => !v)}>
                  {showSessionForm ? "Close" : "+ Schedule"}
                </button>
              )}
            </div>

            {showSessionForm && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <input
                  className="input"
                  placeholder={t("form.sessionTitle")}
                  value={sess.title}
                  onChange={(e) => setSess({ ...sess, title: e.target.value })}
                />
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    type="datetime-local"
                    value={sess.starts_at}
                    onChange={(e) => setSess({ ...sess, starts_at: e.target.value })}
                  />
                  <input
                    className="input max-w-[90px]"
                    type="number"
                    min={5}
                    title={t("form.duration")}
                    value={sess.duration_min}
                    onChange={(e) => setSess({ ...sess, duration_min: Number(e.target.value) })}
                  />
                </div>
                <input
                  className="input"
                  placeholder={t("form.location")}
                  value={sess.location}
                  onChange={(e) => setSess({ ...sess, location: e.target.value })}
                />
                <input
                  className="input"
                  placeholder={t("form.meetingLink")}
                  value={sess.meeting_url}
                  onChange={(e) => setSess({ ...sess, meeting_url: e.target.value })}
                />
                <button
                  className="btn w-full"
                  disabled={busy || !sess.title.trim() || !sess.starts_at}
                  onClick={scheduleSession}
                >
                  {t("form.scheduleSession")}
                </button>
              </div>
            )}

            {sessions.length === 0 && !showSessionForm && (
              <p className="text-sm text-text-subtle">{t("form.noSessions")}</p>
            )}
            <div className="space-y-2">
              {sessions.map((s) => {
                const past = new Date(s.starts_at) < new Date();
                return (
                  <div
                    key={s.id}
                    className={`rounded-lg border border-border px-3 py-2 text-sm ${past ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{s.title}</p>
                      {isTrainer && (
                        <button className="text-xs text-bad hover:underline" onClick={() => cancelSession(s.id)}>
                          cancel
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-text-subtle">
                      {new Date(s.starts_at).toLocaleString(undefined, {
                        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                      {" · "}{s.duration_min} min
                      {s.location && ` · 📍 ${s.location}`}
                    </p>
                    {s.meeting_url && !past && (
                      <a href={s.meeting_url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                        {t("form.joinMeeting")}
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {formation.objectives.length > 0 && (
            <div className="card">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">
                🎯 What you&apos;ll learn
              </p>
              <ul className="space-y-2">
                {formation.objectives.map((o, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text-muted">
                    <span className="mt-0.5 text-good">✓</span>
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* compétences visées */}
          {formation.skills?.length > 0 && (
            <div className="card">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">
                🧠 Skills developed
              </p>
              <div className="flex flex-wrap gap-1.5">
                {formation.skills.map((s) => (
                  <Link
                    key={s.id}
                    href="/skills"
                    className="badge bg-accent/10 text-accent-text transition hover:bg-accent/20"
                    title={`${s.category} — voir la compétence`}
                  >
                    {s.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* prérequis */}
          {formation.prerequisites?.trim() && (
            <div className="card">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">
                📋 Prerequisites
              </p>
              <p className="whitespace-pre-line text-sm text-text-muted">
                {formation.prerequisites}
              </p>
            </div>
          )}

          {/* fiche récap */}
          <div className="card">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">
              ℹ️ At a glance
            </p>
            <dl className="space-y-1.5 text-sm">
              {[
                ["Format", `${FORMAT_META[formation.format]?.icon} ${FORMAT_META[formation.format]?.label}`],
                ["Level", formation.level],
                ["Duration", fmtDuration(displayMin)],
                ["Content", `${modules.length} modules · ${lessons.length} lessons`],
                ["Trainer", formation.trainer_name],
                ["Access", formation.open_enrollment ? "Open enrollment" : "Invite / join code"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-text-subtle">{k}</dt>
                  <dd className="text-right font-medium text-text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          {/* A trainer hands the training out from the training itself: the
              roster and the deadline belong next to the thing they are about. */}
          {isTrainer && (
            <AssignPanel entityType="formation" entityId={formationId} onAssigned={() => {}} />
          )}

          {/* comments, likes & shares */}
          <SocialSection etype="formation" eid={formationId} />

          <div className="card">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">
              {t("form.howGrading")}
            </p>
            <p className="text-sm text-text-muted">
              Playground lessons run your prompts <strong>live against the LLM</strong>. Challenge
              lessons are scored by an AI examiner against the trainer&apos;s rubric — you pass at
              the minimum score and can retry as often as you like. Your trainer sees your progress
              and best scores.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
