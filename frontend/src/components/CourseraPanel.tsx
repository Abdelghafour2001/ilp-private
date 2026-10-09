"use client";

/**
 * Coursera activity — the provider's side of the analytics screen.
 *
 * Grouped by the provider's own fields (programme, business unit, manager)
 * rather than by our org chart, because most of these people have no AIDA
 * account yet: reporting only on the matched ones would show a fraction of the
 * truth. The gap itself is a headline figure instead of a footnote.
 *
 * It is a panel rather than a page: an HR reader comparing the two platforms
 * should not have to navigate between them, so /org switches source instead.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { isForbidden } from "@/components/AccessDenied";
import MarkdownLite from "@/components/MarkdownLite";
import ReportChart from "@/components/ReportChart";
import {
  api,
  type CourseraLearnerQuery,
  type CourseraOverview,
  type CourseraPerson,
  type CourseraSlice,
  openPdf,
} from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useI18n } from "@/lib/i18n";

type SortKey = NonNullable<CourseraLearnerQuery["sort"]>;

const PAGE = 25;

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card py-3">
      <p className="text-xs uppercase tracking-wide text-text-subtle">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tnum">{value}</p>
      {hint && <p className="text-xs text-text-subtle">{hint}</p>}
    </div>
  );
}

/** A breakdown table — the same shape for programmes, units, partners. */
function Breakdown({ title, rows }: { title: string; rows: CourseraSlice[] }) {
  const { t } = useI18n();
  if (rows.length === 0) return null;
  return (
    <section className="card space-y-2">
      <h2 className="font-semibold">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-subtle">
              <th className="py-1.5 pr-3 font-medium">{t("cour.label")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("cour.people")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("cour.enrollments")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("cour.notStarted")}</th>
              <th className="py-1.5 pr-3 text-right font-medium">{t("cour.hours")}</th>
              <th className="py-1.5 text-right font-medium">{t("cour.completion")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 pr-3">{r.label}</td>
                <td className="py-1.5 pr-3 text-right tnum">{r.people}</td>
                <td className="py-1.5 pr-3 text-right tnum">{r.enrollments}</td>
                <td className="py-1.5 pr-3 text-right tnum text-text-subtle">{r.not_started}</td>
                <td className="py-1.5 pr-3 text-right tnum">{r.hours}</td>
                <td className="py-1.5 text-right tnum">
                  <span
                    className={
                      r.completion_rate >= 60
                        ? "text-good"
                        : r.completion_rate >= 30
                          ? "text-warn"
                          : "text-bad"
                    }
                  >
                    {r.completion_rate}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function CourseraPanel() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<CourseraOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // listing
  const [people, setPeople] = useState<CourseraPerson[]>([]);
  const [total, setTotal] = useState(0);
  const [programs, setPrograms] = useState<string[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [query, setQuery] = useState<CourseraLearnerQuery>({
    search: "",
    program: "",
    business_unit: "",
    status: "all",
    sort: "hours",
    direction: "desc",
    limit: PAGE,
    offset: 0,
  });

  // report
  const [report, setReport] = useState<{ markdown: string; generated_by: string } | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [period, setPeriod] = useState<"month" | "quarter" | "year">("month");

  useEffect(() => {
    api
      .courseraOverview(getStoredLearner()?.id)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const loadPeople = useCallback(() => {
    api
      .courseraLearners(query, getStoredLearner()?.id)
      .then((r) => {
        setPeople(r.items);
        setTotal(r.total);
        setPrograms(r.programs);
        setUnits(r.business_units);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [query]);

  useEffect(loadPeople, [loadPeople]);

  function patch(next: Partial<CourseraLearnerQuery>) {
    // Any filter change returns to the first page: staying on page 4 of a list
    // that now has two pages shows an empty table and looks broken.
    setQuery((cur) => ({ ...cur, ...next, offset: next.offset ?? 0 }));
  }

  function sortBy(column: SortKey) {
    patch({
      sort: column,
      direction: query.sort === column && query.direction === "desc" ? "asc" : "desc",
    });
  }

  /** The PDF is a plain download, so it goes through the browser rather than
   *  fetch: a blob URL would lose the filename the server sets. */
  /** One person's card — the named detail that no longer sits in the
   *  committee report, addressed to the manager who can act on it. */
  function downloadCard(email: string) {
    const me = getStoredLearner()?.id;
    const params = new URLSearchParams({ email, period, locale });
    if (me) params.set("learner_id", String(me));
    void openPdf(`/analytics/coursera/person.pdf?${params}`);
  }

  function downloadPdf() {
    const me = getStoredLearner()?.id;
    const params = new URLSearchParams({ period, locale });
    if (me) params.set("learner_id", String(me));
    void openPdf(`/analytics/coursera/report.pdf?${params}`);
  }

  async function generate() {
    setReportBusy(true);
    try {
      const r = await api.courseraReport(locale, getStoredLearner()?.id);
      setReport(r);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setReportBusy(false);
    }
  }

  // The page around this one already gated on HR; a 403 here means the sync
  // user has no reporting rights, which is worth saying plainly.
  if (error && isForbidden(error)) {
    return <p className="card text-sm text-text-subtle">{t("access.detail.org")}</p>;
  }
  if (!data) {
    return <p className="text-sm text-text-subtle">{error ?? t("common.loading")}</p>;
  }
  if (!data.totals.enrollments) {
    return <p className="card text-sm text-text-muted">{t("cour.empty")}</p>;
  }

  const k = data.totals;
  const arrow = (column: SortKey) =>
    query.sort === column ? (query.direction === "desc" ? " ↓" : " ↑") : "";
  const columns: [SortKey, string][] = [
    ["name", t("cour.person")],
    ["enrollments", t("cour.enrollments")],
    ["completed", t("cour.completed")],
    ["completion_rate", t("cour.completion")],
    ["hours", t("cour.hours")],
    ["last_activity", t("cour.lastActivity")],
  ];

  return (
    <div className="space-y-5">
      <p className="text-sm text-text-muted">
        {data.contract}
        {data.synced_at &&
          ` · ${t("cour.syncedAt", { date: new Date(data.synced_at).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB") })}`}
      </p>

      {error && <p className="card text-sm text-bad">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label={t("cour.people")} value={String(k.people)} hint={t("cour.activeHint", { n: k.active_90d })} />
        <Kpi
          label={t("cour.enrollments")}
          value={String(k.enrollments)}
          hint={t("cour.enrollmentSplit", { done: k.completed, doing: k.in_progress, idle: k.not_started })}
        />
        <Kpi label={t("cour.completion")} value={`${k.completion_rate}%`} hint={t("cour.certificates", { n: k.certificates })} />
        <Kpi label={t("cour.hours")} value={`${k.hours}`} hint={t("cour.manDays", { n: k.man_days })} />
        {/* The only place the organisation can see its specializations and
            professional certificates at all: the provider reports the member
            courses and never the programme. */}
        <Kpi
          label={t("cour.specializations")}
          value={String(k.specializations.earned)}
          hint={t("cour.specPeople", { n: k.specializations.people })}
        />
      </div>

      {k.matched_people < k.people && (
        <p className="card border-warn/40 text-sm text-text-muted">
          ⚠️ {t("cour.unlinked", { n: k.people - k.matched_people, total: k.people })}
        </p>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">{t("cour.trend")}</h2>
        <ReportChart kind="column" rows={data.trend} measureLabel={t("cour.completed")} height={220} />
      </section>

      <Breakdown title={t("cour.byProgram")} rows={data.by.program} />
      <Breakdown title={t("cour.byUnit")} rows={data.by.business_unit} />
      <Breakdown title={t("cour.byPartner")} rows={data.by.partner} />

      <section className="card space-y-2">
        <h2 className="font-semibold">{t("cour.topCourses")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-subtle">
                <th className="py-1.5 pr-3 font-medium">{t("cour.course")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("cour.partner")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("cour.enrollments")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("cour.hours")}</th>
                <th className="py-1.5 text-right font-medium">{t("cour.completion")}</th>
              </tr>
            </thead>
            <tbody>
              {data.top_courses.map((c) => (
                <tr key={c.title} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-3">{c.title}</td>
                  <td className="py-1.5 pr-3 text-text-subtle">{c.partner || "—"}</td>
                  <td className="py-1.5 pr-3 text-right tnum">{c.enrollments}</td>
                  <td className="py-1.5 pr-3 text-right tnum">{c.hours}</td>
                  <td className="py-1.5 text-right tnum">{c.completion_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* people */}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            {t("cour.learners")} <span className="text-sm font-normal text-text-subtle">({total})</span>
          </h2>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            className="input max-w-xs"
            placeholder={t("cour.searchPlaceholder")}
            value={query.search}
            onChange={(e) => patch({ search: e.target.value })}
          />
          <select className="input max-w-[14rem]" value={query.program} onChange={(e) => patch({ program: e.target.value })}>
            <option value="">{t("cour.allPrograms")}</option>
            {programs.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            className="input max-w-[12rem]"
            value={query.business_unit}
            onChange={(e) => patch({ business_unit: e.target.value })}
          >
            <option value="">{t("cour.allUnits")}</option>
            {units.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <select
            className="input max-w-[12rem]"
            value={query.status}
            onChange={(e) => patch({ status: e.target.value as CourseraLearnerQuery["status"] })}
          >
            <option value="all">{t("cour.statusAll")}</option>
            <option value="active">{t("cour.statusActive")}</option>
            <option value="stalled">{t("cour.statusStalled")}</option>
            <option value="inactive">{t("cour.statusInactive")}</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-subtle">
                {columns.map(([key, label], i) => (
                  <th key={key} className={`py-1.5 pr-3 font-medium ${i > 0 ? "text-right" : ""}`}>
                    <button type="button" className="hover:text-text" onClick={() => sortBy(key)}>
                      {label}
                      {arrow(key)}
                    </button>
                  </th>
                ))}
                <th className="py-1.5 font-medium text-right">{t("cour.card")}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.email} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-3">
                    <Link
                      href={`/people/${encodeURIComponent(p.email)}`}
                      className="font-medium hover:text-accent"
                    >
                      {p.name}
                    </Link>
                    <span className="block text-xs text-text-subtle">
                      {[p.business_unit, p.job_title, p.location].filter(Boolean).join(" · ") || p.email}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tnum">{p.enrollments}</td>
                  <td className="py-1.5 pr-3 text-right tnum">{p.completed}</td>
                  <td className="py-1.5 pr-3 text-right tnum">{p.completion_rate}%</td>
                  <td className="py-1.5 pr-3 text-right tnum">{p.hours}</td>
                  <td className="py-1.5 text-right tnum text-text-subtle">{p.last_activity ?? "—"}</td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      title={t("cour.cardHint")}
                      onClick={() => downloadCard(p.email)}
                    >
                      ↓ PDF
                    </button>
                  </td>
                </tr>
              ))}
              {people.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} className="py-4 text-center text-sm text-text-subtle">
                    {t("cour.noMatch")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {total > PAGE && (
          <div className="flex items-center justify-between text-sm">
            <button
              className="btn-ghost btn-sm"
              disabled={(query.offset ?? 0) === 0}
              onClick={() => patch({ offset: Math.max(0, (query.offset ?? 0) - PAGE) })}
            >
              ←
            </button>
            <span className="text-text-subtle tnum">
              {(query.offset ?? 0) + 1}–{Math.min(total, (query.offset ?? 0) + PAGE)} / {total}
            </span>
            <button
              className="btn-ghost btn-sm"
              disabled={(query.offset ?? 0) + PAGE >= total}
              onClick={() => patch({ offset: (query.offset ?? 0) + PAGE })}
            >
              →
            </button>
          </div>
        )}
      </section>

      {/* The periodic report lives on Reports now, next to the builder:
          two kinds of reporting on one page beats one buried under the other. */}
      <Link href="/reports" className="card block text-sm text-text-muted hover:border-accent">
        📄 {t("cour.report")} — {t("reports.periodicMoved")}
      </Link>
    </div>
  );
}
