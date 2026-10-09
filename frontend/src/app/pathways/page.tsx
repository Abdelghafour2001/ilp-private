"use client";

import { useCallback, useEffect, useState } from "react";
import { useMandatory, mandatoryFirst } from "@/lib/mandatory";
import OwedMarker from "@/components/OwedMarker";
import Link from "next/link";
import {
  api,
  type CourseSummary,
  type Certification,
  type FormationCard,
  type Learner,
  type Pathway,
  type Team,
} from "@/lib/api";
import AssignPanel from "@/components/AssignPanel";
import Modal from "@/components/Modal";
import { getStoredLearner } from "@/lib/learner";
import { useFormat, useT } from "@/lib/i18n";

interface DraftStep {
  entity_type: string;
  entity_id: number;
  label: string;
  /** Mandatory step vs optional enrichment. */
  required: boolean;
  /** Checkpoint: steps after it stay locked until the required work before it is done. */
  milestone: boolean;
}

export default function PathwaysPage() {
  const t = useT();
  const fmt = useFormat();
  const [me, setMe] = useState<Learner | null>(null);
  const [pathways, setPathways] = useState<Pathway[]>([]);
  const [onlyOwed, setOnlyOwed] = useState(false);
  const owed = useMandatory("pathway");
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // creation form — also the edit form: `editingId` says which.
  const [creating, setCreating] = useState(false);
  const [builderStep, setBuilderStep] = useState(0);

  // A hash set before the list has loaded scrolls to nothing, so do it again
  // once the cards exist — otherwise somebody following a notification lands
  // at the top of the page and has to hunt for the pathway they were told
  // about.
  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    if (!anchor || pathways.length === 0) return;
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pathways]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [mandatory, setMandatory] = useState(false);
  const [pick, setPick] = useState("");
  // The catalogue is 800-odd entries, most of them provider courses, so the
  // step picker needs narrowing before it is a list anybody can read.
  const [stepFind, setStepFind] = useState("");
  /** The pathway whose assign dialog is open, or null. */
  const [assignTo, setAssignTo] = useState<Pathway | null>(null);
  const [trainings, setTrainings] = useState<FormationCard[]>([]);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [certs, setCerts] = useState<Certification[]>([]);

  const canCreate =
    !!me && ["trainer", "manager", "bu_head", "hr", "hr_lead", "admin"].includes(me.role ?? "");
  const canAssign = myTeams.length > 0 || me?.role === "hr" || me?.role === "admin";

  const refresh = useCallback(() => {
    const learner = getStoredLearner();
    setMe(learner);
    api.listPathways(learner?.id).then(setPathways).catch((e) => setError(String(e)));
    if (learner) {
      api.listTeams(learner.id).then(setMyTeams).catch(() => {});
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!assignTo) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAssignTo(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assignTo]);

  useEffect(() => {
    if (!creating) return;
    api.listFormations(me?.id).then((fs) => setTrainings(fs.filter((f) => f.status === "published"))).catch(() => {});
    api.listCourses().then(setCourses).catch(() => {});
    api.listCertifications().then(setCerts).catch(() => {});
  }, [creating, me?.id]);

  /** Whatever the author typed, applied to any list of pickable things. */
  function matching<T>(rows: T[], label: (row: T) => string): T[] {
    const term = stepFind.trim().toLowerCase();
    const hits = term ? rows.filter((r) => label(r).toLowerCase().includes(term)) : rows;
    // A select with 800 options is not a list; the search box is how the rest
    // are reached.
    return hits.slice(0, 100);
  }

  function patchStep(index: number, patch: Partial<DraftStep>) {
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addStep() {
    if (!pick) return;
    const [etype, idStr] = pick.split(":");
    const eid = Number(idStr);
    const label =
      etype === "formation"
        ? trainings.find((t) => t.id === eid)?.title
        : etype === "course"
          ? courses.find((c) => c.id === eid)?.title
          : certs.find((c) => c.id === eid)?.name;
    if (!label || steps.some((s) => s.entity_type === etype && s.entity_id === eid)) return;
    setSteps([...steps, { entity_type: etype, entity_id: eid, label, required: true, milestone: false }]);
    setPick("");
  }

  function resetForm() {
    setTitle("");
    setSummary("");
    setSteps([]);
    setMandatory(false);
    setCreating(false);
    setBuilderStep(0);
    setEditingId(null);
  }

  /** Load a pathway back into the form. Building one with a wrong step used to
   *  mean living with it: there was no way to edit it. */
  function startEdit(p: Pathway) {
    setEditingId(p.id);
    setTitle(p.title);
    setSummary(p.summary);
    setMandatory(p.mandatory);
    setSteps(
      p.steps.map((s) => ({
        entity_type: s.entity_type,
        entity_id: s.entity_id,
        label: s.title,
        required: s.required,
        milestone: s.milestone,
      })),
    );
    setCreating(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        summary: summary.trim(),
        mandatory,
        steps: steps.map((s) => ({
          entity_type: s.entity_type,
          entity_id: s.entity_id,
          required: s.required,
          milestone: s.milestone,
        })),
        learner_id: me?.id,
      };
      if (editingId) await api.updatePathway(editingId, body);
      else await api.createPathway(body);
      resetForm();
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function join(p: Pathway) {
    if (!me) {
      setError(t("common.signInFirst"));
      return;
    }
    await api.enrollPathway(p.id, me.id).catch((e) => setError(String(e)));
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("pathways.title")}</h1>
          <p className="mt-1 text-sm text-text-muted">{t("pathways.subtitle")}</p>
        </div>
        {canCreate && (
          <button className="btn" onClick={() => (creating ? resetForm() : setCreating(true))}>
            {creating ? t("common.close") : `+ ${t("pathways.new")}`}
          </button>
        )}
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}
      {notice && <div className="card border-good/40 text-sm text-good">{notice}</div>}

      {/* Building a pathway is a dialog, not a card wedged above the list: it
          used to push every existing pathway off the screen while open, and
          two steps keep each half short — name it, then fill it. */}
      {creating && (
        <Modal
          title={editingId ? t("pathways.edit", "Edit pathway") : t("pathways.new")}
          lede={t("pathways.builderLede", "Chain trainings, courses and certifications; learners follow them in order.")}
          size="lg"
          onClose={resetForm}
          step={builderStep}
          stepLabels={[t("pathways.stepName", "Name it"), t("pathways.stepContent", "Add the steps")]}
          footer={
            <>
              <button className="btn-ghost" onClick={resetForm}>
                {t("common.cancel")}
              </button>
              {builderStep === 1 && (
                <button className="btn-soft" onClick={() => setBuilderStep(0)}>
                  {t("common.back", "Back")}
                </button>
              )}
              {builderStep === 0 ? (
                <button className="btn" disabled={!title.trim()} onClick={() => setBuilderStep(1)}>
                  {t("common.next", "Next")}
                </button>
              ) : (
                <button
                  className="btn"
                  disabled={busy || !title.trim() || steps.length === 0}
                  onClick={create}
                >
                  {editingId
                    ? t("pathways.saveButton", { count: steps.length })
                    : t("pathways.createButton", { count: steps.length })}
                </button>
              )}
            </>
          }
        >
        {builderStep === 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input" placeholder={t("pathways.titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="input" placeholder={t("pathways.summaryPlaceholder")} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
        )}
        {builderStep === 1 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input max-w-[12rem]"
              placeholder={t("pathways.findStep")}
              value={stepFind}
              onChange={(e) => setStepFind(e.target.value)}
            />
            <select className="input max-w-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t("pathways.addStep")}</option>
              <optgroup label={t("nav.formations")}>
                {matching(trainings, (f) => f.title).map((f) => (
                  <option key={`f${f.id}`} value={`formation:${f.id}`}>{f.emoji} {f.title}</option>
                ))}
              </optgroup>
              {/* Our own courses and the provider's are both steps, but an
                  author picking one wants to know which they are choosing. */}
              <optgroup label={t("nav.courses")}>
                {matching(courses.filter((c) => !c.external_url), (c) => c.title).map((c) => (
                  <option key={`c${c.id}`} value={`course:${c.id}`}>{c.emoji} {c.title}</option>
                ))}
              </optgroup>
              <optgroup label={t("pathways.providerCourses")}>
                {matching(courses.filter((c) => c.external_url), (c) => `${c.title} ${c.provider}`).map((c) => (
                  <option key={`c${c.id}`} value={`course:${c.id}`}>
                    {c.emoji} {c.title} — {c.provider}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("nav.certifications")}>
                {matching(certs, (c) => c.name).map((c) => (
                  <option key={`x${c.id}`} value={`certification:${c.id}`}>🎖️ {c.name}</option>
                ))}
              </optgroup>
            </select>
            <button className="btn-soft btn-sm" disabled={!pick} onClick={addStep}>{t("pathways.addStepButton")}</button>
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={mandatory}
                onChange={(e) => setMandatory(e.target.checked)}
              />
              {t("pathways.mandatoryToggle")}
            </label>
          </div>
          {steps.length > 0 && (
            <ol className="space-y-1">
              {steps.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-accent/15 text-xs font-bold text-accent-text">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <label
                    className="flex items-center gap-1 text-xs text-text-muted"
                    title={t("pathways.stepRequiredHint")}
                  >
                    <input
                      type="checkbox"
                      checked={s.required}
                      onChange={(e) => patchStep(i, { required: e.target.checked })}
                    />
                    {t("pathways.stepRequired")}
                  </label>
                  <label
                    className="flex items-center gap-1 text-xs text-text-muted"
                    title={t("pathways.stepMilestoneHint")}
                  >
                    <input
                      type="checkbox"
                      checked={s.milestone}
                      onChange={(e) => patchStep(i, { milestone: e.target.checked })}
                    />
                    {t("pathways.stepMilestone")}
                  </label>
                  <button className="text-xs text-bad hover:underline" onClick={() => setSteps(steps.filter((_, k) => k !== i))}>{t("common.remove")}</button>
                </li>
              ))}
            </ol>
          )}
        </>
        )}
        </Modal>
      )}

      {owed.size > 0 && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOnlyOwed((v) => !v)}
            className={`badge ${
              onlyOwed ? "bg-bad text-white" : "bg-bad/15 text-bad hover:bg-bad/25"
            }`}
          >
            ! {t("catalog.onlyMandatory", { n: owed.size })}
          </button>
        </div>
      )}

      {/* pathway cards — what this person owes leads, soonest deadline first */}
      <div className="grid gap-4 lg:grid-cols-2">
        {mandatoryFirst(pathways, owed, onlyOwed).map((p) => (
          // The anchor /pathways/<id> redirects to, and what a notification
          // link ultimately opens. scroll-mt keeps it clear of the header.
          <div
            key={p.id}
            id={`pathway-${p.id}`}
            className={`card scroll-mt-24 space-y-3 ${
              owed.has(p.id) ? "border-bad/60 ring-1 ring-bad/30" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3">
                <span className="text-3xl">{p.emoji}</span>
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {p.title}
                    {owed.get(p.id) && <OwedMarker owed={owed.get(p.id)!} />}
                    <span
                      className={`badge ${p.mandatory ? "bg-warn/15 text-warn" : "bg-edge text-text-subtle"}`}
                      title={
                        p.mandatory
                          ? t("pathways.mandatoryHint")
                          : t("pathways.optionalHint")
                      }
                    >
                      {p.mandatory ? t("pathways.mandatory") : t("pathways.optional")}
                    </span>
                  </p>
                  <p className="text-xs text-text-subtle">
                    {t("common.by")} {p.created_by_name} ·{" "}
                    {t("pathways.enrolled", { count: p.enrolled_count })} ·{" "}
                    {p.optional_count > 0
                      ? t("pathways.countsWithOptional", {
                          required: p.required_count,
                          optional: p.optional_count,
                        })
                      : t("pathways.counts", { required: p.required_count })}
                    {p.due_date && (
                      <span className="ml-1 text-warn">
                        {" · "}
                        {t("pathways.due", {
                          date: fmt.date(p.due_date, { day: "numeric", month: "short" }),
                        })}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canCreate && (
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => startEdit(p)}
                    title={t("pathways.edit")}
                  >
                    {t("pathways.edit")}
                  </button>
                )}
                {p.enrolled ? (
                  <span className="badge badge-accent">{p.percent}%</span>
                ) : (
                  <button className="btn-soft btn-sm" onClick={() => join(p)}>{t("pathways.join")}</button>
                )}
              </div>
            </div>
            {p.summary && <p className="text-sm text-text-muted">{p.summary}</p>}

            {p.enrolled && (
              <div className="space-y-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${p.complete ? "bg-good" : "bg-accent"}`}
                    style={{ width: `${Math.max(2, p.percent)}%` }}
                  />
                </div>
                {/* Progress counts only the required spine, so optional extras
                    can't make a mandatory pathway read as finished. */}
                <p className="text-[11px] text-text-subtle">
                  {t("pathways.progress", {
                    done: p.required_done,
                    total: p.required_count,
                  })}
                  {p.locked_by && (
                    <span className="ml-1 text-warn">
                      {" · "}
                      {t("pathways.blockedBy", { title: p.locked_by })}
                    </span>
                  )}
                </p>
              </div>
            )}

            <ol className="space-y-1.5">
              {p.steps.map((s, i) => {
                const body = (
                  <>
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                        s.done ? "bg-good/20 text-good" : "bg-surface-2 text-text-subtle"
                      }`}
                    >
                      {s.done ? "✓" : s.locked ? "🔒" : i + 1}
                    </span>
                    <span className="text-lg">{s.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{s.title}</span>
                        {s.milestone && (
                          <span
                            className="badge bg-accent/15 text-accent-text"
                            title={t("pathways.milestoneBadgeHint")}
                          >
                            {t("pathways.milestone")}
                          </span>
                        )}
                        {!s.required && (
                          <span
                            className="badge bg-edge text-text-subtle"
                            title={t("pathways.optionalBadgeHint")}
                          >
                            {t("common.optional")}
                          </span>
                        )}
                      </span>
                      {s.locked ? (
                        <span className="block truncate text-xs text-warn">
                          {t("pathways.locked", { title: s.locked_by })}
                        </span>
                      ) : (
                        s.note && (
                          <span className="block truncate text-xs text-text-subtle">{s.note}</span>
                        )
                      )}
                      {/* How far into this step they are. Only drawn where
                          there is something real to draw: null means the step
                          has nothing to measure, and a bar at 0 under every
                          untouched step is noise rather than information. */}
                      {s.percent !== null && s.percent > 0 && !s.done && (
                        <span className="mt-1 flex items-center gap-1.5">
                          <span className="h-1 w-24 overflow-hidden rounded-full bg-surface-2">
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${Math.max(3, s.percent)}%` }}
                            />
                          </span>
                          <span className="text-[10px] tnum text-text-subtle">{s.percent}%</span>
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] uppercase text-text-subtle">
                      {s.entity_type === "formation" ? "training" : s.entity_type}
                    </span>
                  </>
                );

                // A locked step renders as plain markup rather than a link: the
                // gate should stop the click, not merely look like it does.
                return (
                  <li key={s.id}>
                    {s.locked ? (
                      <div
                        aria-disabled
                        className="flex cursor-not-allowed items-center gap-2.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm opacity-60"
                      >
                        {body}
                      </div>
                    ) : (
                      <Link
                        href={s.link}
                        target={s.link.startsWith("http") ? "_blank" : undefined}
                        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition hover:border-accent ${
                          s.done ? "border-good/30 bg-good/5" : "border-border"
                        }`}
                      >
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>

            {/* Assigning a pathway is the same job as assigning a course, so
                it is the same form — named people or a team, mandatory or not,
                with a deadline. The team buttons could only do one of those. */}
            {canAssign && (
              <div className="border-t border-border pt-2">
                <button className="btn-ghost btn-sm" onClick={() => setAssignTo(p)}>
                  📌 {t("pathways.assignTo")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Assigning is a decision taken about a pathway, not part of reading one:
          in a dialog it has the whole screen and the card below stays legible. */}
      {assignTo && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[8vh]"
          role="dialog"
          aria-modal="true"
          onClick={() => setAssignTo(null)}
        >
          <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between text-sm text-white">
              <span className="font-medium">
                {assignTo.emoji} {assignTo.title}
              </span>
              <button className="text-white/80 hover:text-white" onClick={() => setAssignTo(null)}>
                ✕ {t("common.close")}
              </button>
            </div>
            <AssignPanel
              entityType="pathway"
              entityId={assignTo.id}
              onAssigned={() => {
                refresh();
                setAssignTo(null);
              }}
            />
          </div>
        </div>
      )}

      {pathways.length === 0 && (
        <p className="text-sm text-text-subtle">
          {canCreate ? t("pathways.emptyCanCreate") : t("pathways.empty")}
        </p>
      )}
    </div>
  );
}
