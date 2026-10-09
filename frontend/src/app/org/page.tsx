"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  api,
  type HrAnalytics,
  type HrCollaboratorRow,
  type Learner,
  type OrgChart as OrgChartData,
  type TeamDashboard,
} from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { downloadCsv, dateStamp } from "@/lib/csv";
import { useFormat, useT } from "@/lib/i18n";
import SkillHeatmapPanel from "@/components/SkillHeatmapPanel";
import HrPerimeterPanel from "@/components/HrPerimeterPanel";
import CourseraPanel from "@/components/CourseraPanel";
import OrgChart from "@/components/OrgChart";
import AccessDenied, { isForbidden } from "@/components/AccessDenied";

/** Which platform's numbers this screen reports. Coursera used to be its own
 *  page, which meant nobody could see the two side by side. */
type Source = "app" | "coursera" | "both";

/** A people-table column. The source switch changes the *set* of columns, so
 *  the table is described once instead of written out three times. */
interface Col {
  key: string;
  label: string;
  right?: boolean;
  cell: (r: HrCollaboratorRow) => ReactNode;
  /** What the CSV export writes; `cell` returns JSX. */
  text: (r: HrCollaboratorRow) => string | number;
}

/** A rate we may not have measured yet reads as "—", never as 0%. */
const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${value}%`;

function initials(nameOrHandle: string) {
  return nameOrHandle
    .split(/[\s.\-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function PersonChip({
  label,
  sub,
  accent,
}: {
  label: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs ${
        accent ? "border-accent/40 bg-accent/10" : "border-border bg-surface"
      }`}
    >
      <span
        className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ${
          accent ? "bg-accent/25 text-accent-text" : "bg-edge text-text-muted"
        }`}
      >
        {initials(label)}
      </span>
      <span className="font-medium">{label}</span>
      {sub && <span className="text-text-subtle">{sub}</span>}
    </span>
  );
}

export default function OrgPage() {
  const t = useT();
  const fmt = useFormat();
  const FORMAT_LABELS: Record<string, string> = {
    in_person: t("org.mode.in_person"),
    virtual: t("org.mode.virtual"),
    hybrid: t("org.mode.hybrid"),
    elearning: t("org.mode.elearning"),
  };
  const SOURCE_LABELS: Record<string, string> = {
    internal: t("org.source.internal"),
    external: t("org.source.external"),
  };
  const [me, setMe] = useState<Learner | null>(null);
  const [teams, setTeams] = useState<TeamDashboard[] | null>(null);
  const [kpi, setKpi] = useState<HrAnalytics | null>(null);
  const [chart, setChart] = useState<OrgChartData | null>(null);
  const [tab, setTab] = useState<"teams" | "content" | "people" | "heatmap" | "perimeters">("teams");
  const [error, setError] = useState<string | null>(null);
  // /coursera redirects here with ?source=coursera, so an old bookmark still
  // lands on the Coursera figures.
  const params = useSearchParams();
  const [source, setSource] = useState<Source>(
    params.get("source") === "coursera" ? "coursera" : params.get("source") === "both" ? "both" : "app",
  );
  // Coursera on its own has no org tabs to show: the panel reports on the
  // provider's whole population, most of which has no account here.
  const shown = source === "coursera" ? null : tab;
  // 275 people do not belong on one page. The filters narrow, this pages what
  // is left, and any filter change goes back to page one — staying on page 8
  // of a list that now has two shows an empty table and looks broken.
  const [page, setPage] = useState(0);
  // M-06 — filtres RH par axe organisationnel
  const [filters, setFilters] = useState({ bu: "", practice: "", location: "", job_level: "" });
  // Programme filters: mode de formation and interne/externe.
  const [contentFilters, setContentFilters] = useState({ format: "", source: "" });

  const distinct = (key: "bu" | "practice" | "location" | "job_level") =>
    [...new Set((kpi?.collaborators ?? []).map((r) => r[key]).filter(Boolean))].sort();

  const filteredCollaborators = (kpi?.collaborators ?? []).filter(
    (r) =>
      (!filters.bu || r.bu === filters.bu) &&
      (!filters.practice || r.practice === filters.practice) &&
      (!filters.location || r.location === filters.location) &&
      (!filters.job_level || r.job_level === filters.job_level),
  );
  const anyFilter = Object.values(filters).some(Boolean);
  // On AIDA alone the summary must not quote hours earned on Coursera.
  const hoursOf = (r: HrCollaboratorRow) => (source === "both" ? r.hours : r.app_hours);
  const filteredHours = filteredCollaborators.reduce((s, r) => s + hoursOf(r), 0);
  const PAGE = 25;
  const pageCount = Math.max(1, Math.ceil(filteredCollaborators.length / PAGE));
  const pageRows = filteredCollaborators.slice(page * PAGE, page * PAGE + PAGE);
  const filteredManDays = filteredHours / (kpi?.hours_per_man_day ?? 7);

  const filteredContent = (kpi?.content ?? []).filter(
    (r) =>
      (!contentFilters.format || r.format === contentFilters.format) &&
      (!contentFilters.source || r.source === contentFilters.source),
  );

  // ---- the people table, described once -----------------------------------
  const num = (v: number) => (v ? String(v) : "—");
  const identity: Col[] = [
    {
      key: "person",
      label: t("org.col.collaborator"),
      // Clicking somebody opens their record — both platforms on one page.
      // Anybody with an address has one now, whether or not they have ever
      // touched Coursera; the provider half is simply empty for most people.
      cell: (r) => {
        const address = r.coursera_email || r.email;
        const body = (
          <>
            <p className="font-medium">{r.name || r.handle}</p>
            <p className="text-[11px] text-text-subtle">{r.handle}</p>
          </>
        );
        return address ? (
          <Link href={`/people/${encodeURIComponent(address)}`} className="block hover:text-accent">
            {body}
          </Link>
        ) : (
          body
        );
      },
      text: (r) => r.name || r.handle,
    },
    { key: "bu", label: t("org.col.bu"), cell: (r) => r.bu || "—", text: (r) => r.bu || "—" },
    { key: "practice", label: t("org.col.practice"), cell: (r) => r.practice || "—", text: (r) => r.practice || "—" },
    {
      key: "linked",
      label: t("org.col.linked"),
      // Whether the two platforms are joined for this person is the first
      // thing to check when their Coursera columns read zero.
      cell: (r) =>
        r.coursera_email ? (
          <Link
            href={`/people/${encodeURIComponent(r.coursera_email)}`}
            title={`${t("org.linked.yes")} — ${r.coursera_email}`}
            className="text-good hover:underline"
          >
            🔗
          </Link>
        ) : (
          <span title={t("org.linked.no")} className="text-text-subtle">
            —
          </span>
        ),
      text: (r) => r.coursera_email || "—",
    },
  ];
  const orgAxes: Col[] = [
    {
      key: "team",
      label: t("org.col.team"),
      cell: (r) =>
        r.team ? (
          <span className="badge bg-edge text-text-subtle">{r.team}</span>
        ) : (
          <span className="text-xs text-text-subtle">—</span>
        ),
      text: (r) => r.team || "—",
    },
    { key: "location", label: t("org.col.location"), cell: (r) => r.location || "—", text: (r) => r.location || "—" },
    { key: "matricule", label: t("org.col.matricule"), cell: (r) => r.matricule || "—", text: (r) => r.matricule || "—" },
    { key: "job_level", label: t("org.col.jobLevel"), cell: (r) => r.job_level || "—", text: (r) => r.job_level || "—" },
  ];
  const appCols: Col[] = [
    { key: "trainings", label: t("org.col.trainings"), right: true, cell: (r) => r.trainings_followed, text: (r) => r.trainings_followed },
    { key: "courses", label: t("org.col.courses"), right: true, cell: (r) => r.courses_followed, text: (r) => r.courses_followed },
    { key: "lessons", label: t("org.col.lessons"), right: true, cell: (r) => r.lessons_done, text: (r) => r.lessons_done },
    {
      key: "app_hours",
      label: t("org.col.appHours"),
      right: true,
      cell: (r) => <span className="text-accent-text">{r.app_hours}</span>,
      text: (r) => r.app_hours,
    },
    {
      key: "attendance",
      label: t("org.col.attendance"),
      right: true,
      cell: (r) => (
        <span title={r.sessions_marked ? `${r.sessions_attended}/${r.sessions_marked}` : t("org.col.sessionsAttended")}>
          {pct(r.attendance_rate)}
        </span>
      ),
      text: (r) => pct(r.attendance_rate),
    },
    { key: "comments", label: "💬", right: true, cell: (r) => r.comments, text: (r) => r.comments },
    { key: "likes", label: "👍", right: true, cell: (r) => r.likes, text: (r) => r.likes },
    { key: "certs", label: "🏅", right: true, cell: (r) => r.certificates, text: (r) => r.certificates },
  ];
  const courseraCols: Col[] = [
    { key: "c_enrollments", label: t("cour.enrollments"), right: true, cell: (r) => num(r.external_courses), text: (r) => r.external_courses },
    { key: "c_completed", label: t("cour.completed"), right: true, cell: (r) => num(r.external_completed), text: (r) => r.external_completed },
    {
      key: "c_rate",
      label: t("cour.completion"),
      right: true,
      cell: (r) => pct(r.external_completion_rate),
      text: (r) => pct(r.external_completion_rate),
    },
    {
      key: "c_hours",
      label: t("org.col.courseraHours"),
      right: true,
      cell: (r) => <span className="text-accent-text">{num(r.external_hours)}</span>,
      text: (r) => r.external_hours,
    },
    { key: "c_certs", label: `🎓 ${t("cour.certificatesLabel")}`, right: true, cell: (r) => num(r.external_certificates), text: (r) => r.external_certificates },
    {
      key: "c_last",
      label: t("cour.lastActivity"),
      right: true,
      cell: (r) => r.external_last_activity ?? "—",
      text: (r) => r.external_last_activity ?? "—",
    },
  ];
  const lastActive: Col = {
    key: "last_active",
    label: t("org.col.lastActive"),
    right: true,
    cell: (r) =>
      r.active_this_week ? (
        <span className="text-good">● {t("org.thisWeek")}</span>
      ) : r.last_active_on ? (
        new Date(r.last_active_on).toLocaleDateString(undefined, { day: "numeric", month: "short" })
      ) : (
        "—"
      ),
    text: (r) => (r.active_this_week ? t("org.thisWeek") : r.last_active_on ?? "—"),
  };
  // The source switch changes which columns exist, not which table is written.
  const peopleCols: Col[] =
    source === "both"
      ? [
          ...identity,
          ...appCols,
          ...courseraCols,
          {
            key: "total_hours",
            label: t("org.col.totalHours"),
            right: true,
            cell: (r) => <span className="font-semibold">{r.hours}</span>,
            text: (r) => r.hours,
          },
          { key: "man_days", label: t("org.col.manDays"), right: true, cell: (r) => r.man_days, text: (r) => r.man_days },
          lastActive,
        ]
      : [...identity, ...orgAxes, ...appCols, lastActive];

  useEffect(() => {
    const learner = getStoredLearner();
    setMe(learner);
    api
      .orgOverview(learner?.id)
      .then(setTeams)
      .catch((e) => setError(String(e)));
    api.hrAnalytics(learner?.id).then(setKpi).catch(() => {});
    api.hrOrgChart(learner?.id).then(setChart).catch(() => {});
  }, []);

  const allowed = !error;
  // `allowed` already gated the body; this replaces the bare error text with a
  // screen that says who the page is for.
  const forbidden = !!error && isForbidden(error);
  const totals = teams
    ? {
        teams: teams.length,
        managers: new Set(teams.map((t) => t.team.manager_handle).filter(Boolean)).size,
        members: teams.reduce((s, t) => s + t.totals.members, 0),
        xp: teams.reduce((s, t) => s + t.totals.total_xp, 0),
        active: teams.reduce((s, t) => s + t.totals.active_this_week, 0),
      }
    : null;
  function exportContentCsv() {
    if (!filteredContent.length) return;
    const rows = filteredContent.map((r) => ({
      [t("org.col.content")]: r.title,
      [t("org.col.owner")]: r.owner || "—",
      [t("org.col.editors")]: r.editors.length ? r.editors.join(", ") : "—",
      [t("org.col.mode")]: FORMAT_LABELS[r.format] ?? "—",
      [t("org.col.type")]: SOURCE_LABELS[r.source],
      ["Provider"]: r.provider || "—",
      [t("org.col.subscribers")]: r.subscribers,
      [t("org.col.completed")]: r.completed ?? "—",
      [t("org.col.completionRate")]: pct(r.completion_rate),
      [t("org.col.attendance")]: pct(r.attendance_rate),
      [t("org.col.hours")]: r.hours,
      [t("org.col.manDays")]: r.man_days,
      [t("org.col.avgStars")]: r.avg_stars !== null ? r.avg_stars.toFixed(1) : "—",
      [t("org.col.feedbackRate")]: `${r.feedback_rate}%`,
      ["Comments"]: r.comments,
      ["Likes"]: r.likes,
      ["Shares"]: r.shares,
    }));
    downloadCsv(`aida-programmes-${dateStamp()}.csv`, rows);
  }

  function exportCollaboratorsCsv() {
    if (!filteredCollaborators.length) return;
    // Same columns as the screen: a figure that is not on display must not
    // arrive in the export either.
    const rows = filteredCollaborators.map((r) =>
      Object.fromEntries(peopleCols.map((c) => [c.label, c.text(r)])),
    );
    downloadCsv(`aida-collaborateurs-${source}-${dateStamp()}.csv`, rows);
  }

  if (forbidden) {
    return (
      <AccessDenied
        audience="access.audience.hr"
        detailKey="access.detail.org"
        backHref="/team"
        backLabelKey="access.back.team"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("org.title")}</h1>
          <p className="mt-1 text-sm text-text-muted">{t("org.subtitle")}</p>
          {/* One analytics screen, three sources. Reading UpSkill and Coursera on
              two separate pages made them impossible to compare. */}
          <div className="mt-3 flex items-center gap-1 rounded-lg border border-border p-0.5 w-fit">
            {(
              [
                ["app", `📊 ${t("org.view.app")}`, t("org.view.appHint")],
                ["coursera", `🎓 ${t("org.view.coursera")}`, t("org.view.courseraHint")],
                ["both", `🔀 ${t("org.view.both")}`, t("org.view.bothHint")],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                onClick={() => setSource(value)}
                title={hint}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  source === value
                    ? "bg-accent/15 text-accent-text"
                    : "text-text-subtle hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {kpi && (
          <div className="flex items-center gap-2">
            {/* An HRBP is scoped to their BU server-side; say so, so nobody
                reads a partial view as the whole company. */}
            <span
              className={`rounded-full border px-3 py-1 text-xs ${
                kpi.scope.org_wide
                  ? "border-border bg-surface text-text-muted"
                  : "border-accent/40 bg-accent/10 text-accent-text"
              }`}
              title={
                kpi.scope.org_wide
                  ? t("org.scope.orgWideHint")
                  : t("org.scope.buHint")
              }
            >
              {kpi.scope.org_wide ? "🌍 " : "🔒 "}
              {kpi.scope.org_wide ? t("org.scope.orgWide") : kpi.scope.label}
            </span>
            <a
              className="btn-ghost btn-sm"
              href={api.hrExportUrl("xlsx", source, me?.id)}
              title={t("common.export") + " — Excel"}
            >
              ⬇ Excel
            </a>
            <a
              className="btn-ghost btn-sm"
              href={api.hrExportUrl("pdf", source, me?.id)}
              title={t("common.export") + " — PDF"}
            >
              ⬇ PDF
            </a>
          </div>
        )}
      </div>

      {error && (
        <div className="card text-center text-sm text-text-subtle">
          {t("org.denied")}{" "}
          {me ? t("org.denied.askAdmin") : t("common.signInFirst")}
        </div>
      )}

      {allowed && teams && (
        <>
          {/* org totals */}
          {totals && source !== "coursera" && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: t("org.teams"), value: totals.teams },
                { label: t("org.managers"), value: totals.managers },
                { label: t("org.learnersInTeams"), value: totals.members },
                { label: t("org.activeThisWeek"), value: `${totals.active}/${totals.members}` },
                { label: t("org.orgXp"), value: fmt.number(totals.xp) },
              ].map((s) => (
                <div key={s.label} className="card">
                  <p className="text-xs uppercase tracking-wide text-text-subtle">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-accent">{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* engagement KPIs */}
          {kpi && source !== "coursera" && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                // In "both" the headline is the blend; on its own AIDA reports
                // only what happened here, because `learning_hours` already
                // carries the provider's hours and would double the story.
                source === "both"
                  ? {
                      label: `⏱ ${t("org.kpi.totalHours")}`,
                      value: kpi.totals.learning_hours,
                      hint: `${kpi.totals.app_hours} h ${t("org.view.app")} · ${kpi.totals.external_hours} h ${t("org.view.coursera")}`,
                    }
                  : {
                      label: `⏱ ${t("org.kpi.appHours")}`,
                      value: kpi.totals.app_hours,
                      // No external figure here: this tile is the AIDA source,
                      // and quoting Coursera hours under it is what the switch
                      // exists to stop.
                      hint: `${kpi.totals.session_hours} h ${t("org.kpi.sessionHours")} · ${kpi.totals.declared_hours} h ${t("org.kpi.declaredHours")}`,
                    },
                ...(source === "both"
                  ? [
                      {
                        label: `🎓 ${t("org.kpi.courseraEnrollments")}`,
                        value: kpi.totals.external_courses,
                        hint: `${pct(kpi.totals.external_completion_rate)} · ${t("org.kpi.linkedPeople", {
                          linked: kpi.totals.external_people,
                          total: kpi.totals.learners,
                        })}`,
                      },
                    ]
                  : []),
                {
                  label: `📆 ${t("org.kpi.manDays")}`,
                  // Follows the hours tile above it. Man-days off the blended
                  // total under an AIDA heading is the same mistake one line down.
                  value:
                    source === "both"
                      ? kpi.totals.man_days
                      : Math.round((10 * kpi.totals.app_hours) / kpi.hours_per_man_day) / 10,
                },
                { label: `✅ ${t("org.kpi.completion")}`, value: `${kpi.totals.completion_rate}%` },
                {
                  label: `🙋 ${t("org.kpi.attendance")}`,
                  value: pct(kpi.totals.attendance_rate),
                  hint: t("org.kpi.attendanceHint", {
                    present: kpi.totals.sessions_attended,
                    marked: kpi.totals.sessions_marked,
                  }),
                },
                {
                  label: `🏗 ${t("org.kpi.sourceSplit")}`,
                  value: `${kpi.totals.internal_programs} · ${kpi.totals.external_programs}`,
                },
                { label: `⭐ ${t("org.kpi.feedback")}`, value: `${kpi.totals.feedback_rate}%` },
                { label: `🏅 ${t("org.kpi.certificates")}`, value: kpi.totals.certificates },
              ].map((s) => (
                <div key={s.label} className="card">
                  <p className="text-xs uppercase tracking-wide text-text-subtle">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-accent">{s.value}</p>
                  {"hint" in s && s.hint && (
                    <p className="mt-0.5 text-[11px] text-text-subtle">{s.hint}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Provider accounts we could not tie to a learner. Surfaced because
              a silent drop and a genuine zero look identical in a report. */}
          {kpi && kpi.totals.external_unmatched > 0 && (
            <div className="card border-warn/40 text-sm">
              <p className="font-medium text-warn">
                ⚠ {t("org.unmatched.title", { count: kpi.totals.external_unmatched })}
              </p>
              <p className="mt-1 text-xs text-text-muted">{t("org.unmatched.body")}</p>
            </div>
          )}

          {/* Coursera on its own needs none of the org tabs below: the panel
              reports on the provider's whole population, including the people
              who have no account here. */}
          {source === "coursera" && <CourseraPanel />}

          {/* section tabs */}
          {shown && (
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 w-fit">
            {[
              { k: "teams" as const, label: `🌳 ${t("org.tab.teams")}` },
              { k: "content" as const, label: `📚 ${t("org.tab.content")}` },
              { k: "people" as const, label: `👤 ${t("org.tab.people")}` },
              { k: "heatmap" as const, label: `🔥 ${t("org.tab.heatmap")}` },
              // Only the HR lead has anything to do here.
              ...(me?.role === "hr_lead" || me?.role === "admin"
                ? [{ k: "perimeters" as const, label: `🧭 ${t("org.tab.perimeters")}` }]
                : []),
            ].map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  tab === t.k ? "bg-accent/15 text-accent-text" : "text-text-subtle hover:text-text"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          )}

          {/* content analytics */}
          {shown === "content" && kpi && (
            <div className="card p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="input h-8 py-0 text-xs"
                    value={contentFilters.format}
                    onChange={(e) => setContentFilters({ ...contentFilters, format: e.target.value })}
                  >
                    <option value="">{t("org.filter.allModes")}</option>
                    {Object.entries(FORMAT_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                  <select
                    className="input h-8 py-0 text-xs"
                    value={contentFilters.source}
                    onChange={(e) => setContentFilters({ ...contentFilters, source: e.target.value })}
                  >
                    <option value="">{t("org.filter.allSources")}</option>
                    <option value="internal">{t("org.source.internal")}</option>
                    <option value="external">{t("org.source.external")}</option>
                  </select>
                  <span className="text-xs text-text-subtle">
                    {t("org.filter.programs", { count: filteredContent.length })}
                  </span>
                </div>
                <button
                  onClick={exportContentCsv}
                  disabled={!filteredContent.length}
                  className="btn-ghost btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ⬇ {t("common.export")}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-edge text-xs uppercase tracking-wide text-text-subtle">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t("org.col.content")}</th>
                      <th className="px-4 py-3 font-medium">{t("org.col.owner")}</th>
                      <th className="px-4 py-3 font-medium">{t("org.col.editors")}</th>
                      <th className="px-4 py-3 font-medium">{t("org.col.mode")}</th>
                      <th className="px-4 py-3 font-medium">{t("org.col.type")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("org.col.subscribers")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("org.col.completed")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("org.col.completionRate")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("org.col.attendance")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("org.col.hours")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("org.col.manDays")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("org.col.avgStars")}</th>
                      <th className="px-4 py-3 text-right font-medium">{t("org.col.feedbackRate")}</th>
                      <th className="px-4 py-3 text-right font-medium">💬</th>
                      <th className="px-4 py-3 text-right font-medium">👍</th>
                      <th className="px-4 py-3 text-right font-medium">🔗</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContent.map((r) => (
                      <tr key={`${r.type}-${r.id}`} className="border-t border-edge">
                        <td className="px-4 py-2.5">
                          <Link
                            href={r.type === "formation" ? `/formations/${r.id}` : `/courses/${r.id}`}
                            className="flex items-center gap-2 hover:underline"
                          >
                            <span>{r.emoji}</span>
                            <span className="max-w-[240px] truncate font-medium">{r.title}</span>
                          </Link>
                          <span className="ml-7 text-[11px] text-text-subtle">
                            {r.type === "formation" ? "training" : r.external ? `course · ${r.external}` : "course"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-text-muted">{r.owner || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-text-subtle">
                          {r.editors.length ? r.editors.join(", ") : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-text-muted">
                          {FORMAT_LABELS[r.format] ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <span
                            className={`rounded-full px-2 py-0.5 ${
                              r.source === "external"
                                ? "bg-amber-500/15 text-amber-500"
                                : "bg-edge text-text-muted"
                            }`}
                            title={r.provider || undefined}
                          >
                            {SOURCE_LABELS[r.source]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono">{r.subscribers}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{r.completed ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{pct(r.completion_rate)}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{pct(r.attendance_rate)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-accent-text">{r.hours}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{r.man_days}</td>
                        <td className="px-4 py-2.5 text-right font-mono">
                          {r.avg_stars !== null ? `⭐ ${r.avg_stars}` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono">{r.feedback_rate}%</td>
                        <td className="px-4 py-2.5 text-right font-mono">{r.comments}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{r.likes}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{r.shares}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-edge px-4 py-2 text-[11px] text-text-subtle">
                ⏱ {t("org.hoursNote", { hoursPerDay: kpi.hours_per_man_day })}
              </p>
            </div>
          )}

          {shown === "heatmap" && <SkillHeatmapPanel me={me} />}

          {shown === "perimeters" && <HrPerimeterPanel me={me} />}

          {/* per collaborator */}
          {shown === "people" && kpi && (
            <div className="card p-0">
              {/* M-06 — barre de filtres par axe organisationnel */}
              <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2.5">
                {([
                  ["bu", t("org.col.bu")],
                  ["practice", t("org.col.practice")],
                  ["location", t("org.col.location")],
                  ["job_level", t("org.col.jobLevel")],
                ] as const).map(([key, label]) => (
                  <select
                    key={key}
                    value={filters[key]}
                    onChange={(e) => { setPage(0); setFilters((f) => ({ ...f, [key]: e.target.value })); }}
                    className="input max-w-[170px] py-1 text-xs"
                  >
                    <option value="">{label} : {t("common.all")}</option>
                    {distinct(key).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                ))}
                {anyFilter && (
                  <button
                    onClick={() => { setPage(0); setFilters({ bu: "", practice: "", location: "", job_level: "" }); }}
                    className="text-xs text-text-subtle hover:text-text"
                  >
                    ✕ {t("common.reset")}
                  </button>
                )}
                <span className="ml-auto text-xs text-text-subtle">
                  {t("org.people.summary", {
                    count: filteredCollaborators.length,
                    hours: filteredHours.toFixed(1),
                    manDays: filteredManDays.toFixed(1),
                  })}
                </span>
                <button
                  onClick={exportCollaboratorsCsv}
                  disabled={!filteredCollaborators.length}
                  className="btn-ghost btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ⬇ {t("common.export")}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px] text-left text-sm">
                  <thead className="border-b border-edge text-xs uppercase tracking-wide text-text-subtle">
                    <tr>
                      {peopleCols.map((c) => (
                        <th
                          key={c.key}
                          className={`px-4 py-3 font-medium ${c.right ? "text-right" : ""}`}
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => (
                      <tr key={r.learner_id} className="border-t border-edge">
                        {peopleCols.map((c) => (
                          <td
                            key={c.key}
                            className={`px-4 py-2.5 ${
                              c.right ? "text-right font-mono" : "text-xs text-text-muted"
                            }`}
                          >
                            {c.cell(r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {filteredCollaborators.length === 0 && (
                      <tr>
                        <td colSpan={peopleCols.length} className="px-4 py-8 text-center text-sm text-text-subtle">
                          {t("filter.noMatch")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {pageCount > 1 && (
                <div className="flex items-center justify-between border-t border-edge px-4 py-2.5 text-sm">
                  <button
                    className="btn-ghost btn-sm disabled:opacity-40"
                    disabled={page === 0}
                    onClick={() => setPage((n) => Math.max(0, n - 1))}
                  >
                    ←
                  </button>
                  <span className="tnum text-text-subtle">
                    {page * PAGE + 1}–{Math.min(filteredCollaborators.length, (page + 1) * PAGE)} /{" "}
                    {filteredCollaborators.length}
                  </span>
                  <button
                    className="btn-ghost btn-sm disabled:opacity-40"
                    disabled={page + 1 >= pageCount}
                    onClick={() => setPage((n) => Math.min(pageCount - 1, n + 1))}
                  >
                    →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* the reporting line, as a chart rather than a flat list of teams */}
          {shown === "teams" && (
          <>
          <div className="card">
            {chart ? (
              <OrgChart data={chart} />
            ) : (
              <p className="text-sm text-text-subtle">Loading…</p>
            )}
          </div>

          <p className="text-xs text-text-subtle">
            {t("org.chart.manageTeam")} opens the full dashboard where you can add/remove members
            and assign trainings — as HR you have that power on every team.
          </p>
          </>
          )}

          {/* In "both", the provider's own view sits under the org view: the
              app can only see the Coursera activity of people who are linked,
              and this panel is where the rest of the population appears. */}
          {source === "both" && (
            <section className="space-y-3 border-t border-edge pt-5">
              <h2 className="text-lg font-semibold">🎓 {t("org.view.coursera")}</h2>
              <CourseraPanel />
            </section>
          )}
        </>
      )}

      {!teams && !error && <p className="text-sm text-text-subtle">Loading…</p>}
    </div>
  );
}
