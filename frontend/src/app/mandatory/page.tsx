"use client";

/**
 * Assignment tracking — everything L&D handed out, and where each person got to.
 *
 * This used to answer one question, "who still has mandatory work", and only
 * for courses and trainings. It now covers pathways too, optional assignments
 * as well as mandatory ones, and carries the two figures a follow-up
 * conversation actually needs: what somebody scored, and how many times they
 * tried. Six failures at 68 is a different conversation from one pass at 71,
 * and until attempts were recorded those looked identical.
 *
 * Only assigned people are counted. Someone who took a mandatory course nobody
 * gave them is a volunteer, and counting volunteers as compliance is how a
 * report comes out green while the obligation is unmet.
 *
 * The default order is what needs attention — overdue first, then mandatory,
 * then whoever is furthest behind — because a tracking screen sorted by id is
 * a list, not a tool.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AccessDenied, { isForbidden } from "@/components/AccessDenied";
import AssignWizard from "@/components/AssignWizard";
import Pager, { pageOf } from "@/components/Pager";
import { api, type TrackingItem, type TrackingResponse } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useI18n } from "@/lib/i18n";

const TONE: Record<string, string> = {
  completed: "bg-good/15 text-good",
  in_progress: "bg-warn/15 text-warn",
  not_started: "bg-edge text-text-subtle",
};

const KIND: Record<string, string> = {
  course: "📘",
  formation: "🎓",
  pathway: "🧭",
};

export default function TrackingPage() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({ kind: "", status: "", only: "" });
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    api
      .assignmentTracking(getStoredLearner()?.id)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const rows = useMemo(() => {
    const all = data?.items ?? [];
    return all.filter(
      (i) =>
        (!filters.kind || i.kind === filters.kind) &&
        (!filters.status || i.status === filters.status) &&
        (filters.only !== "mandatory" || i.mandatory) &&
        (filters.only !== "overdue" || i.overdue) &&
        (filters.only !== "struggling" || i.failed_attempts >= 2) &&
        (filters.only !== "not_enrolled" || i.provider_enrolled === false),
    );
  }, [data, filters]);

  function narrow(next: Partial<typeof filters>) {
    setPage(0);
    setFilters((f) => ({ ...f, ...next }));
  }

  if (error && isForbidden(error)) {
    return <AccessDenied audience="access.audience.hr" backHref="/" />;
  }
  if (!data) return <p className="text-sm text-text-subtle">{error ?? t("common.loading")}</p>;

  /** Close a row on evidence the platform cannot see for itself — a Coursera
   *  course taken outside the organisation's programmes never reaches the sync,
   *  so without this the person is reminded daily for ever. Nothing closes
   *  itself: L&D looks at the proof and decides, and the name is recorded. */
  async function accept(row: TrackingItem) {
    const me = getStoredLearner()?.id;
    if (!me) return;
    const note = window.prompt(
      t("track.acceptPrompt", "What is this based on? (certificate, attestation, who confirmed it)"),
      "",
    );
    if (note === null) return;
    await api.acceptAssignment(row.id, me, note).catch((e) => setError(String(e.message ?? e)));
    api.assignmentTracking(me).then(setData).catch(() => {});
  }

  async function undoAccept(row: TrackingItem) {
    const me = getStoredLearner()?.id;
    if (!me) return;
    await api.undoAcceptAssignment(row.id, me).catch((e) => setError(String(e.message ?? e)));
    api.assignmentTracking(me).then(setData).catch(() => {});
  }

  const k = data.totals;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("track.pageTitle")}</h1>
          <p className="text-sm text-text-muted">{t("track.pageLede", { scope: data.scope })}</p>
          {/* Provider figures are as of the last sync, never live. A board that
              does not say so invites somebody to read a four-hour-old number as
              this minute's. */}
          {data.provider_synced_at && (
            <p className="text-xs text-text-subtle">
              🎓 {t("track.asOf", { date: new Date(data.provider_synced_at).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB") }, "Coursera progress as of {date}")}
            </p>
          )}
        </div>
        {/* Tracking and assigning are the same job seen from two ends, so the
            way to hand work out lives on the screen that shows what came of
            it. */}
        <button className="btn shrink-0" onClick={() => setAssigning(true)}>
          📌 {t("wizard.open", "Assign learning")}
        </button>
      </header>

      {assigning && (
        <AssignWizard
          onClose={(sent) => {
            setAssigning(false);
            if (sent) {
              // Everything on this page just changed; reload rather than
              // guess what the campaign did to it.
              api
                .assignmentTracking(getStoredLearner()?.id)
                .then(setData)
                .catch((e) => setError(String(e.message ?? e)));
            }
          }}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {[
          [t("track.assignments"), String(k.assignments), t("track.forPeople", { n: k.people })],
          [t("history.completed"), String(k.completed),
           k.accepted > 0 ? t("track.ofWhichAccepted", { n: k.accepted }, "{n} accepted by L&D") : ""],
          [t("track.mandatoryCount"), String(k.mandatory), ""],
          [t("track.overdueCount"), String(k.overdue), ""],
          [t("track.neverStarted"), String(k.never_started), ""],
          // Assigned and never signed up — a different problem from "started
          // and stalled", and the only one a reminder can actually fix.
          [t("track.notEnrolled", "Never enrolled"), String(k.not_enrolled), t("track.notEnrolledHint", "on Coursera")],
          // The one that answers "who needs help" rather than "who is late".
          [t("track.struggling"), String(k.struggling), t("track.strugglingHint")],
        ].map(([label, value, hint]) => (
          <div key={label} className="card py-3">
            <p className="text-xs uppercase tracking-wide text-text-subtle">{label}</p>
            <p className="mt-0.5 text-2xl font-semibold tnum">{value}</p>
            {hint && <p className="text-xs text-text-subtle">{hint}</p>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-[11rem]" value={filters.kind} onChange={(e) => narrow({ kind: e.target.value })}>
          <option value="">{t("track.allKinds")}</option>
          <option value="course">📘 {t("nav.courses")}</option>
          <option value="formation">🎓 {t("nav.formations")}</option>
          <option value="pathway">🧭 {t("nav.pathways")}</option>
        </select>
        <select className="input max-w-[12rem]" value={filters.status} onChange={(e) => narrow({ status: e.target.value })}>
          <option value="">{t("cour.statusAll")}</option>
          <option value="not_started">{t("track.not_startedLabel")}</option>
          <option value="in_progress">{t("track.in_progressLabel")}</option>
          <option value="completed">{t("track.completedLabel")}</option>
        </select>
        <select className="input max-w-[12rem]" value={filters.only} onChange={(e) => narrow({ only: e.target.value })}>
          <option value="">{t("track.everything")}</option>
          <option value="mandatory">{t("assign.mandatory")}</option>
          <option value="overdue">{t("track.overdueCount")}</option>
          <option value="struggling">{t("track.struggling")}</option>
          {/* The chase list: assigned, and the provider has never seen them.
              Nothing else on this board moves until they sign up. */}
          <option value="not_enrolled">{t("track.notEnrolled", "Never enrolled on the provider")}</option>
        </select>
        <span className="ml-auto text-xs text-text-subtle">{t("track.rows", { n: rows.length })}</span>
      </div>

      <div className="card p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-edge text-xs uppercase tracking-wide text-text-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">{t("track.what")}</th>
                <th className="px-4 py-3 font-medium">{t("org.col.collaborator")}</th>
                <th className="px-4 py-3 font-medium">{t("org.col.bu")}</th>
                <th className="px-4 py-3 font-medium">{t("track.progress")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("cour.grade")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("track.attempts")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("track.due")}</th>
                <th className="px-4 py-3 font-medium">{t("track.assignedBy")}</th>
                <th className="px-4 py-3 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {pageOf(rows, page).map((r: TrackingItem) => (
                <tr key={`${r.kind}-${r.entity_id}-${r.learner_id}`} className="border-t border-edge">
                  <td className="px-4 py-2.5">
                    <Link href={r.link} className="font-medium hover:text-accent">
                      {KIND[r.kind]} {r.title}
                    </Link>
                    {r.mandatory && (
                      <span className="badge ml-2 bg-warn/15 text-warn">{t("assign.mandatory")}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.email ? (
                      <Link href={`/people/${encodeURIComponent(r.email)}`} className="hover:text-accent">
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                    {r.team && <span className="block text-[11px] text-text-subtle">{r.team}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-muted">{r.bu || "—"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className={`h-full rounded-full ${r.status === "completed" ? "bg-good" : "bg-accent"}`}
                          style={{ width: `${Math.max(2, r.percent)}%` }}
                        />
                      </div>
                      <span className={`badge ${TONE[r.status]}`}>{t(`track.${r.status}Label`)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tnum">
                    {r.best_score === null ? "—" : `${r.best_score}%`}
                  </td>
                  <td className="px-4 py-2.5 text-right tnum">
                    {r.attempts === 0 ? (
                      "—"
                    ) : (
                      <span className={r.failed_attempts >= 2 ? "text-bad" : ""}>
                        {r.attempts}
                        {r.failed_attempts > 0 && ` (${r.failed_attempts} ✗)`}
                      </span>
                    )}
                  </td>
                  <td className={`px-4 py-2.5 text-right tnum ${r.overdue ? "text-bad" : "text-text-subtle"}`}>
                    {r.due_date ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-subtle">
                    {r.assigned_by || "—"}
                    {r.via_team && <span className="block">{t("track.viaTeam", { team: r.via_team })}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    {r.accepted_on ? (
                      <button
                        className="badge bg-good/15 text-good"
                        title={`${r.accepted_by} · ${r.accepted_on}${r.accepted_note ? ` · ${r.accepted_note}` : ""} — ${t("track.undoAccept", "click to undo")}`}
                        onClick={() => undoAccept(r)}
                      >
                        ✔ {t("track.acceptedBy", { who: r.accepted_by }, "Accepted by {who}")}
                      </button>
                    ) : (
                      r.status !== "completed" && (
                        <button className="btn-soft btn-sm" onClick={() => accept(r)}>
                          {t("track.accept", "Accept as done")}
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-text-subtle">
                    {t("filter.noMatch")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-3">
          <Pager page={page} total={rows.length} onPage={setPage} />
        </div>
      </div>
    </div>
  );
}
