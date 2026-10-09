"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { api, type AppNotification } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";

const KIND_ICON: Record<string, string> = {
  invite: "✉️",
  enrollment: "🎓",
  session: "📅",
  team: "👥",
  cert_suggested: "📌",
  cert_earned: "🏅",
  info: "🔔",
};

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export default function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [hasLearner, setHasLearner] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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

  // close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function markAllRead() {
    const me = getStoredLearner();
    if (!me) return;
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

  return (
    <div className="relative" ref={boxRef}>
      <button
        className="btn-icon relative"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 w-80 overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button className="text-xs text-accent hover:underline" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-text-subtle">
                Nothing yet — invites, sessions and team news land here.
              </p>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={`flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left transition hover:bg-surface-2 ${
                  n.read ? "opacity-60" : ""
                }`}
              >
                <span className="mt-0.5 text-lg">{KIND_ICON[n.kind] ?? "🔔"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  {n.body && (
                    <span className="block truncate text-xs text-text-subtle">{n.body}</span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-text-subtle">{ago(n.created_at)}</span>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
