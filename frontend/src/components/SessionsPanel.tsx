"use client";

/**
 * Scheduling, registration and attendance for live sessions.
 *
 * Used in two places with the same code:
 * - on a training's manage page (`formationId` set) — its own sessions;
 * - on the schedule page (`formationId` omitted) — standalone open sessions
 *   anyone in the company may register for.
 *
 * Attendance is deliberately three-state: présent, absent, or not marked yet.
 * Defaulting an un-taken register to "absent" would quietly invent absences
 * and make the HR attendance rate lie.
 */

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Learner,
  type SessionRosterEntry,
  type UpcomingEvent,
} from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";

interface Props {
  me: Learner | null;
  /** Omit for standalone open sessions. */
  formationId?: number;
  /** Called after a create/delete/attendance change, so the host can refresh. */
  onChanged?: () => void;
}

const BLANK = {
  title: "",
  description: "",
  date: "",
  time: "09:00",
  duration_min: 60,
  location: "",
  meeting_url: "",
  capacity: 0,
  deadline: "",
  theme: "",
  trainer_handle: "",
};

/** `datetime-local` values are local wall-clock; the API stores UTC. */
function toIso(date: string, time: string): string | null {
  if (!date) return null;
  return new Date(`${date}T${time || "00:00"}`).toISOString();
}

