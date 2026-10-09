"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon, { type IconName } from "@/components/Icon";
import { NAV_ITEMS } from "@/lib/nav";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { useT } from "@/lib/i18n";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  group: string;
  run: () => void;
  keywords?: string;
}

/** What each kind of hit is called in the results list. */
const KIND_GROUP: Record<string, string> = {
  course: "Courses",
  formation: "Trainings",
  pathway: "Pathways",
  lab: "Labs",
  session: "Sessions",
  challenge: "Challenges",
  asset: "Assets",
  certification: "Certifications",
  skill: "Skills",
};

export default function CommandPalette() {
  const t = useT();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // global open shortcut + custom event (so the topbar button can open it)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("aida-open-command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("aida-open-command", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const [hits, setHits] = useState<Command[]>([]);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = NAV_ITEMS.map((n) => ({
      id: `nav:${n.href}`,
      label: t(n.labelKey, n.label),
      hint: t(n.descKey, n.desc),
      icon: n.icon,
      group: "Go to",
      run: () => router.push(n.href),
    }));
    const actions: Command[] = [
      {
        id: "act:new-course",
        label: "Create a course",
        icon: "plus",
        group: "Create",
        run: () => router.push("/courses/new"),
        keywords: "new course author publish",
      },
      {
        id: "act:new-challenge",
        label: "Post a challenge",
        icon: "plus",
        group: "Create",
        run: () => router.push("/challenges/new"),
        keywords: "new challenge brief innovation",
      },
      {
        id: "act:new-asset",
        label: "Share an asset",
        icon: "plus",
        group: "Create",
        run: () => router.push("/assets/new"),
        keywords: "new asset notebook model dataset",
      },
      {
        id: "act:new-session",
        label: "Add a sharing session",
        icon: "plus",
        group: "Create",
        run: () => router.push("/sessions/new"),
        keywords: "new session talk deck presentation",
      },
      {
        id: "act:theme",
        label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        icon: theme === "dark" ? "sun" : "moon",
        group: "Preferences",
        run: toggle,
        keywords: "theme dark light mode appearance",
      },
    ];
    return [...nav, ...actions];
  }, [router, theme, toggle]);

  // Content, from the server. The palette used to search the menu only, so
  // typing a subject found the page about pages and nothing to learn from.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .search(q, 6)
        .then((r) =>
          setHits(
            r.groups.flatMap((g) =>
              g.items.slice(0, 4).map((i) => ({
                id: `find:${i.kind}:${i.id}`,
                label: i.title,
                hint: i.detail,
                icon: "search" as const,
                group: KIND_GROUP[i.kind] ?? "Results",
                run: () => router.push(i.link),
              })),
            ),
          ),
        )
        .catch(() => setHits([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [query, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const local = commands.filter((c) =>
      `${c.label} ${c.hint ?? ""} ${c.keywords ?? ""} ${c.group}`.toLowerCase().includes(q),
    );
    // Navigation first: somebody typing two letters usually wants a page, and
    // content results arrive a moment later.
    return [...local, ...hits];
  }, [commands, query, hits]);

  useEffect(() => setActive(0), [query]);

  function exec(c: Command) {
    setOpen(false);
    c.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && filtered[active]) {
      e.preventDefault();
      exec(filtered[active]);
    }
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  // group the filtered list preserving order
  const groups: { name: string; items: { c: Command; idx: number }[] }[] = [];
  filtered.forEach((c, idx) => {
    let g = groups.find((x) => x.name === c.group);
    if (!g) {
      g = { name: c.group, items: [] };
      groups.push(g);
    }
    g.items.push({ c, idx });
  });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/45 p-4 pt-[12vh] backdrop-blur-sm animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Icon name="search" size={18} className="text-text-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages, actions…"
            className="h-14 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-text-subtle"
          />
          <span className="kbd">esc</span>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-text-subtle">
              No results for “{query}”
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.name} className="mb-1">
                <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-subtle">
                  {g.name}
                </p>
                {g.items.map(({ c, idx }) => (
                  <button
                    key={c.id}
                    data-idx={idx}
                    onMouseMove={() => setActive(idx)}
                    onClick={() => exec(c)}
                    className={[
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      idx === active ? "bg-accent/10 text-text" : "text-text-muted",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "grid h-8 w-8 shrink-0 place-items-center rounded-lg border",
                        idx === active
                          ? "border-accent/30 bg-accent/15 text-accent-text"
                          : "border-border bg-surface-2 text-text-subtle",
                      ].join(" ")}
                    >
                      <Icon name={c.icon} size={16} />
                    </span>
                    <span className="flex flex-col">
                      <span className="font-medium text-text">{c.label}</span>
                      {c.hint && <span className="text-xs text-text-subtle">{c.hint}</span>}
                    </span>
                    {idx === active && (
                      <Icon name="arrow-right" size={15} className="ml-auto text-text-subtle" />
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-surface-2 px-4 py-2 text-[11px] text-text-subtle">
          <span className="flex items-center gap-1.5">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span>
            to navigate
          </span>
          <span className="flex items-center gap-1.5">
            <span className="kbd">↵</span>
            to select
          </span>
        </div>
      </div>
    </div>
  );
}
