"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type FormationCard, type Learner, type Team, type TeamDashboard } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";
import Modal from "@/components/Modal";

function fmtDate(d: string | null) {
  if (!d) return "never";
  return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function TeamPage() {
  const t = useT();
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
      if (res.assigned.length) parts.push(`Assigned to ${res.assigned.join(", ")} ✓`);
      if (res.skipped.length) parts.push(res.skipped.map((s) => `${s.handle}: ${s.reason}`).join(" · "));
      setNotice(parts.join(" — ") || `Nothing to do for ${label}.`);
      loadDash();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(memberId: number, handle: string) {
    if (!teamId || !confirm(`Remove ${handle} from the team?`)) return;
    await api.removeTeamMember(teamId, memberId, me?.id ?? undefined).catch((e) => setError(String(e)));
    loadDash();
    loadTeams();
  }

  if (teams === null && !error) return <p className="text-sm text-text-subtle">Loading…</p>;

  const canSee =
    isAdmin || me?.role === "skill_lead" || me?.role === "manager" || (teams?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("team.title")}</h1>
          <p className="mt-1 text-sm text-text-muted">
            Skill Leads and managers track their team&apos;s XP, streaks and formation progress here.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {isAdmin && (
          <button className="btn-soft" onClick={() => setCreatingTeam(true)}>
            + {t("team.create")}
          </button>
        )}
        {teams && teams.length > 1 && (
          <select
            className="input max-w-[220px]"
            value={teamId ?? ""}
            onChange={(e) => setTeamId(Number(e.target.value))}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.member_count})
              </option>
            ))}
          </select>
        )}
        </div>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}
      {notice && <div className="card border-warn/40 text-sm text-warn">{notice}</div>}

      {!canSee && (
        <div className="card text-center text-sm text-text-subtle">
          {t("team.spaceFor")} <strong className="text-text">{t("team.skillLeads")}</strong> and{" "}
          <strong className="text-text">managers</strong> — the people responsible for their
          team&apos;s skills development. Ask an admin to appoint you on a team.
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
          <input className="input w-full" placeholder={t("team.name")} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          <input className="input w-full" placeholder={t("team.leadHandle")} value={newLead} onChange={(e) => setNewLead(e.target.value)} />
          <input className="input w-full" placeholder={t("team.managerHandle")} value={newManager} onChange={(e) => setNewManager(e.target.value)} />
        </Modal>
      )}

      {canSee && teams && teams.length === 0 && !isAdmin && (
        <div className="card text-center text-sm text-text-subtle">
          You don&apos;t lead any team yet — ask an admin to create one and appoint you.
        </div>
      )}

      {dash && (
        <>
          {/* Totals */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Members", value: dash.totals.members },
              { label: "Team XP", value: dash.totals.total_xp.toLocaleString() },
              { label: "Active this week", value: `${dash.totals.active_this_week}/${dash.totals.members}` },
              { label: "Avg training progress", value: `${dash.totals.avg_formation_pct}%` },
            ].map((s) => (
              <div key={s.label} className="card">
                <p className="text-xs uppercase tracking-wide text-text-subtle">{s.label}</p>
                <p className="mt-1 text-2xl font-semibold text-accent">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Team header + member management (leads/admins only) */}
          <div className="card space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
              {dash.team.name}
              {dash.team.lead_handle && (
                <span className="ml-2 font-normal normal-case">
                  · Skill Lead: <strong className="text-text">{dash.team.lead_handle}</strong>
                </span>
              )}
              {dash.team.manager_handle && (
                <span className="ml-2 font-normal normal-case">
                  · Manager: <strong className="text-text">{dash.team.manager_handle}</strong>
                </span>
              )}
            </p>
            {canManage ? (
              <>
                <button className="btn-soft btn-sm w-fit" onClick={() => setAddingMembers(true)}>
                  + {t("team.addMembers")}
                </button>
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
                    <input
                      className="input w-full"
                      placeholder={t("team.addByHandle")}
                      value={addHandles}
                      onChange={(e) => setAddHandles(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addMembers()}
                      autoFocus
                    />
                  </Modal>
                )}
                <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-2">
                  <span className="text-xs text-text-subtle">📚 Assign a training:</span>
                  <select
                    className="input max-w-[280px] py-1.5 text-sm"
                    value={assignId}
                    onChange={(e) => setAssignId(e.target.value)}
                  >
                    <option value="">{t("team.pickTraining")}</option>
                    {formations.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.emoji} {f.title}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-soft btn-sm"
                    disabled={busy || !assignId}
                    onClick={() => assignTo([], "the team")}
                  >
                    {t("team.assignAll")}
                  </button>
                  <span className="text-xs text-text-subtle">
                    or use “assign” on a member&apos;s row
                  </span>
                </div>
              </>
            ) : (
              <p className="text-xs text-text-subtle">
                Read-only view — ask the team&apos;s Skill Lead or manager for changes.
              </p>
            )}
          </div>

          {/* Members */}
          <div className="card p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-edge text-xs uppercase tracking-wide text-text-subtle">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("team.col.member")}</th>
                  <th className="px-4 py-3 font-medium">Level</th>
                  <th className="px-4 py-3 text-right font-medium">XP</th>
                  <th className="px-4 py-3 text-right font-medium">{t("team.col.streak")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("team.col.badges")}</th>
                  <th className="px-4 py-3 font-medium">{t("team.col.formations")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("team.col.lastActive")}</th>
                  {canManage && <th className="px-4 py-3 text-right font-medium" />}
                </tr>
              </thead>
              <tbody>
                {dash.members.map((m) => (
                  <tr key={m.learner_id} className="border-t border-edge align-top">
                    <td className="px-4 py-2.5">
                      {/* The name opens that person's learning record — the
                          manager's next question after reading this row. */}
                      {m.email ? (
                        <Link
                          href={`/people/${encodeURIComponent(m.email)}`}
                          className="block hover:text-accent"
                        >
                          <p className="font-medium">{m.handle}</p>
                          {m.name && <p className="text-xs text-text-subtle">{m.name}</p>}
                        </Link>
                      ) : (
                        <>
                          <p className="font-medium">{m.handle}</p>
                          {m.name && <p className="text-xs text-text-subtle">{m.name}</p>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="badge bg-edge text-text-subtle">
                        Lv {m.level} · {m.level_title}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-accent">{m.xp}</td>
                    <td className="px-4 py-2.5 text-right">
                      {m.current_streak > 0 ? `🔥 ${m.current_streak}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-text-muted">{m.badges}</td>
                    <td className="px-4 py-2.5">
                      {m.formations.length === 0 && (
                        <span className="text-xs text-text-subtle">{t("team.notEnrolled")}</span>
                      )}
                      <div className="space-y-1">
                        {m.formations.map((f) => (
                          <Link
                            key={f.id}
                            href={`/formations/${f.id}`}
                            className="flex items-center gap-2 text-xs hover:underline"
                          >
                            <span>{f.emoji}</span>
                            <span className="max-w-[160px] truncate">{f.title}</span>
                            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                              <span
                                className={`block h-full rounded-full ${f.percent === 100 ? "bg-good" : "bg-accent"}`}
                                style={{ width: `${Math.max(2, f.percent)}%` }}
                              />
                            </span>
                            <span className="text-text-subtle">{f.percent}%</span>
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-text-subtle">
                      {fmtDate(m.last_active_on)}
                    </td>
                    {canManage && (
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <button
                            className="text-xs text-accent hover:underline disabled:opacity-40 disabled:no-underline"
                            disabled={busy || !assignId}
                            title={assignId ? "Assign the selected training to this member" : "Pick a training above first"}
                            onClick={() => assignTo([m.learner_id], m.handle)}
                          >
                            assign
                          </button>
                          <button
                            className="text-xs text-bad hover:underline"
                            onClick={() => removeMember(m.learner_id, m.handle)}
                          >
                            remove
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {dash.members.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 8 : 7} className="px-4 py-6 text-center text-sm text-text-subtle">
                      {t("team.noMembers")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
