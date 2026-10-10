"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type FormationCard, type Learner, type Team, type TeamDashboard } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";
import Modal from "@/components/Modal";
import Icon from "@/components/Icon";
import TeamDeclaredLearning from "@/components/TeamDeclaredLearning";
import { useFormat } from "@/lib/i18n";

/** Days since a date, or null when there is none. */
function daysSince(d: string | null) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
}

function initials(s: string) {
  const parts = s.split(/[\s.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function TeamPage() {
  const t = useT();
  const fmt = useFormat();
  const [me, setMe] = useState<Learner | null>(null);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [dash, setDash] = useState<TeamDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [addingMembers, setAddingMembers] = useState(false);

  // forms
  const [newName, setNewName] = useState("");
  const [newLead, setNewLead] = useState("");
  const [newManager, setNewManager] = useState("");
  const [addHandles, setAddHandles] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [formations, setFormations] = useState<FormationCard[]>([]);
  const [assignId, setAssignId] = useState<string>("");
  // Who the assign dialog is for: the whole team, or one member.
  const [assigning, setAssigning] = useState<{ ids: number[]; label: string } | null>(null);

  const isAdmin = me?.role === "admin" || me?.role === "hr";
  const canManage = dash?.can_manage ?? false;

  const loadTeams = useCallback(() => {
    const learner = getStoredLearner();
    setMe(learner);
    // /team?team=<id> deep-links a specific team (used by the HR org view)
    const wanted = Number(new URLSearchParams(window.location.search).get("team")) || null;
    api
      .listTeams(learner?.id)
      .then((ts) => {
        setTeams(ts);
        setTeamId((cur) =>
          wanted && ts.some((t) => t.id === wanted) ? wanted : cur ?? ts[0]?.id ?? null,
        );
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    loadTeams();
    api
      .listFormations(getStoredLearner()?.id)
      .then((fs) => setFormations(fs.filter((f) => f.status === "published")))
      .catch(() => {});
  }, [loadTeams]);

  const loadDash = useCallback(() => {
    if (!teamId) {
      setDash(null);
      return;
    }
    api
      .teamDashboard(teamId, getStoredLearner()?.id)
      .then(setDash)
      .catch((e) => setError(String(e)));
  }, [teamId]);

  useEffect(() => {
    setError(null);
    loadDash();
  }, [loadDash]);

  async function createTeam() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const t = await api.createTeam({
        name: newName.trim(),
        lead_handle: newLead.trim() || null,
        manager_handle: newManager.trim() || null,
        learner_id: me?.id,
      });
      setNewName("");
      setNewLead("");
      setNewManager("");
      loadTeams();
      setTeamId(t.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addMembers() {
    if (!teamId || !addHandles.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const handles = addHandles.split(/[,\s]+/).filter(Boolean);
      const res = await api.addTeamMembers(teamId, handles, me?.id);
      if (res.skipped.length > 0) {
        setNotice(res.skipped.map((s) => `${s.handle}: ${s.reason}`).join(" · "));
      }
      setAddHandles("");
      loadDash();
      loadTeams();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function assignTo(memberIds: number[], label: string) {
    if (!teamId || !assignId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.assignFormation(teamId, Number(assignId), memberIds, me?.id);
      const parts = [];
      if (res.assigned.length) parts.push(t("team.assignedTo", { who: res.assigned.join(", ") }));
      if (res.skipped.length) parts.push(res.skipped.map((s) => `${s.handle}: ${s.reason}`).join(" · "));
      setNotice(parts.join(" — ") || t("team.nothingToDo", { who: label }));
      loadDash();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(memberId: number, handle: string) {
    if (!teamId || !confirm(t("team.confirmRemove", { who: handle }))) return;
    await api.removeTeamMember(teamId, memberId, me?.id ?? undefined).catch((e) => setError(String(e)));
    loadDash();
    loadTeams();
  }

  if (teams === null && !error)
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="h-9 w-64 skeleton" />
        <div className="h-24 skeleton rounded-2xl" />
        <div className="h-72 skeleton rounded-2xl" />
      </div>
    );

  const canSee =
    isAdmin || me?.role === "skill_lead" || me?.role === "manager" || (teams?.length ?? 0) > 0;

  const members = dash?.members ?? [];
  const activePct = dash && dash.totals.members ? Math.round((100 * dash.totals.active_this_week) / dash.totals.members) : 0;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow mb-2">{t("team.title")}</p>
          {dash ? (
            <>
              <h1 className="text-3xl font-semibold tracking-[-0.03em]">{dash.team.name}</h1>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
                {dash.team.lead_handle && (
                  <span>
                    {t("team.skillLead")} <span className="font-medium text-text">{dash.team.lead_handle}</span>
                  </span>
                )}
                {dash.team.manager_handle && (
                  <span>
                    {t("team.manager")} <span className="font-medium text-text">{dash.team.manager_handle}</span>
                  </span>
                )}
                {!canManage && <span className="text-text-subtle">{t("team.readOnly")}</span>}
              </p>
            </>
          ) : (
            <h1 className="text-3xl font-semibold tracking-[-0.03em]">{t("team.title")}</h1>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {teams && teams.length > 1 && (
            <select
              className="input w-auto max-w-[240px]"
              aria-label={t("team.switch")}
              value={teamId ?? ""}
              onChange={(e) => setTeamId(Number(e.target.value))}
            >
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name} ({tm.member_count})
                </option>
              ))}
            </select>
          )}
          {isAdmin && (
            <button className="btn-ghost" onClick={() => setCreatingTeam(true)}>
              <Icon name="plus" size={15} /> {t("team.create")}
            </button>
          )}
          {dash && canManage && (
            <>
              <button className="btn-ghost" onClick={() => setAddingMembers(true)}>
                <Icon name="team" size={15} /> {t("team.addMembers")}
              </button>
              <button className="btn" onClick={() => setAssigning({ ids: [], label: dash.team.name })}>
                <Icon name="formations" size={15} /> {t("team.assignTraining")}
              </button>
            </>
          )}
        </div>
      </header>

      <div aria-live="polite" className="space-y-3 empty:hidden">
        {error && (
          <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
            {error}
          </p>
        )}
        {notice && (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-muted">
            <Icon name="check" size={16} className="mt-0.5 shrink-0 text-good" />
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice(null)} aria-label={t("common.close")} className="shrink-0 text-text-subtle hover:text-text">
              <Icon name="x" size={15} />
            </button>
          </div>
        )}
      </div>

      {!canSee && (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-text-muted">
          {t("team.notForYou")}
        </div>
      )}

      {/* Creating a team is rare; this form used to sit open above the
          dashboard on every visit, for everyone who could see it. */}
      {creatingTeam && (
        <Modal
          title={t("team.createHr")}
          lede={t("team.createLede", "A name is enough; the lead and the manager can be set later.")}
          size="sm"
          onClose={() => setCreatingTeam(false)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setCreatingTeam(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn"
                disabled={busy || !newName.trim()}
                onClick={async () => {
                  await createTeam();
                  setCreatingTeam(false);
                }}
              >
                {busy ? t("common.saving", "Saving…") : t("team.create")}
              </button>
            </>
          }
        >
          <label className="block">
            <span className="label">{t("team.name")}</span>
            <input className="input" name="team-name" autoComplete="off" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </label>
          <label className="block">
            <span className="label">{t("team.leadHandle")}</span>
            <input className="input" name="lead" autoComplete="off" spellCheck={false} value={newLead} onChange={(e) => setNewLead(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">{t("team.managerHandle")}</span>
            <input className="input" name="manager" autoComplete="off" spellCheck={false} value={newManager} onChange={(e) => setNewManager(e.target.value)} />
          </label>
        </Modal>
      )}

      {addingMembers && (
        <Modal
          title={t("team.addMembers")}
          lede={t("team.addByHandle")}
          size="sm"
          onClose={() => setAddingMembers(false)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setAddingMembers(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn"
                disabled={busy || !addHandles.trim()}
                onClick={async () => {
                  await addMembers();
                  setAddingMembers(false);
                }}
              >
                {t("team.addMembers")}
              </button>
            </>
          }
        >
          <label className="block">
            <span className="sr-only">{t("team.addByHandle")}</span>
            <input
              className="input"
              name="handles"
              autoComplete="off"
              spellCheck={false}
              placeholder="prenom.nom, autre.personne…"
              value={addHandles}
              onChange={(e) => setAddHandles(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMembers().then(() => setAddingMembers(false))}
              autoFocus
            />
          </label>
        </Modal>
      )}

      {/* One dialog for both: the whole team from the header, one person
          from their row. It used to be a dropdown above the table that a
          row's "assign" link silently depended on. */}
      {assigning && (
        <Modal
          title={t("team.assignTraining")}
          lede={
            assigning.ids.length
              ? t("team.assignToOne", { who: assigning.label })
              : t("team.assignToTeam", { n: dash?.totals.members ?? 0 })
          }
          size="sm"
          onClose={() => setAssigning(null)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setAssigning(null)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn"
                disabled={busy || !assignId}
                onClick={async () => {
                  await assignTo(assigning.ids, assigning.label);
                  setAssigning(null);
                }}
              >
                {busy ? t("common.saving", "Saving…") : t("team.assignNotify")}
              </button>
            </>
          }
        >
          <fieldset>
            <legend className="label">{t("team.pickTraining")}</legend>
            <div className="max-h-80 space-y-1 overflow-y-auto overscroll-contain">
              {formations.map((f) => (
                <label
                  key={f.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    assignId === String(f.id) ? "border-accent bg-accent/5" : "border-border hover:bg-surface-2"
                  }`}
                >
                  <input
                    type="radio"
                    name="training"
                    value={f.id}
                    checked={assignId === String(f.id)}
                    onChange={() => setAssignId(String(f.id))}
                    className="accent-[rgb(var(--accent))]"
                  />
                  <span aria-hidden="true">{f.emoji}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{f.title}</span>
                  <span className="shrink-0 text-xs text-text-subtle tnum">{t("form.hub.lessons", { n: f.lesson_count })}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Modal>
      )}

      {canSee && teams && teams.length === 0 && !isAdmin && (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-text-muted">
          {t("team.noTeam")}
        </div>
      )}

      {dash && (
        <>
          {/* Totals: one strip, four facts about the same group of people. */}
          <dl className="panel grid grid-cols-2 divide-border overflow-hidden lg:grid-cols-4 lg:divide-x [&>div:nth-child(n+3)]:border-t lg:[&>div:nth-child(n+3)]:border-t-0 [&>div:nth-child(even)]:border-l lg:[&>div:nth-child(even)]:border-l-0">
            <div className="p-5">
              <dt className="text-xs text-text-subtle">{t("team.stat.members")}</dt>
              <dd className="mt-1 text-2xl font-semibold tracking-tight tnum">{dash.totals.members}</dd>
            </div>
            <div className="p-5">
              <dt className="text-xs text-text-subtle">{t("team.stat.xp")}</dt>
              <dd className="mt-1 text-2xl font-semibold tracking-tight tnum">{fmt.number(dash.totals.total_xp)}</dd>
            </div>
            <div className="p-5">
              <dt className="text-xs text-text-subtle">{t("team.stat.active")}</dt>
              <dd className="mt-1 flex items-baseline gap-1 text-2xl font-semibold tracking-tight tnum">
                {dash.totals.active_this_week}
                <span className="text-sm font-normal text-text-subtle">/ {dash.totals.members}</span>
              </dd>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                <div className="h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${activePct / 100})` }} />
              </div>
            </div>
            <div className="p-5">
              <dt className="text-xs text-text-subtle">{t("team.stat.progress")}</dt>
              <dd className="mt-1 text-2xl font-semibold tracking-tight tnum">{dash.totals.avg_formation_pct}%</dd>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                <div className="h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${dash.totals.avg_formation_pct / 100})` }} />
              </div>
            </div>
          </dl>

          {/* Members */}
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-base font-semibold">{t("team.membersTitle")}</h2>
              <span className="text-xs text-text-subtle">{t("team.inactiveHint")}</span>
            </div>
            <div className="panel relative overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-border bg-surface-2/60 text-xs text-text-subtle">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">{t("team.col.member")}</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">{t("team.col.level")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">XP</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">{t("team.col.streak")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">{t("team.col.badges")}</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">{t("team.col.formations")}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">{t("team.col.lastActive")}</th>
                    {canManage && (
                      <th scope="col" className="px-4 py-2.5">
                        <span className="sr-only">{t("team.col.actions")}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.map((m) => {
                    const days = daysSince(m.last_active_on);
                    const quiet = days === null || days > 7;
                    const who = (
                      <span className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-3 text-[11px] font-semibold text-text-muted"
                        >
                          {initials(m.name || m.handle)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-text">{m.name || m.handle}</span>
                          {m.name && <span className="block truncate text-xs text-text-subtle">{m.handle}</span>}
                        </span>
                      </span>
                    );
                    return (
                      <tr key={m.learner_id} className="group align-middle transition-colors hover:bg-surface-2/50">
                        <td className="px-5 py-3">
                          {/* The name opens that person's learning record — the
                              manager's next question after reading this row. */}
                          {m.email ? (
                            <Link href={`/people/${encodeURIComponent(m.email)}`} className="block rounded-lg hover:text-accent-text">
                              {who}
                            </Link>
                          ) : (
                            who
                          )}
                        </td>
                        <td className="px-4 py-3 text-text-muted">
                          <span className="font-medium text-text tnum">{m.level}</span>
                          <span className="text-text-subtle"> · {m.level_title}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium tnum">{fmt.number(m.xp)}</td>
                        <td className="px-4 py-3 text-right tnum">
                          {m.current_streak > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <Icon name="flame" size={13} className="text-warn" />
                              {m.current_streak}
                            </span>
                          ) : (
                            <span className="text-text-subtle">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-text-muted tnum">{m.badges}</td>
                        <td className="px-4 py-3">
                          {m.formations.length === 0 ? (
                            <span className="text-xs text-text-subtle">{t("team.notEnrolled")}</span>
                          ) : (
                            <ul className="space-y-1.5">
                              {m.formations.map((f) => (
                                <li key={f.id}>
                                  <Link href={`/formations/${f.id}`} className="flex items-center gap-2 text-xs hover:text-accent-text">
                                    <span className="w-40 truncate">{f.title}</span>
                                    <span
                                      className="h-1 w-16 overflow-hidden rounded-full bg-surface-3"
                                      role="progressbar"
                                      aria-valuenow={f.percent}
                                      aria-valuemin={0}
                                      aria-valuemax={100}
                                      aria-label={f.title}
                                    >
                                      <span
                                        className={`block h-full origin-left rounded-full ${f.percent === 100 ? "bg-good" : "bg-accent"}`}
                                        style={{ transform: `scaleX(${Math.max(0.03, f.percent / 100)})` }}
                                      />
                                    </span>
                                    <span className="w-8 text-right text-text-subtle tnum">{f.percent}%</span>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right text-xs tnum ${quiet ? "text-warn" : "text-text-subtle"}`}>
                          {m.last_active_on ? fmt.date(m.last_active_on, { day: "numeric", month: "short" }) : t("team.never")}
                        </td>
                        {canManage && (
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                className="btn-ghost btn-sm"
                                onClick={() => setAssigning({ ids: [m.learner_id], label: m.name || m.handle })}
                              >
                                {t("assign.short")}
                              </button>
                              <button
                                className="btn-icon h-8 w-8 hover:border-bad/40 hover:text-bad"
                                aria-label={t("team.removeWho", { who: m.handle })}
                                title={t("team.removeWho", { who: m.handle })}
                                onClick={() => removeMember(m.learner_id, m.handle)}
                              >
                                <Icon name="trash" size={14} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {members.length === 0 && (
                    <tr>
                      <td colSpan={canManage ? 8 : 7} className="px-5 py-10 text-center text-sm text-text-subtle">
                        {t("team.noMembers")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {teamId && me && <TeamDeclaredLearning teamId={teamId} viewerId={me.id} />}
        </>
      )}
    </div>
  );
}
