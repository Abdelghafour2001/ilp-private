"use client";

/**
 * Assign learning — the four questions, in the order L&D actually ask them.
 *
 *   what · to whom · under what rule · and is that really what I meant
 *
 * The design problem here is not decoration, it is consequence. Pressing the
 * last button writes an obligation onto up to a few hundred people's records
 * and mails every one of them. So the wizard is built around making that
 * consequence visible the whole way through:
 *
 * * a summary rail, pinned beside the steps, that answers "what am I about to
 *   do" at every moment rather than only at the end;
 * * a live count straight from the server — not a guess from the browser —
 *   that updates as the audience changes, including who already has the thing
 *   and who has no email address and will therefore never hear about it;
 * * a final button that says the real number: "Assign 24 items", never "Done".
 *
 * Steps stay clickable once reached, because people revise the audience after
 * seeing the count and should not have to walk forward through the whole thing
 * again to do it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type CampaignItem,
  type CampaignPreview,
  type CampaignResult,
  type CourseSummary,
  type FormationCard,
  type GovDirectoryPerson,
  type Pathway,
  type Team,
} from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useI18n } from "@/lib/i18n";

type Kind = "formation" | "pathway" | "course";

interface Pick extends CampaignItem {
  title: string;
  hint: string;
}

const KIND_META: Record<Kind, { icon: string; key: string; fallback: string }> = {
  formation: { icon: "🎓", key: "nav.formations", fallback: "Trainings" },
  pathway: { icon: "🧭", key: "nav.pathways", fallback: "Pathways" },
  course: { icon: "📘", key: "nav.courses", fallback: "Courses" },
};

const STEPS = [
  { key: "wizard.step.what", fallback: "What" },
  { key: "wizard.step.who", fallback: "Who" },
  { key: "wizard.step.rules", fallback: "Rules" },
  { key: "wizard.step.review", fallback: "Review" },
];

/** Deadlines people actually pick, so nobody counts days on a calendar. */
function quickDates(): { label: string; value: string }[] {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date();
  const inDays = (n: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  const quarterEnd = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0);
  return [
    { label: "2 weeks", value: inDays(14) },
    { label: "30 days", value: inDays(30) },
    { label: "End of quarter", value: iso(quarterEnd) },
  ];
}

