"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon, { type IconName } from "@/components/Icon";
import { api, type AppNotification } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { useFormat, useT } from "@/lib/i18n";

// One glyph per kind, tinted so a glance at the list says what kind of news it is.
const KIND: Record<string, { icon: IconName; tone: string }> = {
  invite: { icon: "mail", tone: "bg-accent/10 text-accent-text" },
  enrollment: { icon: "formations", tone: "bg-accent/10 text-accent-text" },
  session: { icon: "calendar", tone: "bg-iris/10 text-iris" },
  team: { icon: "team", tone: "bg-surface-3 text-text-muted" },
  cert_suggested: { icon: "target", tone: "bg-warn/10 text-warn" },
  cert_earned: { icon: "award", tone: "bg-good/10 text-good" },
  info: { icon: "bell", tone: "bg-surface-3 text-text-muted" },
};

export default function NotificationsBell() {
  const t = useT();
  const fmt = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [hasLearner, setHasLearner] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    const me = getStoredLearner();
    setHasLearner(!!me);
    if (!me) {
      setUnread(0);
      setItems([]);
      return;
    }
    api
      .notifications(me.id)
      .then((r) => {
        setUnread(r.unread);
        setItems(r.items);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000); // light polling keeps the badge fresh
    window.addEventListener("dqai-learner-changed", load);
    return () => {
      clearInterval(interval);
      window.removeEventListener("dqai-learner-changed", load);
    };
  }, [load]);

  // Close on an outside click or Esc; Esc hands focus back to the bell.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markAllRead() {
    const me = getStoredLearner();
    if (!me) return;
    // Optimistic: the dots go at once, the server catches up.
    setItems((xs) => xs.map((n) => ({ ...n, read: true })));
    setUnread(0);
    await api.markNotificationsRead(me.id).catch(() => {});
    load();
  }

  function openItem(n: AppNotification) {
    const me = getStoredLearner();
    if (me && !n.read) api.markNotificationsRead(me.id, [n.id]).then(load).catch(() => {});
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  if (!hasLearner) return null;

  const shown = onlyUnread ? items.filter((n) => !n.read) : items;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const groups = [
    { key: "today", label: t("notif.today"), list: shown.filter((n) => new Date(n.created_at) >= startOfToday) },
    { key: "earlier", label: t("notif.earlier"), list: shown.filter((n) => new Date(n.created_at) < startOfToday) },
  ].filter((g) => g.list.length > 0);

  return (
    <div className="relative" ref={boxRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn-icon relative"
        aria-label={unread > 0 ? t("notif.labelUnread", { n: unread }) : t("notif.title")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-fg tnum ring-2 ring-surface">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("notif.title")}
          className="fixed inset-x-3 top-16 z-40 overflow-hidden rounded-xl border border-border bg-surface shadow-xl animate-fade-up sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-96"
        >
          <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3.5">
            <p className="text-sm font-semibold">
              {t("notif.title")}
              {unread > 0 && <span className="ml-1.5 text-text-subtle tnum">{unread}</span>}
            </p>
            {unread > 0 && (
              <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline" onClick={markAllRead}>
                <Icon name="check" size={12} /> {t("notif.markAll")}
              </button>
            )}
          </div>
          <div role="tablist" aria-label={t("notif.filter")} className="flex gap-4 border-b border-border px-4 text-xs font-medium">
            {[
              { v: false, label: t("notif.all") },
              { v: true, label: t("notif.unread") },
            ].map((tab) => (
              <button
                key={String(tab.v)}
                type="button"
                role="tab"
                aria-selected={onlyUnread === tab.v}
                onClick={() => setOnlyUnread(tab.v)}
                className={`-mb-px border-b-2 py-2 transition-colors ${
                  onlyUnread === tab.v ? "border-accent text-text" : "border-transparent text-text-subtle hover:text-text"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="max-h-[min(28rem,70vh)] overflow-y-auto overscroll-contain">
            {groups.length === 0 && (
              <div className="px-6 py-10 text-center">
                <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-text-subtle">
                  <Icon name={onlyUnread ? "check" : "bell"} size={18} />
                </span>
                <p className="mt-3 text-sm font-medium">{onlyUnread ? t("notif.caughtUp") : t("notif.emptyTitle")}</p>
                <p className="mt-1 text-xs text-text-subtle">{t("notif.emptyBody")}</p>
              </div>
            )}
            {groups.map((g) => (
              <section key={g.key}>
                <h3 className="px-4 pb-1 pt-3 text-[11px] font-medium text-text-subtle">{g.label}</h3>
                <ul>
                  {g.list.map((n) => {
                    const k = KIND[n.kind] ?? KIND.info;
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => openItem(n)}
                          className="group relative flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                        >
                          <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${k.tone}`} aria-hidden="true">
                            <Icon name={k.icon} size={15} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block text-sm leading-snug ${n.read ? "text-text-muted" : "font-medium text-text"}`}>
                              {n.title}
                            </span>
                            {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-text-subtle">{n.body}</span>}
                            <span className="mt-1 block text-[11px] text-text-subtle tnum">{fmt.ago(n.created_at)}</span>
                          </span>
                          {!n.read && (
                            <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent">
                              <span className="sr-only">{t("notif.unreadDot")}</span>
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
