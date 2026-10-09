"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Learner, type UpcomingEvent } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useFormat, useT } from "@/lib/i18n";
import SessionsPanel from "@/components/SessionsPanel";
import { LEVEL_BADGE } from "@/lib/formationLessons";

const STATUS_BADGE: Record<string, { key: string; cls: string }> = {
  trainer: { key: "schedule.status.trainer", cls: "bg-accent/15 text-accent" },
  active: { key: "schedule.status.active", cls: "bg-good/15 text-good" },
  completed: { key: "schedule.status.completed", cls: "bg-good/15 text-good" },
  invited: { key: "schedule.status.invited", cls: "bg-warn/15 text-warn" },
};

const REGISTRATION_BADGE: Record<string, { key: string; cls: string }> = {
  registered: { key: "schedule.registered", cls: "bg-good/15 text-good" },
  waitlisted: { key: "schedule.waitlisted", cls: "bg-warn/15 text-warn" },
};

function dayKey(iso: string) {
  return new Date(iso).toDateString();
}

export default function SchedulePage() {
  const [me, setMe] = useState<Learner | null>(null);
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const t = useT();
  const fmt = useFormat();

  /** "Today" / "Tomorrow", else the full weekday — in the chosen language. */
  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (d.toDateString() === today.toDateString()) return t("common.today");
    if (d.toDateString() === tomorrow.toDateString()) return t("common.tomorrow");
    return fmt.date(iso, { weekday: "long", day: "numeric", month: "long" });
  };

  /** What the seat counter should say, given capacity and the waitlist. */
  const seatsLabel = (e: UpcomingEvent) => {
    if (e.seats_left === null) return t("schedule.enrolledCount", { count: e.registered_count });
    if (e.seats_left > 0) {
      return t("schedule.seatsLeft", { count: e.seats_left, capacity: e.capacity });
    }
    return e.waitlist_count > 0
      ? t("schedule.fullWithWaitlist", { count: e.waitlist_count })
      : t("schedule.full");
  };

  const canOrganise =
    !!me && ["trainer", "skill_lead", "manager", "hr", "admin"].includes(me.role ?? "");

  const refresh = useCallback(() => {
    const learner = getStoredLearner();
    setMe(learner);
    api
      .listTrainingSessions({ learnerId: learner?.id })
      .then(setEvents)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggleRegistration(e: UpcomingEvent) {
    if (!me) {
      setError(t("common.signInFirst"));
      return;
    }
    setBusyId(e.id);
    setError(null);
    try {
      if (e.my_registration === "registered" || e.my_registration === "waitlisted") {
        await api.cancelSessionRegistration(e.id, me.id);
      } else {
        await api.registerForSession(e.id, me.id);
      }
      refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  }

  if (error && !events) return <div className="card border-bad/40 text-sm text-bad">{error}</div>;
  if (!events) return <p className="text-sm text-text-subtle">{t("common.loading")}</p>;

  const shown = events.filter(
    (e) => (!onlyMine || e.my_status || e.my_registration) && (!onlyOpen || e.open_to_all),
  );
  const byDay = new Map<string, UpcomingEvent[]>();
  for (const e of shown) {
    const k = dayKey(e.starts_at);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("schedule.title")}</h1>
          <p className="mt-1 text-sm text-text-muted">{t("schedule.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={onlyOpen}
              onChange={(e) => setOnlyOpen(e.target.checked)}
            />
            {t("schedule.onlyOpen")}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => setOnlyMine(e.target.checked)}
            />
            {t("schedule.onlyMine")}
          </label>
        </div>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      {/* Organisers get the scheduling + attendance controls for open sessions
          right here, since that is where they already look at the calendar. */}
      {canOrganise && <SessionsPanel me={me} onChanged={refresh} />}

      {shown.length === 0 && (
        <div className="card text-center text-sm text-text-subtle">
          {onlyMine ? t("schedule.emptyMine") : t("schedule.empty")}
        </div>
      )}

      {[...byDay.entries()].map(([k, dayEvents]) => (
        <div key={k} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
            {fmtDay(dayEvents[0].starts_at)}
          </p>
          <div className="space-y-2">
            {dayEvents.map((e) => {
              const badge = e.my_status ? STATUS_BADGE[e.my_status] : null;
              const regBadge = e.my_registration ? REGISTRATION_BADGE[e.my_registration] : null;
              const signedUp = e.my_registration === "registered" || e.my_registration === "waitlisted";
              const full = e.seats_left === 0;
              return (
                <div key={e.id} className="card flex flex-wrap items-center gap-4">
                  <div className="w-20 shrink-0 text-center">
                    <p className="text-lg font-semibold">{fmt.time(e.starts_at)}</p>
                    <p className="text-xs text-text-subtle">{e.duration_min} min</p>
                  </div>
                  <span className="text-3xl">{e.formation_emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{e.title}</p>
                      {e.formation_level && (
                        <span className={`badge ${LEVEL_BADGE[e.formation_level] ?? "bg-edge"}`}>
                          {e.formation_level}
                        </span>
                      )}
                      {e.open_to_all && (
                        <span className="badge bg-accent/15 text-accent-text">{t("schedule.openToAll")}</span>
                      )}
                      {e.theme && <span className="badge bg-edge text-text-subtle">{e.theme}</span>}
                      {badge && <span className={`badge ${badge.cls}`}>{t(badge.key)}</span>}
                      {regBadge && <span className={`badge ${regBadge.cls}`}>{t(regBadge.key)}</span>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-text-subtle">
                      {e.formation_id ? (
                        <Link
                          href={`/formations/${e.formation_id}`}
                          className="hover:text-text hover:underline"
                        >
                          {e.formation_title}
                        </Link>
                      ) : (
                        <span>{t("schedule.openSession")}</span>
                      )}
                      {e.trainer_name && ` · ${t("common.by")} ${e.trainer_name}`}
                      {e.location && ` · 📍 ${e.location}`}
                    </p>
                    {e.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-text-muted">{e.description}</p>
                    )}
                    {e.open_to_all && (
                      <p className="mt-1 text-xs text-text-subtle">
                        <span className={full ? "text-warn" : undefined}>{seatsLabel(e)}</span>
                        {e.registration_deadline && (
                          <span>
                            {" · "}
                            {t(
                              e.registration_open
                                ? "schedule.deadlineOpen"
                                : "schedule.deadlineClosed",
                              {
                                date: fmt.date(e.registration_deadline, {
                                  day: "numeric",
                                  month: "short",
                                }),
                              },
                            )}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* One-way calendar export — imports into Outlook, Google
                        or Apple Calendar. Not a mailbox sync. */}
                    <a
                      className="btn-ghost btn-sm"
                      href={api.sessionIcsUrl(e.id)}
                      title={t("schedule.addToCalendarHint")}
                    >
                      📅 {t("schedule.addToCalendar")}
                    </a>
                    {e.open_to_all && (
                      <button
                        className={signedUp ? "btn-ghost btn-sm" : "btn-soft btn-sm"}
                        disabled={busyId === e.id || (!signedUp && !e.registration_open)}
                        onClick={() => toggleRegistration(e)}
                        title={
                          !signedUp && !e.registration_open
                            ? t("schedule.registrationsClosedHint")
                            : full && !signedUp
                              ? t("schedule.fullHint")
                              : undefined
                        }
                      >
                        {signedUp
                          ? t("schedule.unregister")
                          : !e.registration_open
                            ? t("schedule.registrationsClosed")
                            : full
                              ? t("schedule.joinWaitlist")
                              : t("schedule.register")}
                      </button>
                    )}
                    {e.meeting_url && (
                      <a href={e.meeting_url} target="_blank" rel="noreferrer" className="btn-soft btn-sm">
                        {t("schedule.join")} ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
