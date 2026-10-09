"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  api,
  type Formation,
  type FormationAssessments,
  type Learner,
  type Roster,
} from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { F_LESSON_META } from "@/lib/formationLessons";
import SessionsPanel from "@/components/SessionsPanel";
import { useT } from "@/lib/i18n";

const STATUS_BADGE: Record<string, string> = {
  invited: "bg-warn/15 text-warn",
  active: "bg-accent/15 text-accent-text",
  completed: "bg-good/15 text-good",
};

export default function ManageFormation({ params }: { params: Promise<{ id: string }> }) {
  const t = useT();
  const { id } = use(params);
  const formationId = Number(id);

  const [formation, setFormation] = useState<Formation | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [invitees, setInvitees] = useState("");
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const me = typeof window !== "undefined" ? getStoredLearner() : null;

  const refresh = useCallback(() => {
    const learner = getStoredLearner();
    api.getFormation(formationId, learner?.id).then(setFormation).catch((e) => setError(String(e)));
    api.formationRoster(formationId, learner?.id).then(setRoster).catch((e) => setError(String(e)));
  }, [formationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Flat lesson list (id → title/type) for the completion matrix.
  const lessons = useMemo(() => {
    if (!formation) return [];
    return (formation.curriculum.modules ?? []).flatMap((m, mi) =>
      m.lessons.map((l) => ({ ...l, moduleIndex: mi })),
    );
  }, [formation]);

  async function invite() {
    if (!me) return;
    setBusy(true);
    setInviteResult(null);
    try {
      const handles = invitees.split(/[,\n]/).map((h) => h.trim()).filter(Boolean);
      const r = await api.inviteTrainees(formationId, handles, me.id);
      const parts = [];
      if (r.invited.length) parts.push(`✓ Invited: ${r.invited.join(", ")}`);
      for (const s of r.skipped) parts.push(`✗ ${s.handle}: ${s.reason}`);
      setInviteResult(parts.join(" · ") || "Nothing to do.");
      setInvitees("");
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function copyCode() {
    if (!roster) return;
    navigator.clipboard?.writeText(roster.join_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (error && !roster) return <p className="text-sm text-bad">{error}</p>;
  if (!formation || !roster) return <p className="text-sm text-text-subtle">Loading…</p>;

  const active = roster.trainees.filter((tr) => tr.status !== "invited");
  const avgPct = active.length
    ? Math.round(active.reduce((sum, tr) => sum + tr.percent, 0) / active.length)
    : 0;

  return (
    <div className="space-y-6">
      <Link href={`/formations/${formationId}`} className="text-xs text-text-subtle hover:text-text">
        ← {formation.emoji} {formation.title}
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("form.trainees")}</h1>
          <p className="mt-1 text-sm text-text-muted">
            Who&apos;s in, how far along, and how their graded prompts scored.
          </p>
        </div>
        <Link href={`/formations/${formationId}/edit`} className="btn-ghost">✏️ Edit training</Link>
      </div>

      {/* summary strip */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label={t("form.enrolled")} value={active.length} />
        <StatCard label={t("form.invitedPending")} value={roster.trainees.length - active.length} />
        <StatCard label={t("form.completed")} value={roster.trainees.filter((tr) => tr.status === "completed").length} />
        <StatCard label={t("form.avgProgress")} value={`${avgPct}%`} />
      </div>

      {/* invite */}
      <div className="card space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
          ✉️ Invite trainees
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1"
            placeholder={t("form.invitePlaceholder")}
            value={invitees}
            onChange={(e) => setInvitees(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && invite()}
          />
          <button className="btn" onClick={invite} disabled={busy || !invitees.trim()}>
            {t("form.sendInvites")}
          </button>
        </div>
        {inviteResult && <p className="text-xs text-text-muted">{inviteResult}</p>}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
          <span className="text-xs text-text-subtle">{t("form.orShareCode")}</span>
          <code className="rounded bg-ink px-2 py-1 font-mono text-sm text-accent">{roster.join_code}</code>
          <button className="btn-ghost btn-sm" onClick={copyCode}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
          <span className="text-xs text-text-subtle">
            — trainees enter it on the formation page. Anyone with the code can join.
          </span>
        </div>
      </div>

      {/* roster */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-subtle">
              <th className="px-4 py-3">{t("form.col.trainee")}</th>
              <th className="px-4 py-3">{t("form.col.status")}</th>
              <th className="px-4 py-3">{t("form.col.progress")}</th>
              <th className="px-4 py-3">{t("form.col.scores")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {roster.trainees.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-text-subtle">
                  {t("form.noTrainees")}
                </td>
              </tr>
            )}
            {roster.trainees.map((trainee) => {
              const scores = lessons
                .filter((l) => l.type === "prompt_challenge" && trainee.lesson_data[l.id]?.score !== undefined)
                .map((l) => ({ title: l.title, score: trainee.lesson_data[l.id].score as number }));
              const isOpen = expanded === trainee.learner_id;
              return (
                <FragmentRow
                  key={trainee.learner_id}
                  trainee={trainee}
                  scores={scores}
                  isOpen={isOpen}
                  onToggle={() => setExpanded(isOpen ? null : trainee.learner_id)}
                  lessons={lessons}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-subtle">
        Tip: click a trainee row to see the per-lesson completion matrix — including their best
        graded prompts.
      </p>

      {/* before/after evaluation results */}
      <AssessmentPanel formationId={formationId} me={me} />

      {/* live sessions: schedule, registrations, attendance */}
      <SessionsPanel me={me} formationId={formationId} />
    </div>
  );
}

/**
 * Pre/post evaluation results.
 *
 * Renders nothing until the trainer has actually tagged an entry and/or exit
 * quiz — an empty panel on every training would just be noise.
 */
function AssessmentPanel({ formationId, me }: { formationId: number; me: Learner | null }) {
  const t = useT();
  const [data, setData] = useState<FormationAssessments | null>(null);

  useEffect(() => {
    api
      .formationAssessments(formationId, me?.id)
      .then(setData)
      .catch(() => setData(null));
  }, [formationId, me?.id]);

  if (!data?.configured) return null;
  const { summary } = data;

  return (
    <div className="card space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
        📊 {t("assess.title")}
      </p>

      {summary.measured ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <StatCard label={t("assess.measured")} value={summary.measured} />
          <StatCard label={t("assess.avgPre")} value={`${summary.avg_pre ?? "—"}`} />
          <StatCard label={t("assess.avgPost")} value={`${summary.avg_post ?? "—"}`} />
          <StatCard label={t("assess.avgGain")} value={`+${summary.avg_gain ?? 0}`} />
        </div>
      ) : (
        <p className="text-sm text-text-subtle">
          {t("assess.notTakenYet")}
        </p>
      )}

      {data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-subtle">
                <th className="px-2 py-2">{t("assess.col.trainee")}</th>
                <th className="px-2 py-2 text-right">{t("assess.col.before")}</th>
                <th className="px-2 py-2 text-right">{t("assess.col.after")}</th>
                <th className="px-2 py-2 text-right">{t("assess.col.gain")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.learner_id} className="border-t border-edge">
                  <td className="px-2 py-1.5">{r.name || r.handle}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{r.pre_score ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{r.post_score ?? "—"}</td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono ${
                      r.gain === null ? "text-text-subtle" : r.gain > 0 ? "text-good" : "text-warn"
                    }`}
                  >
                    {r.gain === null ? "—" : r.gain > 0 ? `+${r.gain}` : r.gain}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card py-3 text-center">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-text-subtle">{label}</p>
    </div>
  );
}

function FragmentRow({
  trainee,
  scores,
  isOpen,
  onToggle,
  lessons,
}: {
  trainee: Roster["trainees"][number];
  scores: { title: string; score: number }[];
  isOpen: boolean;
  onToggle: () => void;
  lessons: Array<{ id: string; title: string; type: string; moduleIndex: number }>;
}) {
  const t = useT();
  const done = new Set(trainee.completed);
  return (
    <>
      <tr
        className="cursor-pointer border-b border-border transition hover:bg-surface-2"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <p className="font-medium">{trainee.name || trainee.handle}</p>
          <p className="text-xs text-text-subtle">@{trainee.handle}</p>
        </td>
        <td className="px-4 py-3">
          <span className={`badge ${STATUS_BADGE[trainee.status] ?? "bg-edge"}`}>{trainee.status}</span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full ${trainee.percent === 100 ? "bg-good" : "bg-accent"}`}
                style={{ width: `${Math.max(2, trainee.percent)}%` }}
              />
            </div>
            <span className="text-xs text-text-muted">{trainee.percent}%</span>
          </div>
        </td>
        <td className="px-4 py-3">
          {scores.length === 0 ? (
            <span className="text-xs text-text-subtle">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {scores.map((s, i) => (
                <span
                  key={i}
                  title={s.title}
                  className={`badge ${s.score >= 85 ? "badge-good" : s.score >= 70 ? "badge-accent" : "badge-warn"}`}
                >
                  🏆 {s.score}
                </span>
              ))}
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-right text-xs text-text-subtle">{isOpen ? "▲" : "▼"}</td>
      </tr>
      {isOpen && (
        <tr className="border-b border-border bg-surface-2/40">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex flex-wrap gap-1.5">
              {lessons.map((l) => {
                const meta = F_LESSON_META[l.type as keyof typeof F_LESSON_META] ?? F_LESSON_META.article;
                const ok = done.has(l.id);
                const data = trainee.lesson_data[l.id];
                return (
                  <span
                    key={l.id}
                    title={`${l.title}${data?.score !== undefined ? ` — best score ${data.score}` : ""}`}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                      ok ? "border-good/40 bg-good/10 text-text" : "border-border text-text-subtle"
                    }`}
                  >
                    {ok ? "✅" : meta.icon} {l.title.slice(0, 26)}
                    {data?.score !== undefined && <strong className="text-good">{data.score}</strong>}
                  </span>
                );
              })}
            </div>
            {Object.entries(trainee.lesson_data).some(([, d]) => d.prompt) && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-text-subtle">
                  {t("form.bestPrompts")}
                </summary>
                <div className="mt-2 space-y-2">
                  {lessons
                    .filter((l) => trainee.lesson_data[l.id]?.prompt)
                    .map((l) => (
                      <div key={l.id}>
                        <p className="text-xs font-medium text-text-muted">
                          {l.title} — {trainee.lesson_data[l.id].score}/100
                        </p>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-ink p-2 font-mono text-[11px] text-text-muted">
                          {trainee.lesson_data[l.id].prompt}
                        </pre>
                      </div>
                    ))}
                </div>
              </details>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
