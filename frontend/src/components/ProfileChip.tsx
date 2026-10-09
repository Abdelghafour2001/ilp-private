"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Learner } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { signOutEverywhere } from "@/lib/auth";
import Icon from "@/components/Icon";

function initials(handle: string) {
  const parts = handle.replace(/[._-]+/g, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || handle.slice(0, 2).toUpperCase();
}

export default function ProfileChip() {
  const router = useRouter();
  const [learner, setLearner] = useState<Learner | null>(null);
  const [xp, setXp] = useState(0);
  const [badges, setBadges] = useState(0);
  const [level, setLevel] = useState(1);
  const [levelTitle, setLevelTitle] = useState("Novice");
  const [streak, setStreak] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const stored = getStoredLearner();
    setLearner(stored);
    if (stored) {
      try {
        const p = await api.learnerProfile(stored.id);
        setXp(p.xp);
        setBadges(p.badges.length);
        setLevel(p.level);
        setLevelTitle(p.level_title);
        setStreak(p.current_streak);
      } catch {
        /* profile may not exist if the DB was reset */
      }
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("dqai-learner-changed", refresh);
    return () => window.removeEventListener("dqai-learner-changed", refresh);
  }, [refresh]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function signOut() {
    setMenuOpen(false);
    // Clears every key, the module caches and MSAL, then reloads. Clearing
    // only the learner left the bearer token in place: the screen said signed
    // out while the next request was still authenticated.
    await signOutEverywhere();
  }

  // --- signed out --- (the /login page is the single front door now)
  if (!learner) {
    return (
      <Link href="/login" className="btn btn-sm">
        Sign in
      </Link>
    );
  }

  // --- signed in ---
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-2.5 transition-colors hover:border-border-strong hover:bg-surface-2"
      >
        <span className="relative grid h-7 w-7 place-items-center rounded-full bg-accent-sheen text-xs font-semibold text-white">
          {initials(learner.handle)}
          <span className="absolute -bottom-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full border border-surface bg-surface px-0.5 font-mono text-[9px] font-bold text-accent-text">
            {level}
          </span>
        </span>
        {streak > 0 && (
          <span className="hidden items-center gap-0.5 text-xs font-medium text-warn sm:flex">
            <Icon name="flame" size={13} /> {streak}
          </span>
        )}
        <span className="hidden text-sm font-medium text-text sm:block">{learner.handle}</span>
        <Icon name="chevron-down" size={14} className="text-text-subtle" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-scale-in">
          <div className="flex items-center gap-3 border-b border-border p-3.5">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-sheen text-sm font-semibold text-white">
              {initials(learner.handle)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-text">{learner.handle}</p>
              <p className="text-xs text-accent-text">
                {levelTitle} · Lvl {level}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-px bg-border">
            <div className="bg-surface p-3 text-center">
              <p className="font-mono text-lg font-semibold tnum text-accent-text">{xp}</p>
              <p className="text-[11px] uppercase tracking-wide text-text-subtle">XP</p>
            </div>
            <div className="bg-surface p-3 text-center">
              <p className="font-mono text-lg font-semibold tnum text-warn">{streak}</p>
              <p className="text-[11px] uppercase tracking-wide text-text-subtle">Streak</p>
            </div>
            <div className="bg-surface p-3 text-center">
              <p className="font-mono text-lg font-semibold tnum text-iris">{badges}</p>
              <p className="text-[11px] uppercase tracking-wide text-text-subtle">Badges</p>
            </div>
          </div>
          <Link
            href="/profile"
            onClick={() => setMenuOpen(false)}
            className="flex w-full items-center gap-2.5 border-t border-border px-3.5 py-2.5 text-left text-sm font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <Icon name="trophy" size={16} /> View profile
          </Link>
          <Link
            href="/settings"
            onClick={() => setMenuOpen(false)}
            className="flex w-full items-center gap-2.5 border-t border-border px-3.5 py-2.5 text-left text-sm font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <Icon name="settings" size={16} /> Settings
          </Link>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2.5 border-t border-border px-3.5 py-2.5 text-left text-sm font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-bad"
          >
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
