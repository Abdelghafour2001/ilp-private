"use client";

/**
 * The switchboard — which modules this deployment runs, and for whom.
 *
 * The platform ships more than any one client bought. Rather than a branch per
 * client, each optional module is a switch, and a switch can be narrowed to
 * certain roles or certain business units.
 *
 * Both narrowings restrict and neither grants, including for the admin setting
 * them: an administrator who still saw a module they had switched off would
 * have no way to check what their users actually see.
 *
 * The API behind this is admin-only and kept out of the published API docs. It
 * answers 404 — not 403 — to anybody else, because "forbidden" confirms the
 * thing exists.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type Switchboard as Board } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";

export default function Switchboard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .switchboard(getStoredLearner()?.id)
      .then(setBoard)
      // Not an admin: the panel simply is not there, the same way the API is
      // not there for them.
      .catch(() => setBoard(null));
  }, []);

  useEffect(load, [load]);

  async function save(key: string, patch: Partial<Board["features"][number]>) {
    const row = board?.features.find((f) => f.key === key);
    if (!row) return;
    setBusy(key);
    setError(null);
    try {
      await api.setSwitch({
        key,
        enabled: patch.enabled ?? row.enabled,
        roles: patch.roles ?? row.roles,
        bus: patch.bus ?? row.bus,
        note: patch.note ?? row.note,
        learner_id: getStoredLearner()?.id,
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function reset(key: string) {
    setBusy(key);
    try {
      await api.clearSwitch(key, getStoredLearner()?.id);
      load();
    } finally {
      setBusy("");
    }
  }

  if (!board) return null;

  function toggleIn(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold">🎛 Feature switchboard</h2>
        <p className="text-sm text-text-muted">
          What this deployment runs. A module switched off is off for everyone, including you.
          Narrowing by role or unit restricts who keeps it — it never grants it back.
        </p>
      </div>

      <div className="divide-y divide-edge">
        {board.features.map((f) => (
          <div key={f.key} className="py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={f.enabled}
                  disabled={busy === f.key}
                  onChange={(e) => save(f.key, { enabled: e.target.checked })}
                />
                <span className="font-medium">{f.label}</span>
              </label>
              {!f.enabled && <span className="badge bg-bad/15 text-bad">off</span>}
              {f.enabled && (f.roles.length > 0 || f.bus.length > 0) && (
                <span className="badge bg-warn/15 text-warn">
                  {[f.roles.length ? `${f.roles.length} role(s)` : "", f.bus.length ? `${f.bus.length} BU` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
              <button
                className="ml-auto text-xs text-text-subtle hover:text-text"
                onClick={() => setOpen(open === f.key ? null : f.key)}
              >
                {open === f.key ? "close" : "narrow…"}
              </button>
              {f.configured && (
                <button
                  className="text-xs text-text-subtle hover:text-bad"
                  disabled={busy === f.key}
                  onClick={() => reset(f.key)}
                  title="Forget this switch — the module returns to on for everyone"
                >
                  reset
                </button>
              )}
            </div>
            <p className="mt-0.5 text-xs text-text-subtle">{f.effect}</p>
            {f.updated_by && (
              <p className="text-[11px] text-text-subtle">
                set by {f.updated_by}
                {f.note && ` — ${f.note}`}
              </p>
            )}

            {open === f.key && (
              <div className="mt-2 space-y-2 rounded-lg border border-border p-2.5">
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-text-subtle">
                    Roles — none ticked means everyone
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {board.roles.map((role) => (
                      <button
                        key={role}
                        className={`rounded-full border px-2.5 py-0.5 text-xs ${
                          f.roles.includes(role)
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border text-text-subtle"
                        }`}
                        onClick={() => save(f.key, { roles: toggleIn(f.roles, role) })}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-text-subtle">
                    Business units — none ticked means every unit
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {board.bus.map((bu) => (
                      <button
                        key={bu}
                        className={`rounded-full border px-2.5 py-0.5 text-xs ${
                          f.bus.includes(bu)
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border text-text-subtle"
                        }`}
                        onClick={() => save(f.key, { bus: toggleIn(f.bus, bu) })}
                      >
                        {bu}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  className="input text-sm"
                  placeholder="Why (shown to whoever finds this off later)"
                  defaultValue={f.note}
                  onBlur={(e) => e.target.value !== f.note && save(f.key, { note: e.target.value })}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </section>
  );
}
