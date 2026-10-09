"use client";

/**
 * Hand a course, training or pathway to people — the same panel wherever the
 * thing being assigned lives.
 *
 * Assigning used to be three different screens: a textarea of handles on a
 * course, a team button on a pathway, a dropdown on a team page. Three places
 * meant three answers to "is this mandatory" and only one of them could set a
 * deadline, so the compliance view could not be trusted. This is one form:
 * who, whether it is compulsory, by when, and why.
 *
 * Who is either named people or a whole team. A team fans out to one row per
 * member server-side, so somebody moving team later keeps the obligation they
 * were given.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type AssignmentRoster, type GovDirectoryPerson, type Team } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useI18n } from "@/lib/i18n";

type Kind = "course" | "formation" | "pathway";

export default function AssignPanel({
  entityType,
  entityId,
  onAssigned,
}: {
  entityType: Kind;
  entityId: number;
  /** Let the host refresh whatever roster it shows beside this panel. */
  onAssigned: () => void;
}) {
  const { t } = useI18n();
  const me = getStoredLearner();
  const [find, setFind] = useState("");
  const [hits, setHits] = useState<GovDirectoryPerson[]>([]);
  const [chosen, setChosen] = useState<GovDirectoryPerson[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [mandatory, setMandatory] = useState(true);
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roster, setRoster] = useState<AssignmentRoster | null>(null);

  const loadRoster = useCallback(() => {
    api
      .assignmentRoster(entityType, entityId, me?.id)
      // Somebody who cannot assign cannot see who has it either; the list
      // simply does not render for them.
      .then(setRoster)
      .catch(() => setRoster(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  useEffect(loadRoster, [loadRoster]);

  useEffect(() => {
    api.listTeams(me?.id).then(setTeams).catch(() => setTeams([]));
    // Only the assigner's id matters here; it does not change while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const term = find.trim();
    if (term.length < 2) return setHits([]);
    const timer = setTimeout(() => {
      api
        .govPeople(me?.id, { q: term })
        .then((r) => setHits(r.people.slice(0, 8)))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [find, me?.id]);

  function add(person: GovDirectoryPerson) {
    setChosen((current) =>
      current.some((p) => p.id === person.id) ? current : [...current, person],
    );
    setFind("");
    setHits([]);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.assign({
        entity_type: entityType,
        entity_id: entityId,
        learner_ids: chosen.map((p) => p.id),
        team_id: teamId ? Number(teamId) : null,
        mandatory,
        due_date: due || null,
        note,
        learner_id: me?.id,
      });
      setMessage(
        t("assign.done", { n: result.assigned.length, updated: result.updated.length }),
      );
      setChosen([]);
      setTeamId("");
      setNote("");
      loadRoster();
      onAssigned();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const nobody = chosen.length === 0 && !teamId;

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold">{t(`assign.title.${entityType}`)}</h2>
        <p className="text-sm text-text-muted">{t("assign.lede")}</p>
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs"
            >
              {p.name || p.handle}
              <button
                className="text-text-subtle hover:text-bad"
                onClick={() => setChosen((c) => c.filter((x) => x.id !== p.id))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <input
            className="input max-w-xs"
            placeholder={t("assign.findPerson")}
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
          {hits.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full divide-y divide-edge rounded-lg border border-border bg-surface shadow-lg">
              {hits.map((p) => (
                <li key={p.id}>
                  <button
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                    onClick={() => add(p)}
                  >
                    {p.name || p.handle}
                    <span className="ml-1.5 text-xs text-text-subtle">{p.bu || p.team}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="text-xs text-text-subtle">{t("assign.or")}</span>
        <select
          className="input max-w-[14rem]"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
        >
          <option value="">{t("assign.wholeTeam")}</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={mandatory}
            onChange={(e) => setMandatory(e.target.checked)}
          />
          {t("assign.mandatory")}
        </label>
        <label className="flex items-center gap-1.5 text-sm text-text-subtle">
          {t("track.due")}
          <input
            type="date"
            className="input max-w-[10rem]"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        <input
          className="input max-w-xs flex-1"
          placeholder={t("assign.notePlaceholder")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="btn" disabled={busy || nobody} onClick={submit}>
          {busy ? t("assign.sending") : t("assign.send")}
        </button>
      </div>

      <p className="text-xs text-text-subtle">{t("assign.notice")}</p>
      {message && <p className="text-sm text-good">{message}</p>}
      {error && <p className="text-sm text-bad">{error}</p>}

      {/* Who has it already — so nobody is handed the same thing twice, and so
          the deadline being moved is a decision taken with the roster in view
          rather than from memory. */}
      {roster && (
        <div className="space-y-2 border-t border-edge pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">
              {t("assign.alreadyHave", { n: roster.summary.assigned })}
            </h3>
            {roster.summary.assigned > 0 && (
              <>
                <span className="badge bg-good/15 text-good">
                  {t("track.completed", { n: roster.summary.completed })}
                </span>
                <span className="badge bg-warn/15 text-warn">
                  {t("track.inProgress", { n: roster.summary.in_progress })}
                </span>
                <span className="badge bg-edge text-text-subtle">
                  {t("track.notStarted", { n: roster.summary.not_started })}
                </span>
                {roster.summary.overdue > 0 && (
                  <span className="badge bg-bad/15 text-bad">
                    {t("track.overdue", { n: roster.summary.overdue })}
                  </span>
                )}
              </>
            )}
          </div>

          {roster.summary.assigned === 0 ? (
            <p className="text-sm text-text-subtle">{t("track.nobodyYet")}</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-text-subtle">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">{t("track.person")}</th>
                    <th className="py-1.5 pr-3 font-medium">{t("track.progress")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{t("track.due")}</th>
                    <th className="py-1.5 text-right font-medium">{t("track.assignedBy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.people.map((p) => (
                    <tr key={p.learner_id} className="border-t border-edge">
                      <td className="py-1.5 pr-3">
                        <span className="font-medium">{p.name}</span>
                        {p.mandatory && (
                          <span className="badge ml-1.5 bg-warn/15 text-warn">
                            {t("assign.mandatory")}
                          </span>
                        )}
                        {p.bu && <span className="block text-[11px] text-text-subtle">{p.bu}</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                            <div
                              className={`h-full rounded-full ${p.status === "completed" ? "bg-good" : "bg-accent"}`}
                              style={{ width: `${Math.max(2, p.percent)}%` }}
                            />
                          </div>
                          <span className="tnum text-xs text-text-subtle">{p.percent}%</span>
                        </div>
                      </td>
                      <td
                        className={`py-1.5 pr-3 text-right tnum text-xs ${p.overdue ? "text-bad" : "text-text-subtle"}`}
                      >
                        {p.due_date ?? "—"}
                      </td>
                      <td className="py-1.5 text-right text-xs text-text-subtle">
                        {p.assigned_by || "—"}
                        {p.via_team && <span className="block">👥 {p.via_team}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