export default function AssignWizard({ onClose }: { onClose: (sent: boolean) => void }) {
  const { t } = useI18n();
  const me = getStoredLearner();

  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);

  // --- what ---------------------------------------------------------------
  const [kind, setKind] = useState<Kind>("formation");
  const [find, setFind] = useState("");
  const [trainings, setTrainings] = useState<FormationCard[]>([]);
  const [pathways, setPathways] = useState<Pathway[]>([]);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [picked, setPicked] = useState<Pick[]>([]);

  // --- who ----------------------------------------------------------------
  const [teams, setTeams] = useState<Team[]>([]);
  const [bus, setBus] = useState<string[]>([]);
  const [people, setPeople] = useState<GovDirectoryPerson[]>([]);
  const [personFind, setPersonFind] = useState("");
  const [personHits, setPersonHits] = useState<GovDirectoryPerson[]>([]);
  const [chosenTeams, setChosenTeams] = useState<number[]>([]);
  const [chosenBus, setChosenBus] = useState<string[]>([]);

  // --- rules --------------------------------------------------------------
  const [mandatory, setMandatory] = useState(true);
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");

  // --- outcome ------------------------------------------------------------
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<CampaignResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listFormations(me?.id).then((f) => setTrainings(f.filter((x) => x.status === "published"))).catch(() => {});
    api.listPathways(me?.id).then(setPathways).catch(() => {});
    api.listTeams(me?.id).then(setTeams).catch(() => {});
    // The unit list comes from governance, which L&D and HR can already read;
    // a manager cannot, and simply gets no BU chips.
    api
      .govOverview(me?.id)
      .then((o) => setBus(o.business_units.filter((b) => !b.archived).map((b) => b.name)))
      .catch(() => setBus([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The course catalogue is 800-odd entries, so it is searched, not listed.
  useEffect(() => {
    if (kind !== "course") return;
    const term = find.trim();
    if (term.length < 3) return setCourses([]);
    const timer = setTimeout(() => {
      api.listCourses(term).then((rows) => setCourses(rows.slice(0, 12))).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [find, kind]);

  useEffect(() => {
    const term = personFind.trim();
    if (term.length < 2) return setPersonHits([]);
    const timer = setTimeout(() => {
      api.govPeople(me?.id, { q: term }).then((r) => setPersonHits(r.people.slice(0, 6))).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [personFind, me?.id]);

  const audience = useMemo(
    () => ({
      learner_ids: people.map((p) => p.id),
      team_ids: chosenTeams,
      bus: chosenBus,
      practices: [],
      roles: [],
    }),
    [people, chosenTeams, chosenBus],
  );

  const hasAudience = people.length > 0 || chosenTeams.length > 0 || chosenBus.length > 0;

  const request = useMemo(
    () => ({
      items: picked.map((p) => ({ entity_type: p.entity_type, entity_id: p.entity_id })),
      audience,
      mandatory,
      due_date: due || null,
      note,
      learner_id: me?.id,
    }),
    [picked, audience, mandatory, due, note, me?.id],
  );

  /** The count comes from the server: the browser does not know who is in a BU,
   *  and a number that is nearly right is worse than no number. */
  const refreshPreview = useCallback(() => {
    if (!picked.length || !hasAudience) return setPreview(null);
    setPreviewing(true);
    api
      .assignmentPreview(request)
      .then(setPreview)
      .catch(() => setPreview(null))
      .finally(() => setPreviewing(false));
  }, [request, picked.length, hasAudience]);

  useEffect(() => {
    const timer = setTimeout(refreshPreview, 300);
    return () => clearTimeout(timer);
  }, [refreshPreview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(item: Pick) {
    setPicked((current) =>
      current.some((p) => p.entity_type === item.entity_type && p.entity_id === item.entity_id)
        ? current.filter((p) => !(p.entity_type === item.entity_type && p.entity_id === item.entity_id))
        : [...current, item],
    );
  }

  const isPicked = (entity_type: Kind, entity_id: number) =>
    picked.some((p) => p.entity_type === entity_type && p.entity_id === entity_id);

  function go(next: number) {
    setStep(next);
    setFurthest((f) => Math.max(f, next));
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      setSent(await api.assignmentCampaign(request));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const canContinue = step === 0 ? picked.length > 0 : step === 1 ? hasAudience : true;

  /* ------------------------------------------------------------------ */

  const options: Pick[] =
    kind === "formation"
      ? trainings
          .filter((f) => f.title.toLowerCase().includes(find.trim().toLowerCase()))
          .map((f) => ({
            entity_type: "formation" as const,
            entity_id: f.id,
            title: f.title,
            hint: `${f.lesson_count} ${t("wizard.lessons", "lessons")} · ${f.total_xp} XP`,
          }))
      : kind === "pathway"
        ? pathways
            .filter((p) => p.title.toLowerCase().includes(find.trim().toLowerCase()))
            .map((p) => ({
              entity_type: "pathway" as const,
              entity_id: p.id,
              title: p.title,
              hint: `${p.step_count} ${t("wizard.steps", "steps")}`,
            }))
        : courses.map((c) => ({
            entity_type: "course" as const,
            entity_id: c.id,
            title: c.title,
            hint: c.provider || t("wizard.internal", "In-house"),
          }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("wizard.title", "Assign learning")}
      onClick={() => onClose(!!sent)}
    >
      <div
        className="my-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---------------------------------------------------- header -- */}
        <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-3.5">
          <div className="mr-auto">
            <h2 className="text-base font-semibold">📌 {t("wizard.title", "Assign learning")}</h2>
            <p className="text-xs text-text-subtle">
              {t("wizard.lede", "Hand work to people, a team or a whole unit — and tell them.")}
            </p>
          </div>
          <button
            className="btn-icon"
            aria-label={t("common.close")}
            onClick={() => onClose(!!sent)}
          >
            ✕
          </button>
        </header>

        {sent ? (
          <Done result={sent} onClose={() => onClose(true)} t={t} />
        ) : (
          <>
            {/* ------------------------------------------------ steps -- */}
            <ol className="flex flex-wrap gap-1 border-b border-border bg-surface px-5 py-2.5 text-xs">
              {STEPS.map((s, i) => {
                const state = i === step ? "now" : i <= furthest ? "done" : "later";
                return (
                  <li key={s.key}>
                    <button
                      disabled={i > furthest}
                      onClick={() => go(i)}
                      className={[
                        "flex items-center gap-1.5 rounded-full px-3 py-1 transition",
                        state === "now"
                          ? "bg-accent/15 font-medium text-accent"
                          : state === "done"
                            ? "text-text-muted hover:bg-surface-2"
                            : "cursor-not-allowed text-text-subtle/60",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "grid h-4.5 w-4.5 place-items-center rounded-full text-[10px] font-semibold",
                          state === "now"
                            ? "bg-accent text-white"
                            : state === "done"
                              ? "bg-good/20 text-good"
                              : "bg-surface-2 text-text-subtle",
                        ].join(" ")}
                        style={{ height: 18, width: 18 }}
                      >
                        {state === "done" && i !== step ? "✓" : i + 1}
                      </span>
                      {t(s.key, s.fallback)}
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="grid gap-0 md:grid-cols-[1fr_17rem]">
              {/* --------------------------------------------- panel -- */}
              <div className="min-h-[22rem] space-y-4 p-5">
                {step === 0 && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      {(Object.keys(KIND_META) as Kind[]).map((k) => (
                        <button
                          key={k}
                          onClick={() => {
                            setKind(k);
                            setFind("");
                          }}
                          className={[
                            "rounded-full border px-3 py-1 text-sm transition",
                            kind === k
                              ? "border-accent bg-accent/10 text-accent"
                              : "border-border text-text-muted hover:border-accent/50",
                          ].join(" ")}
                        >
                          {KIND_META[k].icon} {t(KIND_META[k].key, KIND_META[k].fallback)}
                        </button>
                      ))}
                      <input
                        className="input ml-auto max-w-[14rem]"
                        placeholder={
                          kind === "course"
                            ? t("wizard.searchCourses", "Search the catalogue (3+ letters)")
                            : t("wizard.filter", "Filter…")
                        }
                        value={find}
                        onChange={(e) => setFind(e.target.value)}
                      />
                    </div>

                    <ul className="max-h-72 divide-y divide-edge overflow-y-auto rounded-xl border border-border">
                      {options.map((item) => {
                        const on = isPicked(item.entity_type as Kind, item.entity_id);
                        return (
                          <li key={`${item.entity_type}-${item.entity_id}`}>
                            <button
                              onClick={() => toggle(item)}
                              className={[
                                "flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition",
                                on ? "bg-accent/[0.07]" : "hover:bg-surface-2",
                              ].join(" ")}
                            >
                              <span
                                className={[
                                  "grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs",
                                  on ? "border-accent bg-accent text-white" : "border-border",
                                ].join(" ")}
                              >
                                {on ? "✓" : ""}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{item.title}</span>
                                <span className="block truncate text-xs text-text-subtle">{item.hint}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                      {options.length === 0 && (
                        <li className="px-3.5 py-8 text-center text-sm text-text-subtle">
                          {kind === "course" && find.trim().length < 3
                            ? t("wizard.typeToSearch", "Type three letters to search 800+ courses.")
                            : t("filter.noMatch")}
                        </li>
                      )}
                    </ul>
                  </>
                )}

                {step === 1 && (
                  <div className="space-y-4">
                    {/* named people */}
                    <section className="space-y-1.5">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                        {t("wizard.namedPeople", "Named people")}
                      </h3>
                      <div className="relative">
                        <input
                          className="input w-full"
                          placeholder={t("assign.findPerson")}
                          value={personFind}
                          onChange={(e) => setPersonFind(e.target.value)}
                        />
                        {personHits.length > 0 && (
                          <ul className="absolute z-10 mt-1 w-full divide-y divide-edge rounded-lg border border-border bg-surface shadow-lg">
                            {personHits.map((p) => (
                              <li key={p.id}>
                                <button
                                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                                  onClick={() => {
                                    setPeople((c) => (c.some((x) => x.id === p.id) ? c : [...c, p]));
                                    setPersonFind("");
                                    setPersonHits([]);
                                  }}
                                >
                                  {p.name || p.handle}
                                  <span className="ml-1.5 text-xs text-text-subtle">{p.bu || p.team}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {people.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {people.map((p) => (
                            <span
                              key={p.id}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs"
                            >
                              {p.name || p.handle}
                              <button
                                className="text-text-subtle hover:text-bad"
                                onClick={() => setPeople((c) => c.filter((x) => x.id !== p.id))}
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </section>

                    <Chips
                      title={t("wizard.teams", "Teams")}
                      empty={t("wizard.noTeams", "No team is visible to you.")}
                      values={teams.map((team) => ({
                        id: String(team.id),
                        label: team.name,
                        hint: `${team.member_count}`,
                      }))}
                      selected={chosenTeams.map(String)}
                      onToggle={(id) =>
                        setChosenTeams((c) =>
                          c.includes(Number(id)) ? c.filter((x) => x !== Number(id)) : [...c, Number(id)],
                        )
                      }
                    />

                    <Chips
                      title={t("wizard.bus", "Business units")}
                      empty=""
                      values={bus.map((b) => ({ id: b, label: b, hint: "" }))}
                      selected={chosenBus}
                      onToggle={(id) =>
                        setChosenBus((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
                      }
                    />

                    <p className="text-xs text-text-subtle">
                      {t(
                        "wizard.audienceHint",
                        "Each line adds people. Somebody named twice is still assigned once.",
                      )}
                    </p>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-5">
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                        {t("wizard.obligation", "Obligation")}
                      </h3>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Choice
                          on={mandatory}
                          onClick={() => setMandatory(true)}
                          icon="📌"
                          title={t("assign.mandatory")}
                          body={t(
                            "wizard.mandatoryBody",
                            "Counted on the compliance board. Overdue work is reported.",
                          )}
                        />
                        <Choice
                          on={!mandatory}
                          onClick={() => setMandatory(false)}
                          icon="💡"
                          title={t("wizard.recommended", "Recommended")}
                          body={t(
                            "wizard.recommendedBody",
                            "Tracked and visible, never reported as a breach.",
                          )}
                        />
                      </div>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                        {t("track.due")}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="date"
                          className="input max-w-[11rem]"
                          value={due}
                          onChange={(e) => setDue(e.target.value)}
                        />
                        {quickDates().map((q) => (
                          <button
                            key={q.value}
                            onClick={() => setDue(q.value)}
                            className={[
                              "rounded-full border px-2.5 py-0.5 text-xs transition",
                              due === q.value
                                ? "border-accent bg-accent/10 text-accent"
                                : "border-border text-text-subtle hover:border-accent/50",
                            ].join(" ")}
                          >
                            {q.label}
                          </button>
                        ))}
                        {due && (
                          <button
                            className="text-xs text-text-subtle hover:text-bad"
                            onClick={() => setDue("")}
                          >
                            ✕ {t("common.reset")}
                          </button>
                        )}
                      </div>
                      {mandatory && !due && (
                        <p className="text-xs text-warn">
                          {t(
                            "wizard.noDueWarning",
                            "Mandatory with no deadline can never be overdue, so nothing will ever chase it.",
                          )}
                        </p>
                      )}
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                        {t("wizard.why", "Why (goes in the email)")}
                      </h3>
                      <textarea
                        className="input h-20 w-full text-sm"
                        placeholder={t(
                          "wizard.notePlaceholder",
                          "e.g. Required before the new quality procedure takes effect in March.",
                        )}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </section>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-4">
                    {!preview && (
                      <p className="text-sm text-text-subtle">{t("common.loading")}</p>
                    )}
                    {preview && (
                      <>
                        <div className="overflow-hidden rounded-xl border border-border">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-surface text-xs uppercase tracking-wide text-text-subtle">
                              <tr>
                                <th className="px-3 py-2 font-medium">{t("track.what")}</th>
                                <th className="px-3 py-2 text-right font-medium">
                                  {t("wizard.willGet", "Will get it")}
                                </th>
                                <th className="px-3 py-2 text-right font-medium">
                                  {t("wizard.alreadyHas", "Already has it")}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {preview.items.map((i) => (
                                <tr key={`${i.entity_type}-${i.entity_id}`} className="border-t border-edge">
                                  <td className="px-3 py-2">{i.title}</td>
                                  <td className="px-3 py-2 text-right tnum font-medium">{i.new}</td>
                                  <td className="px-3 py-2 text-right tnum text-text-subtle">{i.already}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="rounded-xl border border-border p-3">
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-subtle">
                            {t("wizard.whoGets", "Who gets it")} · {preview.totals.people}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {preview.people.slice(0, 14).map((p) => (
                              <span
                                key={p.learner_id}
                                className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs"
                              >
                                {p.name}
                              </span>
                            ))}
                            {preview.people.length > 14 && (
                              <span className="px-1 py-0.5 text-xs text-text-subtle">
                                +{preview.people.length - 14}
                              </span>
                            )}
                          </div>
                        </div>

                        {preview.totals.no_email.length > 0 && (
                          <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
                            {t("wizard.noEmail", "No email address, so no message will reach:")}{" "}
                            {preview.totals.no_email.join(", ")}
                          </p>
                        )}
                        {preview.totals.already > 0 && (
                          <p className="text-xs text-text-subtle">
                            {t(
                              "wizard.alreadyHint",
                              "People who already have an item keep it — their deadline is updated, and they are not emailed again.",
                            )}
                          </p>
                        )}
                      </>
                    )}
                    {error && <p className="text-sm text-bad">{error}</p>}
                  </div>
                )}
              </div>

              {/* ------------------------------------------- summary -- */}
              <aside className="space-y-3 border-t border-border bg-surface p-5 md:border-l md:border-t-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                  {t("wizard.summary", "This campaign")}
                </p>

                <Row label={t("wizard.content", "Content")} value={String(picked.length)} />
                <div className="flex flex-wrap gap-1">
                  {picked.slice(0, 4).map((p) => (
                    <span
                      key={`${p.entity_type}-${p.entity_id}`}
                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-bg px-2 py-0.5 text-[11px]"
                    >
                      <span className="truncate">{p.title}</span>
                      <button className="text-text-subtle hover:text-bad" onClick={() => toggle(p)}>
                        ✕
                      </button>
                    </span>
                  ))}
                  {picked.length > 4 && (
                    <span className="text-[11px] text-text-subtle">+{picked.length - 4}</span>
                  )}
                </div>

                <Row
                  label={t("wizard.audience", "Audience")}
                  value={preview ? String(preview.totals.people) : hasAudience ? "…" : "0"}
                />
                <Row
                  label={t("assign.mandatory")}
                  value={mandatory ? t("common.yes", "Yes") : t("common.no", "No")}
                />
                <Row label={t("track.due")} value={due || "—"} />

                <div className="border-t border-edge pt-3">
                  <p className="text-3xl font-semibold tnum text-accent">
                    {previewing ? "…" : (preview?.totals.assignments ?? 0)}
                  </p>
                  <p className="text-xs text-text-subtle">
                    {t("wizard.willCreate", "assignments will be created")}
                  </p>
                  {preview && preview.totals.emails > 0 && (
                    <p className="mt-1 text-xs text-text-subtle">
                      ✉ {t("wizard.willEmail", { n: preview.totals.emails }, "{n} people will be emailed")}
                    </p>
                  )}
                </div>
              </aside>
            </div>

            {/* ---------------------------------------------- footer -- */}
            <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-5 py-3">
              {step > 0 && (
                <button className="btn-ghost" onClick={() => go(step - 1)}>
                  ← {t("common.back", "Back")}
                </button>
              )}
              <span className="ml-auto" />
              {step < 3 ? (
                <button className="btn" disabled={!canContinue} onClick={() => go(step + 1)}>
                  {t("common.continue", "Continue")} →
                </button>
              ) : (
                <button
                  className="btn"
                  disabled={sending || !preview || preview.totals.assignments === 0}
                  onClick={send}
                >
                  {sending
                    ? t("wizard.sending", "Assigning…")
                    : t("wizard.send", { n: preview?.totals.assignments ?? 0 }, "Assign {n} items & notify")}
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- pieces -- */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-text-subtle">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Choice({
  on,
  onClick,
  icon,
  title,
  body,
}: {
  on: boolean;
  onClick: () => void;
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-xl border p-3 text-left transition",
        on ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/50",
      ].join(" ")}
    >
      <p className="text-sm font-medium">
        {icon} {title}
      </p>
      <p className="mt-0.5 text-xs text-text-subtle">{body}</p>
    </button>
  );
}

function Chips({
  title,
  empty,
  values,
  selected,
  onToggle,
}: {
  title: string;
  empty: string;
  values: { id: string; label: string; hint: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (values.length === 0 && !empty) return null;
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">{title}</h3>
      {values.length === 0 ? (
        <p className="text-xs text-text-subtle">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <button
              key={v.id}
              onClick={() => onToggle(v.id)}
              className={[
                "rounded-full border px-2.5 py-0.5 text-xs transition",
                selected.includes(v.id)
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-text-muted hover:border-accent/50",
              ].join(" ")}
            >
              {v.label}
              {v.hint && <span className="ml-1 text-text-subtle">· {v.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Done({
  result,
  onClose,
  t,
}: {
  result: CampaignResult;
  onClose: () => void;
  t: (key: string, varsOrFallback?: Record<string, string | number> | string, fallback?: string) => string;
}) {
  return (
    <div className="space-y-4 p-8 text-center">
      <p className="text-4xl" aria-hidden>
        ✅
      </p>
      <h3 className="text-lg font-semibold">
        {t("wizard.doneTitle", { n: result.assignments }, "{n} assignments created")}
      </h3>
      <p className="text-sm text-text-muted">
        {t(
          "wizard.doneBody",
          { people: result.people, emails: result.emails },
          "{people} people notified in the app, {emails} by email.",
        )}
        {result.updated > 0 &&
          " " + t(
            "wizard.doneUpdated",
            { n: result.updated },
            "{n} existing assignments had their deadline updated.",
          )}
      </p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {result.items.map((title) => (
          <span key={title} className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs">
            {title}
          </span>
        ))}
      </div>
      <button className="btn" onClick={onClose}>
        {t("wizard.doneClose", "Back to tracking")}
      </button>
    </div>
  );
}
