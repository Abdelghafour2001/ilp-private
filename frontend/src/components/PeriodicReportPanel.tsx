"use client";

/**
 * Periodic reports — the ready-made ones, as opposed to the builder above.
 *
 * Two kinds of reporting live on this page and they answer different
 * questions. The builder answers "let me look into something"; this answers
 * "give me the monthly report", which is the one people actually ask for and
 * the one that was buried at the bottom of the Coursera panel where nobody
 * found it.
 *
 * Pick a range, read the written analysis on screen, or take the branded PDF.
 * A single collaborator's card is the same report scoped to one person, for
 * the manager who has to act on it.
 */

import { useState } from "react";
import MarkdownLite from "@/components/MarkdownLite";
import { api, openPdf } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useI18n } from "@/lib/i18n";

type Period = "month" | "quarter" | "year";

/** The named periods are shortcuts that fill the two dates, not a separate
 *  mode: whatever they set is what the pickers show and what gets sent, so
 *  there is never a question of which one the report actually used. */
function shortcut(period: Period): { start: string; end: string } {
  const now = new Date();
  const iso = (d: Date) =>
    // Local, not toISOString(): that converts to UTC and a local midnight
    // lands on the previous day, so "this month" started on the 30th.
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (period === "year") return { start: iso(new Date(now.getFullYear(), 0, 1)), end: iso(new Date(now.getFullYear(), 11, 31)) };
  if (period === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    return { start: iso(new Date(now.getFullYear(), q * 3, 1)), end: iso(new Date(now.getFullYear(), q * 3 + 3, 0)) };
  }
  return {
    start: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

export default function PeriodicReportPanel() {
  const { t, locale } = useI18n();
  const [range, setRange] = useState(shortcut("month"));
  const [email, setEmail] = useState("");
  const [report, setReport] = useState<{ markdown: string; generated_by: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The PDF goes through the browser: a blob URL would lose the filename. */
  function params(extra: Record<string, string> = {}) {
    const me = getStoredLearner()?.id;
    const qs = new URLSearchParams({ locale, ...extra });
    if (range.start && range.end) {
      qs.set("start", range.start);
      qs.set("end", range.end);
    }
    if (me) qs.set("learner_id", String(me));
    return qs;
  }

  function downloadOrg() {
    void openPdf(`/analytics/coursera/report.pdf?${params()}`);
  }

  function downloadPerson() {
    const who = email.trim();
    if (!who) return;
    void openPdf(`/analytics/coursera/person.pdf?${params({ email: who })}`);
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.courseraReport(locale, getStoredLearner()?.id));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    /* Folded shut: one PDF a month is an occasional errand beside the builder
       above it, and open it took half the screen. */
    <details className="card space-y-4">
      <summary className="cursor-pointer">
        <h2 className="inline font-semibold">📄 {t("reports.periodic")}</h2>
        <p className="text-sm text-text-muted">{t("reports.periodicHint")}</p>
      </summary>

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
        <button className="btn-ghost" onClick={downloadOrg}>
          ⬇ {t("cour.downloadPdf")}
        </button>
        <button className="btn" onClick={generate} disabled={busy}>
          {busy ? t("cour.writing") : t("cour.generate")}
        </button>
      </div>

      {/* The common answers, one click each. They fill the dates above rather
          than switching to a different mode. */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-text-subtle">{t("reports.quick")}</span>
        {(["month", "quarter", "year"] as const).map((p) => (
          <button
            key={p}
            className="rounded-full border border-border px-2.5 py-0.5 text-text-subtle transition hover:border-accent hover:text-text"
            onClick={() => setRange(shortcut(p))}
          >
            {t(`cour.period${p[0].toUpperCase()}${p.slice(1)}`)}
          </button>
        ))}
        {/* Empty dates are not a missing answer: they are the whole record,
            which is what somebody asking for "the report" usually means. */}
        <button
          className="rounded-full border border-border px-2.5 py-0.5 text-text-subtle transition hover:border-accent hover:text-text"
          onClick={() => setRange({ start: "", end: "" })}
        >
          {t("reports.fullHistory")}
        </button>
      </div>

      {/* One person's card — the named detail the committee report leaves out,
          addressed to the manager who can do something about it. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-3">
        <span className="text-sm text-text-muted">{t("reports.personCard")}</span>
        <input
          className="input max-w-xs"
          placeholder="prenom.nom@teal.ma"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn-ghost btn-sm" onClick={downloadPerson} disabled={!email.trim()}>
          ⬇ {t("cour.cardHint")}
        </button>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      {report && (
        <div className="space-y-2 border-t border-edge pt-3">
          <p className="text-xs text-text-subtle">
            {report.generated_by === "computed"
              ? t("cour.computedNote")
              : t("cour.modelNote", { model: report.generated_by })}
          </p>
          <MarkdownLite>{report.markdown}</MarkdownLite>
        </div>
      )}
    </details>
  );
}
