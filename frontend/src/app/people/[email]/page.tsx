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
import { useFormat, useI18n } from "@/lib/i18n";
import Icon from "@/components/Icon";
import StatStrip from "@/components/StatStrip";

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
  const fmt = useFormat();
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
  if (!data)
    return error ? (
      <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</p>
    ) : (
      <div className="space-y-6" aria-busy="true">
        <div className="h-16 w-80 skeleton rounded-xl" />
        <div className="h-14 skeleton rounded-xl" />
        <div className="h-48 skeleton rounded-xl" />
      </div>
    );

  const { person, totals, benchmark } = data;
  // Somebody with no provider account has no Coursera half: four zero tiles
  // and an empty course table only make the record look broken.
  const hasCoursera = person.linked || totals.enrollments > 0;
  const fmtDay = (d: string) => fmt.date(d, { day: "numeric", month: "short", year: "numeric" });
  const initials = person.name
    .split(/[\s.\-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div className="space-y-8">
      <div>
        <Link href="/org" className="inline-flex items-center gap-1 text-sm text-text-subtle hover:text-text">
          <Icon name="chevron-right" size={14} className="rotate-180" /> {t("nav.org")}
        </Link>
        <header className="mt-3 flex flex-wrap items-center gap-5">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-accent/10 text-xl font-semibold text-accent-text" aria-hidden="true">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-semibold tracking-[-0.03em]">{person.name}</h1>
            <p className="mt-1 text-sm text-text-muted">
              {[person.job_title, person.unit, person.location].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-text-subtle">
              <span className="inline-flex items-center gap-1">
                <Icon name="mail" size={12} /> {person.email}
              </span>
              {person.manager && (
                <span className="inline-flex items-center gap-1">
                  <Icon name="team" size={12} /> {t("cour.manager")}: {person.manager}
                </span>
              )}
            </p>
          </div>
          <button type="button" className="btn-ghost" onClick={downloadCard}>
            <Icon name="file" size={15} /> {t("person.cardPdf")}
          </button>
        </header>
      </div>

      {/* The period the whole record reads over. Empty means everything. */}
      <fieldset className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <legend className="sr-only">{t("person.period")}</legend>
        <span className="mb-2 mr-1 text-sm font-medium">{t("person.period")}</span>
        <label className="text-xs text-text-subtle">
          {t("reports.from")}
          <input
            type="date"
            className="input mt-1 block w-[10.5rem] py-1.5"
            value={range.start}
            max={range.end || undefined}
            onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
          />
        </label>
        <label className="text-xs text-text-subtle">
          {t("reports.to")}
          <input
            type="date"
            className="input mt-1 block w-[10.5rem] py-1.5"
            value={range.end}
            min={range.start || undefined}
            onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
          />
        </label>
        {range.start || range.end ? (
          <button type="button" className="btn-ghost btn-sm mb-0.5" onClick={() => setRange({ start: "", end: "" })}>
            <Icon name="x" size={13} /> {t("reports.fullHistory")}
          </button>
        ) : (
          <span className="mb-2 text-xs text-text-subtle">{t("person.wholeRecord")}</span>
        )}
      </fieldset>

      {!person.linked && totals.enrollments > 0 && (
        <section className="space-y-3 rounded-xl border border-warn/30 bg-warn/5 p-4">
          <p className="text-sm text-text-muted">{t("cour.notLinked")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input max-w-xs"
              aria-label={t("cour.linkPlaceholder")}
              placeholder={t("cour.linkPlaceholder")}
              value={linkTo}
              onChange={(e) => setLinkTo(e.target.value)}
            />
            <button type="button" className="btn btn-sm" onClick={link} disabled={busy || !linkTo.trim()}>
              {busy ? t("cour.linking") : t("cour.link")}
            </button>
          </div>
          {linkMsg && <p className="text-sm text-good" aria-live="polite">{linkMsg}</p>}
        </section>
      )}

      {/* What they did here. A linked profile should answer both halves of
          the question without sending the reader to another screen. */}
      {data.aida && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("org.view.app")}</h2>

          {/* Standing before counters: level, streak and badges say what this
              person is, where the tiles below say what they did. */}
          <div className="panel space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <span className="font-semibold">
                {t("common.level")} {data.aida.level}
                <span className="font-normal text-text-muted"> · {data.aida.level_title}</span>
              </span>
              <span className="text-text-muted tnum">{t("person.xpToNext", { n: data.aida.xp_to_next })}</span>
              <span className="inline-flex items-center gap-1 text-text-muted sm:ml-auto">
                {data.aida.current_streak > 0 ? (
                  <>
                    <Icon name="flame" size={14} className="text-warn" /> {data.aida.current_streak} {t("profile.dayStreak")}
                  </>
                ) : (
                  t("person.noStreak")
                )}
                {data.aida.longest_streak > 0 && ` · ${data.aida.longest_streak} ${t("profile.bestStreak")}`}
              </span>
              {data.aida.last_active_on && (
                <span className="text-text-subtle">
                  {t("org.col.lastActive")}: {fmtDay(data.aida.last_active_on)}
                </span>
              )}
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-valuenow={data.aida.level_pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${t("common.level")} ${data.aida.level}`}
            >
              <div className="h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${data.aida.level_pct / 100})` }} />
            </div>
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-xs text-text-subtle tnum">
                {t("profile.badges")} · {data.aida.badges.length}/{data.aida.badge_total}
              </p>
              {data.aida.badges.length === 0 ? (
                <p className="text-sm text-text-subtle">{t("person.noBadges")}</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {data.aida.badges.map((b) => (
                    <li
                      key={b.id}
                      title={b.description}
                      className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs"
                    >
                      <span aria-hidden>{b.emoji}</span>
                      {b.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <StatStrip
            title={t("org.view.app")}
            showTitle={false}
            stats={[
              { label: t("history.completed"), value: data.aida.completed, hint: t("history.ofItems", { n: data.aida.items }) },
              {
                label: t("history.inProgress"),
                value: data.aida.in_progress,
                hint: data.aida.mandatory_open > 0 ? t("history.mandatoryOpen", { n: data.aida.mandatory_open }) : undefined,
                tone: data.aida.mandatory_open > 0 ? "warn" : undefined,
              },
              { label: t("org.col.appHours"), value: data.aida.hours },
              {
                label: "XP",
                value: fmt.number(data.aida.xp),
                hint: data.aida.coursera_xp > 0 ? t("org.xpFromCoursera", { n: data.aida.coursera_xp }) : undefined,
              },
              { label: t("certs.title"), value: data.aida.certificates },
            ]}
          />
        </section>
      )}

      {data.findings.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="sparkles" size={15} className="text-accent-text" /> {t("cour.points")}
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-text-muted">
            {data.findings.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-subtle" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!hasCoursera && (
        <p className="flex items-center gap-2 text-sm text-text-subtle">
          <Icon name="courses" size={15} /> {t("cour.noProviderAccount")}
        </p>
      )}

      {hasCoursera && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">Coursera</h2>
            {person.linked && (
              <span className="inline-flex items-center gap-1 text-xs text-good">
                <Icon name="check" size={12} /> {t("cour.isLinked")}
              </span>
            )}
          </div>
          <StatStrip
            title="Coursera"
            showTitle={false}
            stats={[
              {
                label: t("cour.enrollments"),
                value: totals.enrollments,
                hint: t("cour.enrollmentSplit", { done: totals.completed, doing: totals.in_progress, idle: totals.never_opened }),
              },
              { label: t("cour.completion"), value: `${totals.completion_rate}%`, hint: t("cour.vsOrg", { n: benchmark.org_median_rate }) },
              { label: t("cour.hours"), value: totals.hours, hint: t("cour.manDays", { n: totals.man_days }) },
              { label: t("cour.certificatesLabel"), value: totals.certificates },
            ]}
          />

          {/* What those courses add up to. Coursera's report names courses only, so
              until now a professional certificate somebody spent six months on was
              nowhere on their record. */}
          {data.specializations.length > 0 && (
            <div className="panel p-5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="font-semibold">{t("cour.specializations")}</h3>
                <p className="text-xs text-text-subtle">{t("cour.specDerived")}</p>
              </div>
              <ul className="mt-2 divide-y divide-border">
                {data.specializations.map((s) => (
                  <li key={s.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <a href={s.url} target="_blank" rel="noreferrer" className="font-medium hover:text-accent-text">
                      {s.name}
                    </a>
                    {s.partner && <span className="text-xs text-text-subtle">{s.partner}</span>}
                    {s.declared.length > 0 && (
                      <span className="badge bg-warn/15 text-warn" title={s.declared.join(", ")}>
                        {t("cour.specDeclared", { n: s.declared.length }, "{n} declared")}
                      </span>
                    )}
                    <span className={`ml-auto inline-flex items-center gap-1 text-sm tnum ${s.complete ? "text-good" : "text-text-muted"}`}>
                      {s.complete && <Icon name="check" size={13} />}
                      {s.complete
                        ? s.earned_on
                          ? t("cour.specEarned", { date: fmtDay(s.earned_on) })
                          : t("cour.specComplete")
                        : t("cour.specProgress", { done: s.done, n: s.courses })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.by_program.length > 1 && (
            <div className="panel overflow-x-auto p-5">
              <h3 className="font-semibold">{t("cour.byProgram")}</h3>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-subtle">
                    <th scope="col" className="py-2 pr-3 font-medium">{t("cour.label")}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t("cour.enrollments")}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t("cour.completed")}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t("cour.completion")}</th>
                    <th scope="col" className="py-2 text-right font-medium">{t("cour.hours")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.by_program.map((p) => (
                    <tr key={p.label}>
                      <td className="py-2 pr-3">{p.label}</td>
                      <td className="py-2 pr-3 text-right tnum">{p.enrollments}</td>
                      <td className="py-2 pr-3 text-right tnum">{p.completed}</td>
                      <td className="py-2 pr-3 text-right tnum">{p.rate}%</td>
                      <td className="py-2 text-right tnum">{p.hours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="panel overflow-hidden">
            <h3 className="px-5 pt-5 font-semibold">{t("cour.content")}</h3>
            {data.items.length === 0 ? (
              <p className="px-5 pb-6 pt-2 text-sm text-text-subtle">{t("person.noCourses")}</p>
            ) : (
              <>
                <div className="overflow-x-auto px-5">
                  <table className="mt-2 w-full min-w-[40rem] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-text-subtle">
                        <th scope="col" className="py-2 pr-3 font-medium">{t("cour.course")}</th>
                        <th scope="col" className="py-2 pr-3 font-medium">{t("cour.label")}</th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">{t("cour.progress")}</th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">{t("cour.grade")}</th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">{t("cour.hours")}</th>
                        <th scope="col" className="py-2 pr-3 text-right font-medium">{t("cour.completedOn")}</th>
                        <th scope="col" className="py-2 text-right font-medium">{t("cour.certificate")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pageOf(data.items, page).map((item) => (
                        <tr key={item.title}>
                          <td className="py-2 pr-3 font-medium">{item.title}</td>
                          <td className="py-2 pr-3 text-xs text-text-subtle">{item.program}</td>
                          <td className="py-2 pr-3 text-right tnum">{item.progress}%</td>
                          <td className="py-2 pr-3 text-right tnum">{item.grade === null ? "—" : `${item.grade}%`}</td>
                          <td className="py-2 pr-3 text-right tnum">{item.hours}</td>
                          <td className="py-2 pr-3 text-right tnum text-text-subtle">
                            {item.completed_on ? fmtDay(item.completed_on) : "—"}
                          </td>
                          <td className="py-2 text-right">
                            {item.certificate ? (
                              <span className="inline-flex text-good">
                                <Icon name="award" size={15} />
                                <span className="sr-only">{t("cour.certificate")}</span>
                              </span>
                            ) : (
                              <span className="text-text-subtle">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-5 pb-3">
                  <Pager page={page} total={data.items.length} onPage={setPage} />
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
