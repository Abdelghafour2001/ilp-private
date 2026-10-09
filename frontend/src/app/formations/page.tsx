"use client";

import { useCallback, useEffect, useState } from "react";
import { useMandatory, mandatoryFirst } from "@/lib/mandatory";
import OwedMarker from "@/components/OwedMarker";
import Link from "next/link";
import { api, type FormationCard, type Learner } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { F_LESSON_META, fmtDuration } from "@/lib/formationLessons";
import CourseCover from "@/components/CourseCover";
import Icon, { type IconName } from "@/components/Icon";
import MandatoryBadge from "@/components/MandatoryBadge";
import { useT } from "@/lib/i18n";

const LEVEL_DOT: Record<string, string> = {
  beginner: "bg-good",
  intermediate: "bg-warn",
  advanced: "bg-bad",
};

/** The legend's glyphs, from the app's icon set rather than emoji. */
const TYPE_ICON: Record<string, IconName> = {
  article: "file",
  video: "play",
  lab: "labs",
  quiz: "quiz",
  prompt_playground: "sparkles",
  prompt_challenge: "trophy",
  external_course: "external",
};

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
      setError(t("form.hub.signIn"));
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
    <div className="space-y-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">{t("form.hub.title")}</h1>
          <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-text-muted">{t("form.hub.lede")}</p>
        </div>
        {canTeach && (
          <Link href="/formations/new" className="btn shrink-0">
            <Icon name="plus" size={16} /> {t("form.hub.new")}
          </Link>
        )}
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} aria-label={t("common.close")} className="shrink-0 hover:opacity-70">
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      {invitations.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Icon name="mail" size={16} className="text-accent-text" /> {t("form.hub.invited")}
          </h2>
          <ul className="panel divide-y divide-border overflow-hidden border-accent/40 shadow-glow">
            {invitations.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-4 p-4">
                <Thumb c={c} />
                <div className="min-w-0 flex-1">
                  <Link href={`/formations/${c.id}`} className="font-medium text-text hover:text-accent-text">
                    {c.title}
                  </Link>
                  <p className="mt-0.5 text-sm text-text-muted">
                    {t("form.hub.invitedBy", { who: c.trainer_name })} ·{" "}
                    <span className="tnum">
                      {t("form.hub.lessons", { n: c.lesson_count })} · {fmtDuration(c.duration_min)} · {c.total_xp}&nbsp;XP
                    </span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className="btn-ghost btn-sm" disabled={busy === c.id} onClick={() => respond(c.id, false)}>
                    {t("form.decline")}
                  </button>
                  <button className="btn btn-sm" disabled={busy === c.id} onClick={() => respond(c.id, true)}>
                    {t("form.acceptStart")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {learning.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base font-semibold">{t("form.mine")}</h2>
            <span className="text-xs text-text-subtle tnum">{learning.length}</span>
          </div>
          <ul className="panel divide-y divide-border overflow-hidden">
            {learning.map((c) => {
              const done = c.my_status === "completed";
              return (
                <li key={c.id}>
                  <Link
                    href={`/formations/${c.id}`}
                    className="group flex items-center gap-4 p-4 transition-colors hover:bg-surface-2"
                  >
                    <Thumb c={c} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-text group-hover:text-accent-text">{c.title}</span>
                        {c.mandatory && <MandatoryBadge size="sm" />}
                      </div>
                      <p className="mt-0.5 text-xs text-text-subtle">
                        {t("common.by")} {c.trainer_name}
                      </p>
                    </div>
                    <div className="hidden w-48 shrink-0 sm:block">
                      <ProgressBar pct={c.my_progress} done={done} label={c.title} />
                    </div>
                    <span className="w-24 shrink-0 text-right text-sm font-medium text-accent-text">
                      {done ? (
                        <span className="inline-flex items-center gap-1 text-good">
                          <Icon name="check" size={14} /> {t("form.hub.done")}
                        </span>
                      ) : c.my_progress > 0 ? (
                        t("form.hub.continue")
                      ) : (
                        t("form.hub.start")
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {teaching.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">{t("form.teaching")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teaching.map((c) => (
              <div key={c.id} className="panel flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <Thumb c={c} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-snug">{c.title}</p>
                    <p className="mt-0.5 text-xs text-text-subtle tnum">
                      {t("form.hub.trainees", { n: c.enrolled_count })} · {t("form.hub.lessons", { n: c.lesson_count })}
                    </p>
                  </div>
                  {c.status !== "published" && <span className="badge badge-warn">{t("form.hub.draft")}</span>}
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-text-muted">{c.summary}</p>
                <div className="mt-auto flex gap-2 pt-4">
                  <Link href={`/formations/${c.id}/manage`} className="btn-soft btn-sm flex-1">
                    <Icon name="team" size={14} /> {t("form.hub.traineesBtn")}
                  </Link>
                  <Link href={`/formations/${c.id}/edit`} className="btn-ghost btn-sm flex-1">
                    <Icon name="pencil" size={14} /> {t("course.edit")}
                  </Link>
                  <Link
                    href={`/formations/${c.id}`}
                    className="btn-ghost btn-sm"
                    aria-label={t("form.hub.preview")}
                    title={t("form.hub.preview")}
                  >
                    <Icon name="arrow-right" size={14} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t("form.catalog")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {owed.size > 0 && (
              <button
                onClick={() => setOnlyOwed((v) => !v)}
                aria-pressed={onlyOwed}
                className={`badge ${onlyOwed ? "bg-bad text-white" : "bg-bad/15 text-bad hover:bg-bad/25"}`}
              >
                ! {t("catalog.onlyMandatory", { n: owed.size })}
              </button>
            )}
            {/* Required / optional is the filter people actually reach for: it
                answers "what do I still have to do", which no other axis does. */}
            <div role="group" className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
              {(["all", "mandatory", "optional"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRequirement(key)}
                  aria-pressed={requirement === key}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    requirement === key ? "bg-surface text-text shadow-xs" : "text-text-subtle hover:text-text"
                  }`}
                >
                  {t(`catalog.filter.${key}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
        {catalog.length === 0 && loaded && (
          <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-text-muted">
            {cards.length === 0 ? t("form.hub.emptyAll") : t("form.hub.emptyJoined")}
          </div>
        )}
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {mandatoryFirst(catalog, owed, onlyOwed).map((c) => (
            <article key={c.id} className="group flex flex-col">
              <Link href={`/formations/${c.id}`} className="flex flex-1 flex-col rounded-xl">
                <div
                  className={`relative overflow-hidden rounded-xl border transition-[border-color,box-shadow,transform] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md ${
                    owed.has(c.id) ? "border-bad/60 ring-1 ring-bad/30" : "border-border group-hover:border-border-strong"
                  }`}
                >
                  <CourseCover emoji={c.emoji} title={c.title} className="aspect-[16/9] rounded-none" />
                  {(owed.get(c.id) || c.mandatory) && (
                    <span className="absolute left-3 top-3 flex gap-1.5">
                      {owed.get(c.id) ? <OwedMarker owed={owed.get(c.id)!} /> : <MandatoryBadge size="sm" />}
                    </span>
                  )}
                </div>
                <p className="mt-3.5 flex items-center gap-1.5 text-xs text-text-subtle">
                  <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[c.level] ?? "bg-text-subtle"}`} aria-hidden="true" />
                  <span className="capitalize">{t(`common.${c.level}`, c.level)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tnum">{t("form.hub.lessons", { n: c.lesson_count })}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tnum">{fmtDuration(c.duration_min)}</span>
                </p>
                <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-text group-hover:text-accent-text">
                  {c.title}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-text-muted">{c.summary}</p>
              </Link>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-text-subtle">
                <span className="truncate">
                  {t("common.by")} {c.trainer_name} ·{" "}
                  <span className="inline-flex items-center gap-0.5 tnum">
                    <Icon name="bolt" size={11} className="text-iris" />
                    {c.total_xp}&nbsp;XP
                  </span>
                </span>
                {c.open_enrollment ? (
                  <button
                    className="btn-ghost btn-sm shrink-0"
                    disabled={busy === c.id}
                    aria-busy={busy === c.id}
                    onClick={() => join(c.id)}
                    aria-label={`${t("form.join")} — ${c.title}`}
                  >
                    <Icon name="plus" size={14} /> {t("form.joinShort")}
                  </button>
                ) : (
                  <span className="shrink-0 rounded-md bg-surface-3 px-2 py-1 text-[11px] font-medium text-text-muted">
                    {t("form.hub.inviteOnly")}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <TypesLegend />
    </div>
  );
}

function Thumb({ c }: { c: FormationCard }) {
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-xl" aria-hidden="true">
      {c.emoji}
    </span>
  );
}

function ProgressBar({ pct, done, label }: { pct: number; done?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full origin-left rounded-full transition-transform duration-500 ${done ? "bg-good" : "bg-accent"}`}
          style={{ transform: `scaleX(${Math.max(0.02, pct / 100)})` }}
        />
      </div>
      <span className="w-9 text-right text-xs font-medium text-text tnum">{pct}%</span>
    </div>
  );
}

function TypesLegend() {
  const t = useT();
  return (
    <section className="border-t border-border pt-8">
      <h2 className="mb-1 text-base font-semibold">{t("form.hub.inside")}</h2>
      <p className="mb-5 text-sm text-text-muted">{t("form.hub.insideLede")}</p>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(F_LESSON_META).map(([k, m]) => (
          <div key={k} className="flex items-start gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-muted" aria-hidden="true">
              <Icon name={TYPE_ICON[k] ?? "file"} size={15} />
            </span>
            <div>
              <dt className="text-sm font-medium">{m.label}</dt>
              <dd className="text-xs leading-relaxed text-text-subtle">{m.desc}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
