"use client";

/**
 * The tracking board — both sides of every decision on one page.
 *
 * A manager gets a queue of what is waiting on them and a history of what they
 * already decided, declines included with the reason. A collaborator gets the
 * same records from their side: what they asked for, where it stands, and — the
 * part that is usually missing — why something was refused.
 *
 * Everyone sees "My requests"; only an overseer sees the queue above it. That
 * keeps one page instead of two and means a manager, who is also somebody's
 * report, finds both in the same place.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  type ApprovalInbox,
  type ApprovalItem,
  type ApprovalStatus,
  type CourseSummary,
  type FormationCard,
  type Learner,
  type MyApprovals,
} from "@/lib/api";
import ApprovalChain from "@/components/ApprovalChain";
import { getStoredLearner } from "@/lib/learner";
import { useFormat, useT } from "@/lib/i18n";

const KIND_META: Record<string, { icon: string; key: string; fallback: string }> = {
  training_request: { icon: "🎓", key: "appr.kind.training", fallback: "Training request" },
  asset: { icon: "📦", key: "appr.kind.asset", fallback: "Asset" },
  learning_record: { icon: "📝", key: "appr.kind.record", fallback: "Logged learning" },
  course: { icon: "📘", key: "appr.kind.course", fallback: "Course for review" },
};

const STATUS_META: Record<ApprovalStatus, { key: string; fallback: string; cls: string }> = {
  pending: { key: "appr.status.pending", fallback: "Pending", cls: "bg-warn/15 text-warn" },
  approved: { key: "appr.status.approved", fallback: "Approved", cls: "bg-good/15 text-good" },
  declined: { key: "appr.status.declined", fallback: "Declined", cls: "bg-bad/15 text-bad" },
};

function StatusBadge({ status }: { status: ApprovalStatus }) {
  const t = useT();
  const meta = STATUS_META[status];
  return <span className={`badge ${meta.cls}`}>{t(meta.key, meta.fallback)}</span>;
}

export default function ApprovalsPage() {
  const t = useT();
  const fmt = useFormat();
  const [me, setMe] = useState<Learner | null>(null);
  const [inbox, setInbox] = useState<ApprovalInbox | null>(null);
  const [mine, setMine] = useState<MyApprovals | null>(null);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ask form
  const [asking, setAsking] = useState(false);
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");
  const [trainings, setTrainings] = useState<FormationCard[]>([]);
  const [courses, setCourses] = useState<CourseSummary[]>([]);

  const refresh = useCallback(() => {
    const learner = getStoredLearner();
    setMe(learner);
    if (!learner) return;
    api.approvalInbox(learner.id).then(setInbox).catch(() => setInbox(null));
    api.myApprovals(learner.id).then(setMine).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!asking) return;
    api.listFormations(me?.id).then((f) => setTrainings(f.filter((x) => x.status === "published"))).catch(() => {});
    api.listCourses().then(setCourses).catch(() => {});
  }, [asking, me?.id]);

  async function decide(item: ApprovalItem, decision: "approved" | "declined") {
    if (!me) return;
    const key = `${item.kind}:${item.id}`;
    const note = (notes[key] ?? "").trim();
    if (decision === "declined" && !note) {
      setError(t("appr.needReason", "Give a reason when declining — the requester needs it."));
      return;
    }
    setBusy(key);
    setError(null);
    try {
      await api.decideApproval(item.kind, item.id, { learner_id: me.id, decision, note });
      setNotes((n) => ({ ...n, [key]: "" }));
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function ask() {
    if (!me || !pick) return;
    const [kind, idStr] = pick.split(":");
    setBusy("ask");
    setError(null);
    try {
      await api.requestTraining({
        learner_id: me.id,
        formation_id: kind === "formation" ? Number(idStr) : null,
        course_id: kind === "course" ? Number(idStr) : null,
        reason: reason.trim(),
      });
      setPick("");
      setReason("");
      setAsking(false);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(item: ApprovalItem) {
    if (!me || item.kind !== "training_request") return;
    await api.withdrawRequest(item.id, me.id).catch((e) => setError(String(e)));
    refresh();
  }

  if (!me) {
    return <div className="card text-sm text-text-subtle">{t("common.signInFirst")}</div>;
  }

  const canDecide = !!inbox?.can_decide;
  const shown = tab === "pending" ? inbox?.pending ?? [] : inbox?.history ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("appr.title", "Approvals")}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {canDecide
              ? t("appr.subtitleManager", "What is waiting on you, and everything you have already decided.")
              : t("appr.subtitleUser", "What you asked for, where it stands, and why anything was refused.")}
          </p>
        </div>
        <button className="btn" onClick={() => setAsking((v) => !v)}>
          {asking ? t("common.close") : `+ ${t("appr.ask", "Request a training")}`}
        </button>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      {asking && (
        <div className="card space-y-2">
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{t("appr.pick", "Which training or course?")}</option>
            <optgroup label={t("nav.formations")}>
              {trainings.map((f) => (
                <option key={`f${f.id}`} value={`formation:${f.id}`}>
                  {f.emoji} {f.title}
                </option>
              ))}
            </optgroup>
            <optgroup label={t("nav.courses")}>
              {courses.map((c) => (
                <option key={`c${c.id}`} value={`course:${c.id}`}>
                  {c.emoji} {c.title}
                </option>
              ))}
            </optgroup>
          </select>
          <textarea
            className="input h-20 text-sm"
            placeholder={t("appr.reasonPlaceholder", "Why do you need it? A concrete reason gets approved faster.")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button className="btn" disabled={!pick || busy === "ask"} onClick={ask}>
            {t("appr.send", "Send the request")}
          </button>
        </div>
      )}

      {/* ---------------- the queue (overseers only) ---------------- */}
      {canDecide && inbox && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ["pending", inbox.counts.pending, "bg-warn/10 border-warn/30"],
              ["approved", inbox.counts.approved, "bg-good/10 border-good/30"],
              ["declined", inbox.counts.declined, "bg-bad/10 border-bad/30"],
            ] as const).map(([key, value, cls]) => (
              <div key={key} className={`card border ${cls}`}>
                <p className="text-xs uppercase tracking-wide text-text-subtle">
                  {t(STATUS_META[key].key, STATUS_META[key].fallback)}
                </p>
                <p className="mt-1 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </div>

          <div className="flex w-fit items-center gap-1 rounded-lg border border-border p-0.5">
            {([
              ["pending", `⏳ ${t("appr.tab.pending", "To decide")}`, inbox.counts.pending],
              ["history", `🗂 ${t("appr.tab.history", "History")}`, inbox.counts.approved + inbox.counts.declined],
            ] as const).map(([k, label, count]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  tab === k ? "bg-accent/15 text-accent-text" : "text-text-subtle hover:text-text"
                }`}
              >
                {label} <span className="opacity-60">({count})</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="card text-sm text-text-subtle">
              {tab === "pending"
                ? t("appr.emptyPending", "Nothing waiting on you. ")
                : t("appr.emptyHistory", "No decisions yet.")}
            </div>
          ) : (
            <ul className="space-y-2">
              {shown.map((item) => {
                const key = `${item.kind}:${item.id}`;
                const meta = KIND_META[item.kind];
                return (
                  <li key={key} className="card space-y-2">
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="text-xl">{meta.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={item.link} className="font-medium hover:text-accent hover:underline">
                            {item.title}
                          </Link>
                          <span className="badge bg-edge text-text-subtle">
                            {t(meta.key, meta.fallback)}
                          </span>
                          <StatusBadge status={item.status} />
                        </div>
                        <p className="mt-0.5 text-xs text-text-subtle">
                          {item.requester.name} · {fmt.date(item.created_at, { day: "numeric", month: "short" })}
                        </p>
                        {item.detail && (
                          <p className="mt-1 text-sm text-text-muted">{item.detail}</p>
                        )}
                        <ApprovalChain steps={item.chain} />
                        {item.decision_note && (
                          <p className="mt-1.5 border-l-2 border-border pl-2.5 text-sm italic text-text-muted">
                            {item.decision_note}
                            <span className="ml-1 not-italic text-xs text-text-subtle">
                              — {item.decided_by}
                              {item.decided_at &&
                                `, ${fmt.date(item.decided_at, { day: "numeric", month: "short" })}`}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>

                    {item.status === "pending" && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                        <input
                          className="input min-w-[220px] flex-1 py-1.5 text-sm"
                          placeholder={t("appr.notePlaceholder", "Reason (required to decline)")}
                          value={notes[key] ?? ""}
                          onChange={(e) => setNotes((n) => ({ ...n, [key]: e.target.value }))}
                        />
                        <button
                          className="btn-soft btn-sm"
                          disabled={busy === key}
                          onClick={() => decide(item, "approved")}
                        >
                          ✓ {t("appr.approve", "Approve")}
                        </button>
                        <button
                          className="btn-ghost btn-sm text-bad"
                          disabled={busy === key}
                          onClick={() => decide(item, "declined")}
                        >
                          ✗ {t("appr.decline", "Decline")}
                        </button>
                      </div>
                    )}
                    {item.advisory && item.status === "pending" && (
                      <p className="text-[11px] text-text-subtle">
                        {t(
                          "appr.advisory",
                          "These hours already count. Verifying is a quality signal, not a gate.",
                        )}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ---------------- my own requests ---------------- */}
      {mine && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
              📋 {t("appr.mine", "My requests")}
            </h2>
            <p className="text-xs text-text-subtle">
              {mine.approver
                ? t("appr.approver", { name: mine.approver.name })
                : t("appr.noApprover", "No manager set on your team yet.")}
            </p>
          </div>

          {mine.items.length === 0 ? (
            <div className="card text-sm text-text-subtle">
              {t("appr.emptyMine", "Nothing yet — request a training above.")}
            </div>
          ) : (
            <ul className="space-y-2">
              {mine.items.map((item) => {
                const meta = KIND_META[item.kind];
                return (
                  <li
                    key={`${item.kind}:${item.id}`}
                    className="card flex flex-wrap items-start gap-3 py-3"
                  >
                    <span className="text-lg">{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.title}</span>
                        <StatusBadge status={item.status} />
                      </div>
                      {/* The reason is the whole point of showing a decline. */}
                      {item.decision_note ? (
                        <p className="mt-1 border-l-2 border-border pl-2.5 text-sm italic text-text-muted">
                          {item.decision_note}
                          <span className="ml-1 not-italic text-xs text-text-subtle">
                            — {item.decided_by}
                          </span>
                        </p>
                      ) : (
                        item.detail && (
                          <p className="mt-0.5 text-xs text-text-subtle">{item.detail}</p>
                        )
                      )}
                    </div>
                    {item.status === "pending" && item.kind === "training_request" && (
                      <button
                        className="text-xs text-text-subtle hover:text-bad"
                        onClick={() => withdraw(item)}
                      >
                        {t("appr.withdraw", "Withdraw")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
