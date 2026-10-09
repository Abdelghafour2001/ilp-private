"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type AdminLearnerRow, type LearnerOrgFields, type LearnerRole } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";

const ROLES: { value: LearnerRole; label: string }[] = [
  { value: "user", label: "Learner" },
  { value: "trainer", label: "Trainer" },
  { value: "skill_lead", label: "Skill Lead" },
  { value: "manager", label: "Manager" },
  { value: "hr", label: "HR" },
  { value: "admin", label: "Admin" },
];

const ORG_KEYS: (keyof LearnerOrgFields)[] = ["bu", "practice", "location", "matricule"];

const ORG_LABELS: Record<keyof LearnerOrgFields, string> = {
  bu: "BU",
  practice: "Practice",
  location: "Location",
  matricule: "Employee no.",
  job_level: "Job level",
};

export default function AdminLearners() {
  const [learners, setLearners] = useState<AdminLearnerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const me = getStoredLearner();

  const load = () =>
    api
      .adminListLearners(me?.id)
      .then(setLearners)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    load();
  }, []);

  async function remove(id: number, handle: string) {
    if (!confirm(`Delete learner "${handle}" and all their progress?`)) return;
    await api.adminDeleteLearner(id);
    load();
  }

  async function setRole(id: number, role: LearnerRole) {
    try {
      await api.adminSetRole(id, role);
      load();
    } catch (e) {
      setError(String(e));
    }
  }

  function patchOrg(id: number, key: keyof LearnerOrgFields, value: string) {
    setLearners((cur) => cur.map((l) => (l.id === id ? { ...l, [key]: value } : l)));
  }

  async function saveOrg(l: AdminLearnerRow) {
    setSavingId(l.id);
    setError(null);
    try {
      await api.adminSetProfile(
        l.id,
        {
          bu: l.bu,
          practice: l.practice,
          location: l.location,
          matricule: l.matricule,
          job_level: l.job_level,
        },
        me?.id,
      );
    } catch (e) {
      setError(String(e));
      load();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-text-subtle hover:text-text-muted">
          ← Admin
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Manage learners</h1>
        <p className="mt-1 text-sm text-text-subtle">
          Trainers can run formations; Skill Leads track a team from the{" "}
          <Link href="/team" className="underline">team dashboard</Link>.
          HR org fields (BU, practice, location, matricule, job level) are editable here.
        </p>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-edge text-xs uppercase tracking-wide text-text-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">Handle</th>
                <th className="px-4 py-3 font-medium">Role</th>
                {ORG_KEYS.map((k) => (
                  <th key={k} className="px-4 py-3 font-medium">
                    {ORG_LABELS[k]}
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-medium">XP</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {learners.map((l) => (
                <tr key={l.id} className="border-t border-edge">
                  <td className="px-4 py-2.5 font-medium">{l.handle}</td>
                  <td className="px-4 py-2.5">
                    <select
                      className="input max-w-[120px] py-1 text-xs"
                      value={l.role}
                      onChange={(e) => setRole(l.id, e.target.value as LearnerRole)}
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  {ORG_KEYS.map((k) => (
                    <td key={k} className="px-4 py-2.5">
                      <input
                        className="input min-w-[100px] py-1 text-xs"
                        value={l[k]}
                        placeholder="—"
                        onChange={(e) => patchOrg(l.id, k, e.target.value)}
                        onBlur={() => saveOrg(l)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      />
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right font-mono text-accent">{l.xp}</td>
                  <td className="px-4 py-2.5 text-right">
                    {savingId === l.id && (
                      <span className="mr-2 text-xs text-text-subtle">Saving…</span>
                    )}
                    <button className="text-xs text-bad hover:underline" onClick={() => remove(l.id, l.handle)}>
                      delete
                    </button>
                  </td>
                </tr>
              ))}
              {learners.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-sm text-text-subtle">
                    No learners yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
