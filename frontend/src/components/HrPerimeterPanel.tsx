"use client";

/**
 * The HR lead's view: who is accountable for which BU.
 *
 * An HRBP's reporting is scoped to the BUs assigned to them. This is where
 * those assignments are made and, more usefully, where the gaps show:
 *
 * * a **BU with no HRBP** is unmanaged — nobody is looking at its numbers;
 * * an **HRBP with no BU** sees nothing, which is almost always a setup
 *   oversight rather than a decision.
 *
 * Both are reported explicitly rather than being absent from the list, because
 * a missing row is exactly what nobody notices.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type HrPerimeters, type Learner } from "@/lib/api";
import { useT } from "@/lib/i18n";

export default function HrPerimeterPanel({ me }: { me: Learner | null }) {
  const t = useT();
  const [data, setData] = useState<HrPerimeters | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .hrPerimeters(me?.id)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [me?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save(handle: string) {
    setBusy(true);
    setError(null);
    try {
      await api.setHrPerimeter({ hr_handle: handle, bus: draft, learner_id: me?.id });
      setEditing(null);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="card border-bad/40 text-sm text-bad">{error}</div>;
  if (!data) return <p className="text-sm text-text-subtle">{t("common.loading")}</p>;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        {([
          [t("hrlead.hrbps", "HRBPs"), data.totals.hrbps, ""],
          [t("hrlead.bus", "Business units"), data.totals.bus, ""],
          [t("hrlead.people", "People covered"), data.totals.people, ""],
          [
            t("hrlead.uncovered", "BUs with no HRBP"),
            data.totals.uncovered,
            data.totals.uncovered > 0 ? "border-warn/40" : "",
          ],
        ] as const).map(([label, value, cls]) => (
          <div key={label} className={`card border ${cls}`}>
            <p className="text-xs uppercase tracking-wide text-text-subtle">{label}</p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                cls ? "text-warn" : "text-accent"
              }`}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {data.uncovered_bus.length > 0 && (
        <div className="card border-warn/40 text-sm">
          <p className="font-medium text-warn">
            ⚠ {t("hrlead.uncoveredTitle", "Nobody is accountable for these BUs")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {data.uncovered_bus.join(" · ")} —{" "}
            {t(
              "hrlead.uncoveredBody",
              "their people appear in the org totals, but no HRBP has them in scope.",
            )}
          </p>
        </div>
      )}

      <div className="card p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-edge text-xs uppercase tracking-wide text-text-subtle">
            <tr>
              <th className="px-4 py-3 font-medium">{t("hrlead.hrbp", "HRBP")}</th>
              <th className="px-4 py-3 font-medium">{t("hrlead.perimeter", "Perimeter")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("hrlead.headcount", "People")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data.hrbps.map((h) => (
              <tr key={h.id} className="border-t border-edge align-top">
                <td className="px-4 py-2.5">
                  <p className="font-medium">{h.name}</p>
                  <p className="text-xs text-text-subtle">{h.handle}</p>
                </td>
                <td className="px-4 py-2.5">
                  {editing === h.handle ? (
                    <div className="flex flex-wrap gap-1.5">
                      {data.all_bus.map((bu) => {
                        const on = draft.includes(bu);
                        return (
                          <button
                            key={bu}
                            onClick={() =>
                              setDraft((d) =>
                                on ? d.filter((x) => x !== bu) : [...d, bu],
                              )
                            }
                            className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                              on
                                ? "border-accent bg-accent/15 font-medium text-accent-text"
                                : "border-border text-text-subtle hover:text-text"
                            }`}
                          >
                            {on ? "✓ " : ""}
                            {bu}
                          </button>
                        );
                      })}
                    </div>
                  ) : h.bus.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {h.bus.map((bu) => (
                        <span key={bu} className="badge bg-edge text-text-muted">
                          {bu}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="badge bg-warn/15 text-warn">
                      {t("hrlead.noPerimeter", "No BU — sees nothing")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">{h.headcount}</td>
                <td className="px-4 py-2.5 text-right">
                  {editing === h.handle ? (
                    <span className="inline-flex gap-2">
                      <button
                        className="btn-soft btn-sm"
                        disabled={busy}
                        onClick={() => save(h.handle)}
                      >
                        {t("common.save")}
                      </button>
                      <button className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
                        {t("common.cancel")}
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => {
                        setEditing(h.handle);
                        setDraft(h.bus);
                      }}
                    >
                      {t("common.edit")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data.hrbps.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-text-subtle">
                  {t("hrlead.noHrbps", "No HRBP accounts yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
