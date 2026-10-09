"use client";

/**
 * One person's Coursera profile — everything the provider knows about them,
 * on its own page rather than squeezed into the listing row.
 *
 * It also carries the two actions that belong to a single person: pulling
 * their card as a PDF, and linking their provider account to an AIDA one so
 * the hours stop being invisible to the rest of the platform.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AccessDenied, { isForbidden } from "@/components/AccessDenied";
import Pager, { pageOf } from "@/components/Pager";
import { api, openPdf, type CourseraPerson } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useI18n } from "@/lib/i18n";

type Period = "month" | "quarter" | "year";

interface PersonPage {
  person: {
    name: string;
    email: string;
    unit: string;
    job_title: string;
    location: string;
    manager: string;
    programs: string[];
    linked: boolean;
    learner_id: number | null;
  };
  /** The same person's activity inside AIDA. Null when nothing is linked. */
  aida: {
    handle: string;
    xp: number;
    coursera_xp: number;
    level: number;
    level_title: string;
    level_pct: number;
    xp_to_next: number;
    badges: { id: string; name: string; emoji: string; description: string }[];
    badge_total: number;
    current_streak: number;
    longest_streak: number;
    last_active_on: string;
    items: number;
    completed: number;
    in_progress: number;
    hours: number;
    certificates: number;
    mandatory_open: number;
  } | null;
  now: { completions: number; hours: number; certificates: number; starts: number; active_people: number };
  before: { completions: number; hours: number; certificates: number };
  totals: {
    enrollments: number;
    completed: number;
    in_progress: number;
    never_opened: number;
    completion_rate: number;
    hours: number;
    man_days: number;
    certificates: number;
  };
  benchmark: {
    unit_label: string;
    unit_median_hours: number;
    unit_median_rate: number;
    org_median_hours: number;
    org_median_rate: number;
  };
  /** Specializations and professional certificates, derived from the completed
      courses. Part-done ones are included on purpose — "9 of 10" is either a
      nudge or the evidence that a course is missing from the provider feed. */
  specializations: {
    slug: string;
    name: string;
    partner: string;
    url: string;
    courses: number;
    done: number;
    complete: boolean;
    earned_on: string;
    /** Member courses counted on the learner's word, not the provider's
     *  report. A reviewer should see these before quoting it as earned. */
    declared: string[];
  }[];
  by_program: { label: string; enrollments: number; completed: number; rate: number; hours: number }[];
  items: {
    title: string;
    program: string;
    progress: number;
    hours: number;
    grade: number | null;
    completed_on: string;
    certificate: boolean;
    last_activity: string;
  }[];
  findings: string[];
}

