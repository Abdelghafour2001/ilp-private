"use client";

import { useCallback, useEffect, useState } from "react";
import { useMandatory, mandatoryFirst } from "@/lib/mandatory";
import OwedMarker from "@/components/OwedMarker";
import Link from "next/link";
import { api, type FormationCard, type Learner } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { F_LESSON_META, LEVEL_BADGE, fmtDuration } from "@/lib/formationLessons";
import MandatoryBadge from "@/components/MandatoryBadge";
import { useT } from "@/lib/i18n";

export default function FormationsHub() {
  const [me, setMe] = useState<Learner | null>(null);
  const [cards, setCards] = useState<FormationCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [requirement, setRequirement] = useState<"all" | "mandatory" | "optional">("all");
  // The existing filter is about the content; this is about the person —
  // "mandatory" and "mandatory for me with a deadline" are not the same set.
  const [onlyOwed, setOnlyOwed] = useState(false);
  const owed = useMandatory("formation");
  const t = useT();

  const refresh = useCallback(() => {
    const learner = getStoredLearner();
    setMe(learner);
    if (learner && !learner.role) {
      // Older stored identities predate roles — hydrate from the profile.
      api.learnerProfile(learner.id).then((p) => setMe({ ...learner, role: p.role })).catch(() => {});
    }
    api
      .listFormations(learner?.id)
      .then(setCards)
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("dqai-learner-changed", refresh);
    return () => window.removeEventListener("dqai-learner-changed", refresh);
  }, [refresh]);

  async function respond(id: number, accept: boolean) {
    if (!me) return;
    setBusy(id);
    try {
      await api.respondToInvite(id, me.id, accept);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function join(id: number) {
    if (!me) {
      setError("Pick a handle first (top-right) so your progress can be saved.");
      return;
    }
    setBusy(id);
    try {
      await api.enrollFormation(id, me.id);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const canTeach = ["trainer", "manager", "bu_head", "hr", "hr_lead", "admin"].includes(
    me?.role ?? "",
  );
  const invitations = cards.filter((c) => c.my_status === "invited");
  const learning = cards.filter((c) => c.my_status === "active" || c.my_status === "completed");
  const teaching = cards.filter((c) => c.my_status === "trainer");
  // Filtering happens on the already-loaded list: the catalogue is small
  // enough that a round trip per keystroke would be slower than no filter.
  const matchesRequirement = (c: FormationCard) =>
    requirement === "all" ||
    (requirement === "mandatory" ? c.mandatory : !c.mandatory);

  const catalog = cards
    .filter((c) => c.my_status === null && c.status === "published")
    .filter(matchesRequirement);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("form.hub.title")}</h1>
          <p className="mt-1 text-sm text-text-muted">
            Instructor-led trainings mixing theory and hands-on practice — from soft skills to
            live GenAI playgrounds with AI-graded challenges and per-trainee progress.
          </p>
        </div>
        {canTeach && (
          <Link href="/formations/new" className="btn shrink-0">
            + New training
          </Link>
        )}
      </div>

      {error && (
        <div className="card border-bad/40 text-sm text-bad" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {invitations.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-accent-text">
            ✉️ You&apos;re invited
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {invitations.map((c) => (
              <div key={c.id} className="card space-y-3 border-accent/40 shadow-glow">
                <CardHead c={c} />
                <p className="text-sm text-text-muted">
                  <strong className="text-text">{c.trainer_name}</strong> invited you to this
                  training — {c.lesson_count} lessons, {fmtDuration(c.duration_min)},{" "}
                  {c.total_xp} XP.
                </p>
                <div className="flex gap-2">
                  <button className="btn" disabled={busy === c.id} onClick={() => respond(c.id, true)}>
                    {t("form.acceptStart")}
                  </button>
                  <button className="btn-ghost" disabled={busy === c.id} onClick={() => respond(c.id, false)}>
                    {t("form.decline")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {learning.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-subtle">
            {t("form.mine")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {learning.map((c) => (
              <Link
                key={c.id}
                href={`/formations/${c.id}`}
                className={`card card-hover group flex flex-col gap-3 ${
                  c.mandatory ? "border-bad/40" : ""
                }`}
              >
                <CardHead c={c} />
                <ProgressBar pct={c.my_progress} done={c.my_status === "completed"} />
                <div className="mt-auto flex items-center justify-between text-xs text-text-subtle">
                  <span>by {c.trainer_name}</span>
                  <span className="font-medium text-accent-text">
                    {c.my_status === "completed" ? "Completed 🎉" : c.my_progress > 0 ? "Continue →" : "Start →"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {teaching.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-subtle">
            {t("form.teaching")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teaching.map((c) => (
              <div key={c.id} className="card flex flex-col gap-3">
                <CardHead c={c} draft={c.status !== "published"} />
                <p className="line-clamp-2 text-sm text-text-muted">{c.summary}</p>
                <div className="flex items-center justify-between text-xs text-text-subtle">
                  <span>
                    {c.enrolled_count} trainee{c.enrolled_count === 1 ? "" : "s"} · {c.lesson_count} lessons
                  </span>
                </div>
                <div className="mt-auto flex gap-2">
                  <Link href={`/formations/${c.id}/manage`} className="btn-soft btn-sm flex-1 text-center">
                    📊 Trainees
                  </Link>
                  <Link href={`/formations/${c.id}/edit`} className="btn-ghost btn-sm flex-1 text-center">
                    ✏️ Edit
                  </Link>
                  <Link href={`/formations/${c.id}`} className="btn-ghost btn-sm text-center">
                    👁
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-subtle">
            {t("form.catalog")}
          </h2>
          {/* Required / optional is the filter people actually reach for: it
              answers "what do I still have to do", which no other axis does. */}
          <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-0.5">
            {(["all", "mandatory", "optional"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRequirement(key)}
                aria-pressed={requirement === key}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  requirement === key
                    ? "bg-accent text-accent-fg"
                    : "text-text-subtle hover:text-text"
                }`}
              >
                {t(`catalog.filter.${key}`)}
              </button>
            ))}
          </div>
          {owed.size > 0 && (
            <button
              onClick={() => setOnlyOwed((v) => !v)}
              className={`badge ${
                onlyOwed ? "bg-bad text-white" : "bg-bad/15 text-bad hover:bg-bad/25"
              }`}
            >
              ! {t("catalog.onlyMandatory", { n: owed.size })}
            </button>
          )}
        </div>
        {catalog.length === 0 && loaded && (
          <p className="text-sm text-text-subtle">
            {cards.length === 0
              ? "No trainings yet — seed the demo one with `python -m app.seed_formations`, or create the first."
              : "Nothing new here — you're already part of everything published. 🎓"}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mandatoryFirst(catalog, owed, onlyOwed).map((c) => (
            <div
              key={c.id}
              className={`card card-hover flex flex-col gap-3 ${
                owed.has(c.id) ? "border-bad/60 ring-1 ring-bad/30" : ""
              }`}
            >
              <Link href={`/formations/${c.id}`} className="space-y-3">
                {owed.get(c.id) && <OwedMarker owed={owed.get(c.id)!} />}
                <CardHead c={c} />
                <p className="line-clamp-2 text-sm text-text-muted">{c.summary}</p>
              </Link>
              <div className="flex items-center justify-between text-xs text-text-subtle">
                <span>by {c.trainer_name}</span>
                <span>
                  {c.lesson_count} lessons · {fmtDuration(c.duration_min)} · ⚡{c.total_xp} XP
                </span>
              </div>
              <div className="mt-auto">
                {c.open_enrollment ? (
                  <button className="btn btn-sm w-full" disabled={busy === c.id} onClick={() => join(c.id)}>
                    {t("form.join")}
                  </button>
                ) : (
                  <Link href={`/formations/${c.id}`} className="btn-ghost btn-sm block w-full text-center">
                    {t("form.inviteOnly")}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <TypesLegend />
    </div>
  );
}

function CardHead({ c, draft }: { c: FormationCard; draft?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-3xl">{c.emoji}</span>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {/* Mandatory first: it is the one badge that changes what the reader
              has to do, so it should not queue behind the decorative ones. */}
          {c.mandatory && <MandatoryBadge size="sm" />}
          {draft && <span className="badge bg-warn/15 text-warn">draft</span>}
          <span className={`badge ${LEVEL_BADGE[c.level] ?? "bg-edge text-text-subtle"}`}>{c.level}</span>
        </div>
      </div>
      <h3 className="font-medium leading-snug">{c.title}</h3>
    </div>
  );
}

function ProgressBar({ pct, done }: { pct: number; done?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-text-subtle">
        <span>{done ? "All lessons complete" : "Progress"}</span>
        <span className="font-medium text-text">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full transition-all ${done ? "bg-good" : "bg-accent"}`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}

function TypesLegend() {
  return (
    <section className="card">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">
        What&apos;s inside a training
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(F_LESSON_META).map(([k, m]) => (
          <div key={k} className="flex items-start gap-2.5">
            <span className="text-xl">{m.icon}</span>
            <div>
              <p className="text-sm font-medium">{m.label}</p>
              <p className="text-xs text-text-subtle">{m.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
