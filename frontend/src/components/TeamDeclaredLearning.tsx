"use client";

/**
 * What the team learned outside the platform, for the people who can vouch
 * for it.
 *
 * A manager is notified when somebody logs a course or claims one taken on
 * Coursera; this is where that notification lands (`/team?team=…#declared`).
 * Records count as soon as they are saved — verifying is the manager saying
 * "I have seen the proof", not a gate.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type TeamLearningRecord } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import Icon from "@/components/Icon";
import { Segmented } from "@/components/form/Field";

export default function TeamDeclaredLearning({ teamId, viewerId }: { teamId: number; viewerId: number }) {
  const t = useT();
  const fmt = useFormat();
  const [rows, setRows] = useState<TeamLearningRecord[] | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .teamLearning(teamId, viewerId)
      .then((r) => {
        setRows(r);
        setAllowed(true);
        // Nothing waiting: open on everything rather than on an empty list.
        if (!r.some((x) => !x.verified)) setFilter("all");
      })
      .catch(() => setAllowed(false));
  }, [teamId, viewerId]);

  useEffect(load, [load]);

  // The notification links to #declared, but the section only exists once
  // the records arrive, so the browser's own jump has already missed it.
  useEffect(() => {
    if (rows && window.location.hash === "#declared") {
      document.getElementById("declared")?.scrollIntoView({ block: "start" });
    }
  }, [rows]);

  async function verify(r: TeamLearningRecord) {
    setBusyId(r.id);
    setError(null);
    try {
      const res = await api.verifyLearning(r.id, viewerId);
      setRows((xs) =>
        (xs ?? []).map((x) =>
          x.id === r.id ? { ...x, verified: true, verified_by_name: res.by } : x,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!allowed) return null;

  const pending = (rows ?? []).filter((r) => !r.verified);
  const shown = filter === "pending" ? pending : rows ?? [];

  return (
    <section id="declared" className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t("tl.title")}</h2>
          <p className="mt-0.5 text-xs text-text-subtle">{t("tl.lede")}</p>
        </div>
        {rows && rows.length > 0 && (
          <Segmented
            label={t("tl.filter")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "pending" as const, label: `${t("tl.toVerify")} · ${pending.length}` },
              { value: "all" as const, label: t("tl.all") },
            ]}
          />
        )}
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {rows === null ? (
        <div className="h-32 skeleton rounded-xl" aria-busy="true" />
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center">
          <Icon name={filter === "pending" ? "check" : "book"} size={20} className="mx-auto text-text-subtle" />
          <p className="mt-2 text-sm text-text-muted">{filter === "pending" ? t("tl.nonePending") : t("tl.empty")}</p>
        </div>
      ) : (
        <ul className="panel divide-y divide-border overflow-hidden">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:flex-nowrap">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-muted" aria-hidden="true">
                <Icon name={r.provider === "Coursera" || r.kind === "course" ? "courses" : "book"} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {r.learner_email ? (
                    <Link href={`/people/${encodeURIComponent(r.learner_email)}`} className="font-medium hover:text-accent-text">
                      {r.learner_name}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.learner_name}</span>
                  )}
                  <span className="text-text-subtle"> · </span>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className="hover:text-accent-text hover:underline">
                      {r.title}
                    </a>
                  ) : (
                    r.title
                  )}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-text-subtle">
                  <span>{t(`learning.kind.${r.kind}`, r.kind)}</span>
                  {r.provider && <span>· {r.provider}</span>}
                  {r.minutes > 0 && (
                    <span className="tnum">· {r.minutes < 60 ? `${r.minutes}\u00a0min` : `${r.hours}\u00a0h`}</span>
                  )}
                  {r.completed_on && (
                    <span className="tnum">· {fmt.date(r.completed_on, { day: "numeric", month: "short", year: "numeric" })}</span>
                  )}
                </p>
              </div>
              {r.verified ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-good">
                  <Icon name="check" size={13} /> {t("learning.verifiedBy", { name: r.verified_by_name })}
                </span>
              ) : (
                <button
                  type="button"
                  className="btn-soft btn-sm shrink-0"
                  disabled={busyId === r.id}
                  aria-busy={busyId === r.id}
                  aria-label={t("tl.verifyWhat", { title: r.title, who: r.learner_name })}
                  onClick={() => verify(r)}
                >
                  <Icon name="check" size={13} /> {t("tl.verify")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