export default function CourseraPersonPage() {
  const { t, locale } = useI18n();
  const params = useParams<{ email: string }>();
  const email = decodeURIComponent(params.email);
  // Same calendar range as the periodic report, so a card and the report it
  // came from can never be read as covering different stretches of time.
  // Empty dates are the whole record. That is what the card is for — a year to
  // date told you nothing about somebody who stopped in March — and narrowing
  // it is one click away below.
  const [range, setRange] = useState({ start: "", end: "" });
  const [data, setData] = useState<PersonPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkTo, setLinkTo] = useState("");
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);

  const load = useCallback(() => {
    api
      .courseraPerson(email, range, getStoredLearner()?.id)
      .then((d) => setData(d as PersonPage))
      .catch((e) => setError(String(e.message ?? e)));
  }, [email, range]);

  useEffect(load, [load]);

  function downloadCard() {
    const me = getStoredLearner()?.id;
    const query = new URLSearchParams({ email, locale });
    if (range.start && range.end) {
      query.set("start", range.start);
      query.set("end", range.end);
    }
    if (me) query.set("learner_id", String(me));
    void openPdf(`/analytics/coursera/person.pdf?${query}`);
  }

  async function link() {
    setBusy(true);
    setLinkMsg(null);
    try {
      const r = await api.courseraLink(linkTo.trim(), email);
      setLinkMsg(
        t("cour.linked", {
          handle: r.handle,
          xp: r.xp.granted,
          certs: r.certificates_recorded,
        }),
      );
      setLinkTo("");
      load();
    } catch (e) {
      setLinkMsg(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (error && isForbidden(error)) return <AccessDenied audience="access.audience.hr" backHref="/org?source=coursera" />;
  if (!data) return <p className="text-sm text-text-subtle">{error ?? t("common.loading")}</p>;

  const { person, totals, benchmark } = data;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <Link href="/org" className="text-sm text-text-subtle hover:text-text">
          ← {t("nav.org")}
        </Link>
        <h1 className="text-2xl font-semibold">{person.name}</h1>
        <p className="text-sm text-text-muted">
          {[person.job_title, person.unit, person.location].filter(Boolean).join(" · ")}
        </p>
        <p className="text-xs text-text-subtle">
          {person.email}
          {person.manager && ` · ${t("cour.manager")}: ${person.manager}`}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm text-text-subtle">
          {t("reports.from")}
          <input
            type="date"
            className="input max-w-[10rem]"
            value={range.start}
            max={range.end}
            onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-text-subtle">
          {t("reports.to")}
          <input
            type="date"
            className="input max-w-[10rem]"
            value={range.end}
            min={range.start}
            onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
          />
        </label>
        <button
          className="rounded-full border border-border px-2.5 py-0.5 text-xs text-text-subtle transition hover:border-accent hover:text-text"
          onClick={() => setRange({ start: "", end: "" })}
          disabled={!range.start && !range.end}
        >
          {t("reports.fullHistory")}
        </button>
        <button className="btn-ghost" onClick={downloadCard}>
          {t("cour.cardHint")}
        </button>
      </div>

      {!person.linked && totals.enrollments > 0 && (
        <section className="card space-y-2 border-warn/40">
          <p className="text-sm text-text-muted">{t("cour.notLinked")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input max-w-xs"
              placeholder={t("cour.linkPlaceholder")}
              value={linkTo}
              onChange={(e) => setLinkTo(e.target.value)}
            />
            <button className="btn btn-sm" onClick={link} disabled={busy || !linkTo.trim()}>
              {busy ? t("cour.linking") : t("cour.link")}
            </button>
          </div>
          {linkMsg && <p className="text-sm text-good">{linkMsg}</p>}
        </section>
      )}
      {person.linked && (
        <p className="card border-good/40 text-sm text-good">{t("cour.isLinked")}</p>
      )}
      {!person.linked && totals.enrollments === 0 && (
        <p className="card text-sm text-text-muted">{t("cour.noProviderAccount")}</p>
      )}

      {/* What they did here. A linked profile should answer both halves of
          the question without sending the reader to another screen. */}
      {data.aida && (
        <section className="space-y-2">
          <h2 className="font-semibold">📊 {t("org.view.app")}</h2>

          {/* Standing before counters: level, streak and badges say what this
              person is, where the tiles below say what they did. */}
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="badge bg-accent/15 text-accent">
                {t("common.level")} {data.aida.level} · {data.aida.level_title}
              </span>
              <span className="text-sm text-text-muted">
                {t("person.xpToNext", { n: data.aida.xp_to_next })}
              </span>
              <span className="ml-auto text-sm text-text-muted">
                {data.aida.current_streak > 0
                  ? `🔥 ${data.aida.current_streak} ${t("profile.dayStreak")}`
                  : t("person.noStreak")}
                {data.aida.longest_streak > 0 &&
                  ` · ${data.aida.longest_streak} ${t("profile.bestStreak")}`}
              </span>
              {data.aida.last_active_on && (
                <span className="text-sm text-text-subtle">
                  {t("org.col.lastActive")}: {data.aida.last_active_on}
                </span>
              )}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${data.aida.level_pct}%` }} />
            </div>
            <div className="space-y-1.5 border-t border-edge pt-2.5">
              <p className="text-xs uppercase tracking-wide text-text-subtle">
                {t("profile.badges")} · {data.aida.badges.length}/{data.aida.badge_total}
              </p>
              {data.aida.badges.length === 0 ? (
                <p className="text-sm text-text-subtle">{t("person.noBadges")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {data.aida.badges.map((b) => (
                    <span
                      key={b.id}
                      title={b.description}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs"
                    >
                      <span aria-hidden>{b.emoji}</span>
                      {b.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              [t("history.completed"), String(data.aida.completed), t("history.ofItems", { n: data.aida.items })],
              [t("history.inProgress"), String(data.aida.in_progress),
               data.aida.mandatory_open > 0 ? t("history.mandatoryOpen", { n: data.aida.mandatory_open }) : ""],
              [t("org.col.appHours"), String(data.aida.hours), ""],
              ["XP", String(data.aida.xp), t("org.xpFromCoursera", { n: data.aida.coursera_xp })],
              [t("certs.title"), String(data.aida.certificates), ""],
            ].map(([label, value, hint]) => (
              <div key={label} className="card py-3">
                <p className="text-xs uppercase tracking-wide text-text-subtle">{label}</p>
                <p className="mt-0.5 text-2xl font-semibold tnum">{value}</p>
                {hint && <p className="text-xs text-text-subtle">{hint}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <h2 className="font-semibold">🎓 Coursera</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t("cour.enrollments"), String(totals.enrollments),
           t("cour.enrollmentSplit", { done: totals.completed, doing: totals.in_progress, idle: totals.never_opened })],
          [t("cour.completion"), `${totals.completion_rate}%`,
           t("cour.vsOrg", { n: benchmark.org_median_rate })],
          [t("cour.hours"), String(totals.hours), t("cour.manDays", { n: totals.man_days })],
          [t("cour.certificatesLabel"), String(totals.certificates), ""],
        ].map(([label, value, hint]) => (
          <div key={label} className="card py-3">
            <p className="text-xs uppercase tracking-wide text-text-subtle">{label}</p>
            <p className="mt-0.5 text-2xl font-semibold tnum">{value}</p>
            {hint && <p className="text-xs text-text-subtle">{hint}</p>}
          </div>
        ))}
      </div>

      {/* What those courses add up to. Coursera's report names courses only, so
          until now a professional certificate somebody spent six months on was
          nowhere on their record. */}
      {data.specializations.length > 0 && (
        <section className="card space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="font-semibold">🎖 {t("cour.specializations")}</h2>
            <p className="text-xs text-text-subtle">{t("cour.specDerived")}</p>
          </div>
          <ul className="divide-y divide-edge">
            {data.specializations.map((s) => (
              <li key={s.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:text-accent"
                >
                  {s.name}
                </a>
                {s.partner && <span className="text-xs text-text-subtle">{s.partner}</span>}
                {s.declared.length > 0 && (
                  <span
                    className="badge bg-warn/15 text-warn"
                    title={s.declared.join(", ")}
                  >
                    {t("cour.specDeclared", { n: s.declared.length }, "{n} declared")}
                  </span>
                )}
                <span
                  className={`ml-auto text-sm tnum ${s.complete ? "text-good" : "text-text-muted"}`}
                >
                  {s.complete
                    ? `✅ ${s.earned_on ? t("cour.specEarned", { date: s.earned_on }) : t("cour.specComplete")}`
                    : t("cour.specProgress", { done: s.done, n: s.courses })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.findings.length > 0 && (
        <section className="card space-y-1">
          <h2 className="font-semibold">{t("cour.points")}</h2>
          <ul className="space-y-0.5 text-sm text-text-muted">
            {data.findings.map((f) => (
              <li key={f}>• {f}</li>
            ))}
          </ul>
        </section>
      )}

      {data.by_program.length > 1 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">{t("cour.byProgram")}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-subtle">
                <th className="py-1.5 pr-3 font-medium">{t("cour.label")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("cour.enrollments")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("cour.completed")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("cour.completion")}</th>
                <th className="py-1.5 text-right font-medium">{t("cour.hours")}</th>
              </tr>
            </thead>
            <tbody>
              {data.by_program.map((p) => (
                <tr key={p.label} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-3">{p.label}</td>
                  <td className="py-1.5 pr-3 text-right tnum">{p.enrollments}</td>
                  <td className="py-1.5 pr-3 text-right tnum">{p.completed}</td>
                  <td className="py-1.5 pr-3 text-right tnum">{p.rate}%</td>
                  <td className="py-1.5 text-right tnum">{p.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card space-y-2">
        <h2 className="font-semibold">{t("cour.content")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-subtle">
                <th className="py-1.5 pr-3 font-medium">{t("cour.course")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("cour.label")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("cour.progress")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("cour.grade")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("cour.hours")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("cour.completedOn")}</th>
                <th className="py-1.5 text-right font-medium">{t("cour.certificate")}</th>
              </tr>
            </thead>
            <tbody>
              {pageOf(data.items, page).map((item) => (
                <tr key={item.title} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-3">{item.title}</td>
                  <td className="py-1.5 pr-3 text-xs text-text-subtle">{item.program}</td>
                  <td className="py-1.5 pr-3 text-right tnum">{item.progress}%</td>
                  <td className="py-1.5 pr-3 text-right tnum">
                    {item.grade === null ? "—" : `${item.grade}%`}
                  </td>
                  <td className="py-1.5 pr-3 text-right tnum">{item.hours}</td>
                  <td className="py-1.5 pr-3 text-right tnum text-text-subtle">
                    {item.completed_on || "—"}
                  </td>
                  <td className="py-1.5 text-right">{item.certificate ? "🏅" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={data.items.length} onPage={setPage} />
      </section>
    </div>
  );
}