export default function SessionsPanel({ me, formationId, onChanged }: Props) {
  const t = useT();
  const fmt = useFormat();
  const [sessions, setSessions] = useState<UpcomingEvent[]>([]);
  const [draft, setDraft] = useState({ ...BLANK });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [roster, setRoster] = useState<SessionRosterEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canOrganise =
    !!me && ["trainer", "skill_lead", "manager", "hr", "admin"].includes(me.role ?? "");

  const refresh = useCallback(() => {
    api
      .listTrainingSessions({ learnerId: me?.id, includePast: true, days: 365 })
      .then((all) =>
        setSessions(
          all.filter((s) => (formationId ? s.formation_id === formationId : s.open_to_all)),
        ),
      )
      .catch((e) => setError(String(e)));
  }, [me?.id, formationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function create() {
    const startsAt = toIso(draft.date, draft.time);
    if (!startsAt || draft.title.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      await api.createTrainingSession({
        title: draft.title.trim(),
        description: draft.description.trim(),
        starts_at: startsAt,
        duration_min: Number(draft.duration_min) || 60,
        location: draft.location.trim(),
        meeting_url: draft.meeting_url.trim(),
        formation_id: formationId ?? null,
        open_to_all: !formationId,
        capacity: Math.max(0, Number(draft.capacity) || 0),
        registration_deadline: draft.deadline ? new Date(draft.deadline).toISOString() : null,
        theme: draft.theme.trim(),
        trainer_handle: draft.trainer_handle.trim(),
        learner_id: me?.id,
      });
      setDraft({ ...BLANK });
      setCreating(false);
      refresh();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openRoster(session: UpcomingEvent) {
    if (openId === session.id) {
      setOpenId(null);
      return;
    }
    setOpenId(session.id);
    setRoster([]);
    try {
      setRoster(await api.sessionRoster(session.id, me?.id));
    } catch (e) {
      setError(String(e));
    }
  }

  function setLocalAttendance(learnerId: number, attended: boolean | null) {
    setRoster((cur) =>
      cur.map((r) => (r.learner_id === learnerId ? { ...r, attended } : r)),
    );
  }

  async function saveAttendance(sessionId: number) {
    setBusy(true);
    setNotice(null);
    try {
      const marks = roster
        .filter((r) => r.status !== "cancelled")
        .map((r) => ({ learner_id: r.learner_id, attended: r.attended }));
      const res = await api.markSessionAttendance(sessionId, marks, me?.id);
      setNotice(t("sessions.attendanceSaved", { count: res.updated }));
      refresh();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(sessionId: number) {
    setBusy(true);
    try {
      await api.deleteTrainingSession(sessionId, me?.id);
      if (openId === sessionId) setOpenId(null);
      refresh();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
          📅 {formationId ? t("sessions.panel.formation") : t("sessions.panel.open")}
        </p>
        {canOrganise && (
          <button className="btn-soft btn-sm" onClick={() => setCreating((v) => !v)}>
            {creating ? t("common.close") : `+ ${t("sessions.new")}`}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}
      {notice && <p className="text-sm text-good">{notice}</p>}

      {creating && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input"
              placeholder={t("sessions.field.title")}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <input
              className="input"
              placeholder={t("sessions.field.theme")}
              value={draft.theme}
              onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
            />
            <label className="text-xs text-text-subtle">
              {t("sessions.field.when")}
              <div className="mt-1 flex gap-2">
                <input
                  type="date"
                  className="input"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
                <input
                  type="time"
                  className="input w-28"
                  value={draft.time}
                  onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                />
              </div>
            </label>
            <label className="text-xs text-text-subtle">
              {t("sessions.field.duration")}
              <input
                type="number"
                min={5}
                className="input mt-1"
                value={draft.duration_min}
                onChange={(e) => setDraft({ ...draft, duration_min: Number(e.target.value) })}
              />
            </label>
            <input
              className="input"
              placeholder={t("sessions.field.location")}
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            />
            <input
              className="input"
              placeholder={t("sessions.field.meetingUrl")}
              value={draft.meeting_url}
              onChange={(e) => setDraft({ ...draft, meeting_url: e.target.value })}
            />
            <label className="text-xs text-text-subtle">
              {t("sessions.field.capacity")}
              <input
                type="number"
                min={0}
                className="input mt-1"
                value={draft.capacity}
                onChange={(e) => setDraft({ ...draft, capacity: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs text-text-subtle">
              {t("sessions.field.deadline")}
              <input
                type="datetime-local"
                className="input mt-1"
                value={draft.deadline}
                onChange={(e) => setDraft({ ...draft, deadline: e.target.value })}
              />
            </label>
            <input
              className="input"
              placeholder={t("sessions.field.trainer")}
              value={draft.trainer_handle}
              onChange={(e) => setDraft({ ...draft, trainer_handle: e.target.value })}
            />
          </div>
          <textarea
            className="input h-16 text-sm"
            placeholder={t("sessions.field.description")}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <button
            className="btn"
            disabled={busy || draft.title.trim().length < 2 || !draft.date}
            onClick={create}
          >
            {t("sessions.submit")}
          </button>
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="text-sm text-text-subtle">{t("sessions.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => {
            const past = new Date(s.starts_at) < new Date();
            // The API is the real gate (trainer / creator / HR / admin); the
            // UI only hides controls that would obviously be refused.
            const canManage = canOrganise;
            return (
              <li key={s.id} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {s.title}
                      {s.open_to_all && (
                        <span className="badge bg-accent/15 text-accent-text">{t("schedule.openToAll")}</span>
                      )}
                      {s.theme && <span className="badge bg-edge text-text-subtle">{s.theme}</span>}
                      {past && <span className="badge bg-edge text-text-subtle">{t("sessions.past")}</span>}
                    </p>
                    <p className="text-xs text-text-subtle">
                      {fmt.dateTime(s.starts_at)} · {s.duration_min} min
                      {s.location && ` · 📍 ${s.location}`}
                      {s.trainer_name && ` · ${s.trainer_name}`}
                    </p>
                    <p className="text-xs text-text-subtle">
                      {t("sessions.summary", {
                        registered: s.registered_count,
                        capacity: s.capacity > 0 ? ` / ${s.capacity}` : "",
                        waitlist:
                          s.waitlist_count > 0
                            ? ` · ${t("schedule.waitlisted")}: ${s.waitlist_count}`
                            : "",
                      })}
                      {!s.registration_open && ` · ${t("schedule.registrationsClosed")}`}
                    </p>
                  </div>
                  <a className="btn-ghost btn-sm" href={api.sessionIcsUrl(s.id)}>
                    📅
                  </a>
                  {canManage && (
                    <>
                      <button className="btn-ghost btn-sm" onClick={() => openRoster(s)}>
                        {openId === s.id
                          ? t("common.close")
                          : past
                            ? t("sessions.attendance")
                            : t("sessions.registrations")}
                      </button>
                      <button
                        className="btn-ghost btn-sm text-bad"
                        disabled={busy}
                        onClick={() => remove(s.id)}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>

                {openId === s.id && (
                  <div className="border-t border-border px-3 py-2">
                    {roster.length === 0 ? (
                      <p className="text-xs text-text-subtle">{t("sessions.noRegistrations")}</p>
                    ) : (
                      <>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs uppercase tracking-wide text-text-subtle">
                              <th className="py-1.5">{t("sessions.col.participant")}</th>
                              <th className="py-1.5">{t("sessions.col.status")}</th>
                              <th className="py-1.5 text-right">{t("sessions.col.attendance")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {roster.map((r) => (
                              <tr key={r.learner_id} className="border-t border-edge">
                                <td className="py-1.5">
                                  {r.name || r.handle}
                                  <span className="ml-1 text-xs text-text-subtle">{r.handle}</span>
                                </td>
                                <td className="py-1.5">
                                  <span
                                    className={`badge ${
                                      r.status === "registered"
                                        ? "bg-good/15 text-good"
                                        : r.status === "waitlisted"
                                          ? "bg-warn/15 text-warn"
                                          : "bg-edge text-text-subtle"
                                    }`}
                                  >
                                    {r.status === "registered"
                                      ? t("schedule.registered")
                                      : r.status === "waitlisted"
                                        ? t("schedule.waitlisted")
                                        : t("sessions.cancelled")}
                                  </span>
                                </td>
                                <td className="py-1.5 text-right">
                                  {r.status === "cancelled" ? (
                                    <span className="text-xs text-text-subtle">—</span>
                                  ) : (
                                    <div className="inline-flex gap-1">
                                      {([
                                        [true, "sessions.present"],
                                        [false, "sessions.absent"],
                                        [null, "sessions.notMarked"],
                                      ] as const).map(([value, labelKey]) => (
                                        <button
                                          key={String(value)}
                                          onClick={() => setLocalAttendance(r.learner_id, value)}
                                          className={`rounded-md border px-2 py-0.5 text-xs transition ${
                                            r.attended === value
                                              ? "border-accent bg-accent/15 text-accent-text"
                                              : "border-border text-text-subtle hover:text-text"
                                          }`}
                                        >
                                          {t(labelKey)}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <button
                          className="btn-soft btn-sm mt-2"
                          disabled={busy}
                          onClick={() => saveAttendance(s.id)}
                        >
                          {t("sessions.saveAttendance")}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
