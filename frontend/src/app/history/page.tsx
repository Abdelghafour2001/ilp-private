"use client";

/**
 * My learning — one person's whole record, from every source at once.
 *
 * Until now it was scattered: trainings in enrolments, courses in lesson
 * completions, labs in step completions, Coursera in its own table, declared
 * learning in another. Each screen showed a slice, so nobody — including the
 * learner — could answer "what have I done, and what is still open".
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type HistoryItem, type HistoryResponse } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useI18n } from "@/lib/i18n";
import Pager, { pageOf } from "@/components/Pager";

const STATUS_TONE: Record<string, string> = {
  completed: "bg-good/15 text-good",
  in_progress: "bg-warn/15 text-warn",
  not_started: "bg-edge text-text-subtle",
};

const KIND_EMOJI: Record<string, string> = {
  training: "🎓",
  course: "📘",
  lab: "🧪",
  external: "🌐",
  declared: "✍️",
};

export default function HistoryPage() {
  const { t } = useI18n();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | "completed" | "in_progress" | "not_started">("all");
  const [kind, setKind] = useState<string>("all");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const me = getStoredLearner();
    if (!me) {
      setError(t("history.signIn"));
      return;
    }
    api
      .myHistory(me.id)
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, [t]);

  const items = useMemo(() => {
    if (!data) return [];
    return data.items.filter(
      (i: HistoryItem) =>
        (status === "all" || i.status === status) && (kind === "all" || i.kind === kind),
    );
  }, [data, status, kind]);

  if (error) return <p className="card text-sm text-bad">{error}</p>;
  if (!data) return <p className="text-sm text-text-subtle">{t("common.loading")}</p>;

  const k = data.totals;
  // Mandatory, unfinished, with a deadline — soonest first, so the top of the
  // list is whatever is closest to being late.
  const today = new Date().toISOString().slice(0, 10);
  const isLate = (item: { due_date: string | null }) => !!item.due_date && item.due_date < today;
  const due = data.items
    .filter((i) => i.mandatory && i.status !== "completed" && i.due_date)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  const kinds = [...new Set(data.items.map((i) => i.kind))];

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("history.title")}</h1>
        <p className="text-sm text-text-muted">{t("history.lede")}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t("history.completed"), String(k.completed), t("history.ofItems", { n: k.items })],
          [t("history.inProgress"), String(k.in_progress), t("history.notStarted", { n: k.not_started })],
          [t("cour.hours"), String(k.hours), t("history.recorded")],
          [t("certs.title"), String(k.certificates), ""],
        ].map(([label, value, hint]) => (
          <div key={label} className="card py-3">
            <p className="text-xs uppercase tracking-wide text-text-subtle">{label}</p>
            <p className="mt-0.5 text-2xl font-semibold tnum">{value}</p>
            {hint && <p className="text-xs text-text-subtle">{hint}</p>}
          </div>
        ))}
      </div>

      {/* What is actually expected of this person: named, in deadline order,
          at the top. The line here used to read "3 mandatory items open" and
          leave them to find which three in a list of everything they have ever
          touched — which is much the same as not telling them. */}
      {due.length > 0 && (
        <section className="card space-y-2 border-warn/40">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="font-semibold">⚠️ {t("history.dueTitle", "Expected of you")}</h2>
            <p className="text-sm text-text-muted">
              {t("history.mandatoryOpen", { n: k.mandatory_open })}
              {k.overdue > 0 && ` · ${t("track.overdue", { n: k.overdue })}`}
            </p>
          </div>
          <ul className="divide-y divide-edge">
            {due.map((item) => {
              const late = isLate(item);
              return (
                <li
                  key={`${item.kind}-${item.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <span aria-hidden>{KIND_EMOJI[item.kind] ?? "•"}</span>
                  {item.link ? (
                    <Link href={item.link} className="font-medium hover:text-accent">
                      {item.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{item.title}</span>
                  )}
                  {item.percent > 0 && (
                    <span className="text-xs text-text-subtle">{item.percent}%</span>
                  )}
                  {item.assigned_by && (
                    <span className="text-xs text-text-subtle">· {item.assigned_by}</span>
                  )}
                  <span className={`ml-auto text-sm tnum ${late ? "text-bad" : "text-warn"}`}>
                    {late
                      ? t("history.lateBy", { date: item.due_date ?? "" }, "Overdue since {date}")
                      : `${t("track.due")} ${item.due_date}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {(["all", "completed", "in_progress", "not_started"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => { setPage(0); setStatus(value); }}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              status === value
                ? "border-accent bg-accent/15 font-medium text-accent-text"
                : "border-border text-text-subtle hover:text-text"
            }`}
          >
            {value === "all" ? t("cour.statusAll") : t(`track.${value}Label`)}
          </button>
        ))}
        <span className="mx-1 text-text-subtle">·</span>
        {["all", ...kinds].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => { setPage(0); setKind(value); }}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              kind === value
                ? "border-accent bg-accent/15 font-medium text-accent-text"
                : "border-border text-text-subtle hover:text-text"
            }`}
          >
            {value === "all" ? t("history.allKinds") : `${KIND_EMOJI[value] ?? ""} ${t(`history.kind.${value}`)}`}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {pageOf(items, page).map((item) => {
          const body = (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span>{KIND_EMOJI[item.kind] ?? "•"}</span>
                <span className="min-w-0 flex-1 font-medium">{item.title}</span>
                {item.mandatory && (
                  <span className="badge bg-warn/15 text-warn">{t("assign.mandatory")}</span>
                )}
                {item.certificate && <span title={t("cour.certificate")}>🏅</span>}
                <span className={`badge ${STATUS_TONE[item.status]}`}>
                  {t(`track.${item.status}Label`)}
                </span>
              </div>

              {item.status !== "not_started" && item.percent > 0 && (
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${item.status === "completed" ? "bg-good" : "bg-accent"}`}
                    style={{ width: `${Math.max(2, item.percent)}%` }}
                  />
                </div>
              )}

              {/* The one thing a learner can do about a provider course they
                  have never signed up for. 0% hid this: it read as "you have
                  not got round to it", when the truth is nothing exists yet. */}
              {item.provider_enrolled === false && (
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="badge bg-warn/15 text-warn">
                    {t("history.notEnrolled", "Not enrolled on Coursera yet")}
                  </span>
                  {item.provider_url && (
                    <a
                      href={item.provider_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t("history.enrolNow", "Enrol on Coursera →")}
                    </a>
                  )}
                </p>
              )}

              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-subtle">
                <span>{t(`history.kind.${item.kind}`)}</span>
                {item.detail && <span>{item.detail}</span>}
                {item.percent > 0 && <span className="tnum">{item.percent}%</span>}
                {item.grade !== null && (
                  <span className="tnum">{t("cour.grade")}: {item.grade}%</span>
                )}
                {item.hours > 0 && <span className="tnum">{item.hours} h</span>}
                {item.completed_on && <span>{t("cour.completedOn")} {item.completed_on}</span>}
                {item.due_date && item.status !== "completed" && (
                  <span className="text-warn">{t("track.due")} {item.due_date}</span>
                )}
              </p>
            </>
          );

          const className = "card space-y-1.5 py-3";
          return item.link ? (
            <Link
              key={`${item.kind}-${item.id}-${item.title}`}
              href={item.link}
              className={`${className} block transition hover:border-accent`}
            >
              {body}
            </Link>
          ) : (
            <div key={`${item.kind}-${item.id}-${item.title}`} className={className}>
              {body}
            </div>
          );
        })}
        {items.length === 0 && (
          <p className="card text-center text-sm text-text-subtle">{t("filter.noMatch")}</p>
        )}
        <Pager page={page} total={items.length} onPage={setPage} />
      </div>
    </div>
  );
}
