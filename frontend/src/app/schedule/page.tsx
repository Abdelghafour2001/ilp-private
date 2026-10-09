"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type Learner, type UpcomingEvent } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useFormat, useT } from "@/lib/i18n";
import SessionsPanel from "@/components/SessionsPanel";
import Icon from "@/components/Icon";
import { Segmented } from "@/components/form/Field";

const LEVEL_DOT: Record<string, string> = { beginner: "bg-good", intermediate: "bg-warn", advanced: "bg-bad" };

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

  /** "Today" / "Tomorrow", else the weekday — in the chosen language. */
  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (d.toDateString() === today.toDateString()) return t("common.today");
    if (d.toDateString() === tomorrow.toDateString()) return t("common.tomorrow");
    return fmt.date(iso, { weekday: "long" });
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

  if (error && !events)
    return (
      <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
        {error}
      </p>
    );
  if (!events)
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-9 w-48 skeleton" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 skeleton rounded-xl" />
        ))}
      </div>
    );

  const shown = events.filter(
    (e) => (!onlyMine || e.my_status || e.my_registration) && (!onlyOpen || e.open_to_all),
  );
  const byDay = new Map<string, UpcomingEvent[]>();
  for (const e of shown) {
    const k = dayKey(e.starts_at);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const todayKey = new Date().toDateString();
  const filter: "all" | "mine" | "open" = onlyMine ? "mine" : onlyOpen ? "open" : "all";

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">{t("schedule.title")}</h1>
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-text-muted">{t("schedule.subtitle")}</p>
        </div>
        {/* One choice, not two checkboxes that could both be ticked into an
            empty list nobody could explain. */}
        <Segmented
          label={t("sched.filter")}
          value={filter}
          onChange={(v) => {
            setOnlyMine(v === "mine");
            setOnlyOpen(v === "open");
          }}
          options={[
            { value: "all" as const, label: t("sched.all") },
            { value: "mine" as const, label: t("schedule.onlyMine") },
            { value: "open" as const, label: t("schedule.onlyOpen") },
          ]}
        />
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {/* Organisers get the scheduling + attendance controls for open sessions
          right here, since that is where they already look at the calendar. */}
      {canOrganise && <SessionsPanel me={me} onChanged={refresh} />}

      {shown.length === 0 && (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <Icon name="calendar" size={22} className="mx-auto text-text-subtle" />
          <p className="mt-3 text-sm text-text-muted">{onlyMine ? t("schedule.emptyMine") : t("schedule.empty")}</p>
        </div>
      )}

      <div className="space-y-8">
        {[...byDay.entries()].map(([k, dayEvents]) => {
          const d = new Date(dayEvents[0].starts_at);
          const isToday = k === todayKey;
          return (
            <section key={k} className="grid gap-x-6 gap-y-3 md:grid-cols-[7.5rem_minmax(0,1fr)]">
              {/* The date block stays in view while that day's sessions scroll. */}
              <div className="md:sticky md:top-24 md:self-start">
                <div className="flex items-baseline gap-2 md:block">
                  <p className={`text-3xl font-semibold leading-none tracking-tight tnum ${isToday ? "text-accent-text" : ""}`}>
                    {d.getDate()}
                  </p>
                  <p className="text-sm font-medium capitalize text-text-muted md:mt-1">
                    {fmt.date(d, { month: "long" })}
                  </p>
                  <p className={`text-xs capitalize md:mt-0.5 ${isToday ? "font-semibold text-accent-text" : "text-text-subtle"}`}>
                    {fmtDay(dayEvents[0].starts_at)}
                  </p>
                </div>
              </div>

              <ul className="panel divide-y divide-border overflow-hidden">
                {dayEvents.map((e) => {
                  const badge = e.my_status ? STATUS_BADGE[e.my_status] : null;
                  const regBadge = e.my_registration ? REGISTRATION_BADGE[e.my_registration] : null;
                  const signedUp = e.my_registration === "registered" || e.my_registration === "waitlisted";
                  const full = e.seats_left === 0;
                  const ends = new Date(new Date(e.starts_at).getTime() + e.duration_min * 60000);
                  return (
                    <li key={e.id} className="flex flex-wrap items-start gap-x-5 gap-y-3 p-5 sm:flex-nowrap">
                      <div className="w-24 shrink-0">
                        <p className="text-lg font-semibold leading-tight tnum">{fmt.time(e.starts_at)}</p>
                        <p className="text-xs text-text-subtle tnum">
                          {fmt.time(ends)} · {e.duration_min}&nbsp;min
                        </p>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg" aria-hidden="true">{e.formation_emoji}</span>
                          <p className="font-semibold">{e.title}</p>
                          {e.open_to_all && <span className="badge badge-accent">{t("schedule.openToAll")}</span>}
                          {badge && <span className={`badge ${badge.cls}`}>{t(badge.key)}</span>}
                          {regBadge && <span className={`badge ${regBadge.cls}`}>{t(regBadge.key)}</span>}
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-subtle">
                          {e.formation_id ? (
                            <Link href={`/formations/${e.formation_id}`} className="inline-flex items-center gap-1 hover:text-text hover:underline">
                              <Icon name="formations" size={12} /> {e.formation_title}
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Icon name="sessions" size={12} /> {t("schedule.openSession")}
                            </span>
                          )}
                          {e.formation_level && (
                            <span className="inline-flex items-center gap-1 capitalize">
                              <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[e.formation_level] ?? "bg-text-subtle"}`} />
                              {t(`common.${e.formation_level}`, e.formation_level)}
                            </span>
                          )}
                          {e.trainer_name && (
                            <span className="inline-flex items-center gap-1">
                              <Icon name="team" size={12} /> {e.trainer_name}
                            </span>
                          )}
                          {e.location && (
                            <span className="inline-flex items-center gap-1">
                              <Icon name="pin" size={12} /> {e.location}
                            </span>
                          )}
                          {e.theme && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] text-text-muted">{e.theme}</span>}
                        </p>
                        {e.description && <p className="mt-2 line-clamp-2 text-sm text-text-muted">{e.description}</p>}
                        {e.open_to_all && (
                          <p className="mt-2 text-xs text-text-subtle">
                            <span className={full ? "font-medium text-warn" : undefined}>{seatsLabel(e)}</span>
                            {e.registration_deadline && (
                              <span>
                                {" · "}
                                {t(e.registration_open ? "schedule.deadlineOpen" : "schedule.deadlineClosed", {
                                  date: fmt.date(e.registration_deadline, { day: "numeric", month: "short" }),
                                })}
                              </span>
                            )}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {/* One-way calendar export — imports into Outlook, Google
                            or Apple Calendar. Not a mailbox sync. */}
                        <a
                          className="btn-icon h-8 w-8"
                          href={api.sessionIcsUrl(e.id)}
                          aria-label={`${t("schedule.addToCalendar")} — ${e.title}`}
                          title={t("schedule.addToCalendarHint")}
                        >
                          <Icon name="calendar" size={15} />
                        </a>
                        {e.open_to_all && (
                          <button
                            type="button"
                            className={signedUp ? "btn-ghost btn-sm" : "btn btn-sm"}
                            disabled={busyId === e.id || (!signedUp && !e.registration_open)}
                            aria-busy={busyId === e.id}
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
                            {t("schedule.join")} <Icon name="external" size={12} />
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
