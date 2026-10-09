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
import Icon, { type IconName } from "@/components/Icon";
import Field from "@/components/form/Field";

const STEP_ICON: Record<string, IconName> = { formation: "formations", course: "courses", certification: "award" };

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
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">{t("pathways.title")}</h1>
          <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-text-muted">{t("pathways.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {owed.size > 0 && (
            <button
              type="button"
              onClick={() => setOnlyOwed((v) => !v)}
              aria-pressed={onlyOwed}
              className={`badge ${onlyOwed ? "bg-bad text-white" : "bg-bad/15 text-bad hover:bg-bad/25"}`}
            >
              ! {t("catalog.onlyMandatory", { n: owed.size })}
            </button>
          )}
          {canCreate && (
            <button type="button" className="btn" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} /> {t("pathways.new")}
            </button>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}
      {notice && (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-muted">
          <Icon name="check" size={15} className="text-good" /> {notice}
        </p>
      )}

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
          <div className="space-y-4">
            <Field id="pw-title" label={t("pw.f.title")} count={title.length} max={70}>
              <input id="pw-title" className="input py-2.5 text-base font-medium" autoComplete="off" autoFocus placeholder={t("pathways.titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field id="pw-summary" label={t("pw.f.summary")} optional count={summary.length} max={160}>
              <input id="pw-summary" className="input" autoComplete="off" placeholder={t("pw.f.summaryPh")} value={summary} onChange={(e) => setSummary(e.target.value)} />
            </Field>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 transition-colors hover:border-border-strong">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
              <span>
                <span className="block text-sm font-medium">{t("pathways.mandatoryToggle")}</span>
                <span className="block text-xs text-text-subtle">{t("pathways.mandatoryHint")}</span>
              </span>
            </label>
          </div>
        )}
        {builderStep === 1 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input max-w-[12rem]"
              aria-label={t("pathways.findStep")}
              placeholder={t("pathways.findStep")}
              value={stepFind}
              onChange={(e) => setStepFind(e.target.value)}
            />
            <select className="input max-w-sm" aria-label={t("pathways.addStep")} value={pick} onChange={(e) => setPick(e.target.value)}>
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
                  <option key={`x${c.id}`} value={`certification:${c.id}`}>{c.name}</option>
                ))}
              </optgroup>
            </select>
            <button type="button" className="btn-soft" disabled={!pick} onClick={addStep}>
              <Icon name="plus" size={14} /> {t("pathways.addStepButton")}
            </button>
          </div>
          {steps.length > 0 && (
            <ol className="divide-y divide-border rounded-xl border border-border">
              {steps.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/10 text-xs font-semibold text-accent-text tnum">{i + 1}</span>
                  <Icon name={STEP_ICON[s.entity_type] ?? "file"} size={14} className="text-text-subtle" />
                  <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
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
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-md text-text-subtle hover:bg-bad/10 hover:text-bad"
                    aria-label={`${t("common.remove")} — ${s.label}`}
                    onClick={() => setSteps(steps.filter((_, k) => k !== i))}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
        )}
        </Modal>
      )}


      {/* pathway cards — what this person owes leads, soonest deadline first */}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        {mandatoryFirst(pathways, owed, onlyOwed).map((p) => {
          // The next thing to do: the first required step not done and not
          // locked. It earns a callout so the reader never hunts for it.
          const next = p.enrolled && !p.complete ? p.steps.find((s) => !s.done && !s.locked) : undefined;
          const r = 20;
          const c = 2 * Math.PI * r;
          return (
            <article
              key={p.id}
              id={`pathway-${p.id}`}
              className={`panel scroll-mt-24 overflow-hidden ${owed.has(p.id) ? "border-bad/60 ring-1 ring-bad/30" : ""}`}
            >
              <header className="flex items-start gap-4 p-5">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-2xl" aria-hidden="true">
                  {p.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold leading-snug">
                    {p.title}
                    {owed.get(p.id) && <OwedMarker owed={owed.get(p.id)!} />}
                    {p.mandatory && (
                      <span className="badge badge-warn" title={t("pathways.mandatoryHint")}>
                        {t("pathways.mandatory")}
                      </span>
                    )}
                  </h2>
                  <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-text-subtle">
                    <span>{t("common.by")} {p.created_by_name}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tnum">{t("pathways.enrolled", { count: p.enrolled_count })}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tnum">
                      {p.optional_count > 0
                        ? t("pathways.countsWithOptional", { required: p.required_count, optional: p.optional_count })
                        : t("pathways.counts", { required: p.required_count })}
                    </span>
                    {p.due_date && (
                      <span className="text-warn">
                        · {t("pathways.due", { date: fmt.date(p.due_date, { day: "numeric", month: "short" }) })}
                      </span>
                    )}
                  </p>
                  {p.summary && <p className="mt-2 text-sm leading-relaxed text-text-muted">{p.summary}</p>}
                </div>
                {p.enrolled ? (
                  // Progress counts only the required spine, so optional
                  // extras can't make a mandatory pathway read as finished.
                  <div
                    className="relative grid h-12 w-12 shrink-0 place-items-center"
                    role="img"
                    aria-label={t("pathways.progress", { done: p.required_done, total: p.required_count })}
                    title={t("pathways.progress", { done: p.required_done, total: p.required_count })}
                  >
                    <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
                      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" className="stroke-surface-3" />
                      <circle
                        cx="24"
                        cy="24"
                        r={r}
                        fill="none"
                        strokeWidth="4"
                        strokeLinecap="round"
                        className={p.complete ? "stroke-good" : "stroke-accent"}
                        strokeDasharray={c}
                        strokeDashoffset={c - (c * p.percent) / 100}
                      />
                    </svg>
                    {p.complete ? (
                      <Icon name="check" size={16} strokeWidth={3} className="text-good" />
                    ) : (
                      <span className="text-[11px] font-semibold tnum">{p.percent}%</span>
                    )}
                  </div>
                ) : (
                  <button type="button" className="btn-soft btn-sm shrink-0" onClick={() => join(p)}>
                    <Icon name="plus" size={14} /> {t("pathways.join")}
                  </button>
                )}
              </header>

              {next && (
                <Link
                  href={next.link}
                  target={next.link.startsWith("http") ? "_blank" : undefined}
                  className="group mx-5 mb-4 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 transition-colors hover:border-accent"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg">
                    <Icon name={STEP_ICON[next.entity_type] ?? "file"} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-accent-text">{t("pw.nextUp")}</span>
                    <span className="block truncate text-sm font-semibold">{next.title}</span>
                  </span>
                  <Icon name="arrow-right" size={16} className="text-accent-text transition-transform group-hover:translate-x-0.5" />
                </Link>
              )}

              <ol className="px-5 pb-4">
                {p.steps.map((s, i) => {
                  const last = i === p.steps.length - 1;
                  const circle = s.done
                    ? "border-good bg-good text-white"
                    : s.locked
                      ? "border-border bg-surface-2 text-text-subtle"
                      : "border-border-strong bg-surface text-text-muted";
                  const body = (
                    <>
                      <span className={`relative z-[1] mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-[11px] font-semibold tnum ${circle}`}>
                        {s.done ? <Icon name="check" size={12} strokeWidth={3} /> : s.locked ? <Icon name="lock" size={11} /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1 py-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={`font-medium ${s.locked ? "text-text-subtle" : "text-text"}`}>{s.title}</span>
                          {s.milestone && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-text" title={t("pathways.milestoneBadgeHint")}>
                              <Icon name="challenges" size={11} /> {t("pathways.milestone")}
                            </span>
                          )}
                          {!s.required && (
                            <span className="text-[11px] text-text-subtle" title={t("pathways.optionalBadgeHint")}>
                              {t("common.optional")}
                            </span>
                          )}
                        </span>
                        {s.locked ? (
                          <span className="mt-0.5 block text-xs text-text-subtle">{t("pathways.locked", { title: s.locked_by })}</span>
                        ) : (
                          s.note && <span className="mt-0.5 block text-xs text-text-subtle">{s.note}</span>
                        )}
                        {/* How far into this step they are, only where there is
                            something real to measure: a bar at 0 under every
                            untouched step is noise rather than information. */}
                        {s.percent !== null && s.percent > 0 && !s.done && (
                          <span className="mt-1.5 flex items-center gap-2">
                            <span className="h-1 w-28 overflow-hidden rounded-full bg-surface-3">
                              <span className="block h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${Math.max(0.03, s.percent / 100)})` }} />
                            </span>
                            <span className="text-[11px] text-text-subtle tnum">{s.percent}%</span>
                          </span>
                        )}
                      </span>
                      <span className="mt-1.5 inline-flex shrink-0 items-center gap-1 text-xs text-text-subtle">
                        <Icon name={STEP_ICON[s.entity_type] ?? "file"} size={12} />
                        <span className="hidden sm:inline">{t(`pw.type.${s.entity_type}`, s.entity_type)}</span>
                      </span>
                    </>
                  );
                  return (
                    <li key={s.id} className="relative">
                      {!last && (
                        <span
                          className={`absolute left-[13px] top-9 h-[calc(100%-1.75rem)] w-0.5 ${s.done ? "bg-good/40" : "bg-border"}`}
                          aria-hidden="true"
                        />
                      )}
                      {/* A locked step renders as plain markup rather than a
                          link: the gate should stop the click, not merely look
                          like it does. */}
                      {s.locked ? (
                        <div aria-disabled className="flex cursor-not-allowed items-start gap-3 py-1.5">
                          {body}
                        </div>
                      ) : (
                        <Link
                          href={s.link}
                          target={s.link.startsWith("http") ? "_blank" : undefined}
                          className="group -mx-2 flex items-start gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2"
                        >
                          {body}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ol>

              {(canCreate || canAssign) && (
                <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2/50 px-5 py-2.5">
                  {canAssign && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setAssignTo(p)}>
                      <Icon name="team" size={14} /> {t("pw.assign")}
                    </button>
                  )}
                  {canCreate && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => startEdit(p)}>
                      <Icon name="pencil" size={13} /> {t("pathways.edit")}
                    </button>
                  )}
                </footer>
              )}
            </article>
          );
        })}
      </div>

      {/* Assigning is a decision taken about a pathway, not part of reading one:
          in a dialog it has the whole screen and the list behind stays legible. */}
      {assignTo && (
        <Modal
          title={t("pw.assignTitle", { title: assignTo.title })}
          size="md"
          onClose={() => setAssignTo(null)}
        >
          <AssignPanel
            entityType="pathway"
            entityId={assignTo.id}
            onAssigned={() => {
              refresh();
              setAssignTo(null);
            }}
          />
        </Modal>
      )}

      {pathways.length === 0 && (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <Icon name="route" size={22} className="mx-auto text-text-subtle" />
          <p className="mt-3 text-sm text-text-muted">{canCreate ? t("pw.emptyCanCreate") : t("pathways.empty")}</p>
        </div>
      )}
    </div>
  );
}
