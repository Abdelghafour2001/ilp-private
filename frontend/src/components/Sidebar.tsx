"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { navFor } from "@/lib/nav";
import { useFeatures } from "@/lib/features";
import { getStoredLearner } from "@/lib/learner";
import { useT } from "@/lib/i18n";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function Sidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  // Read on mount rather than at module scope: the sidebar renders on the
  // server too, where there is no localStorage, and a role read during SSR
  // would hydrate as a different menu than the one the server sent.
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    setRole(getStoredLearner()?.role ?? null);
  }, [pathname]);
  // The switchboard decides which modules exist here; the role decides which
  // of those this person may open. Both narrow the same list.
  const features = useFeatures();
  const groups = navFor(role, features);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("aida.sidebar.collapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("aida.sidebar.collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <>
      {/* mobile scrim */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-surface/95 backdrop-blur transition-all duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0",
          collapsed ? "md:w-[68px]" : "md:w-64",
          "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        {/* brand — Teal logo (green on light, white on dark) */}
        <div className="flex h-16 items-center gap-2.5 px-4">
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden" onClick={onClose}>
            {collapsed ? (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-sheen text-base font-bold text-white shadow-glow">
                A
              </span>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/teal-logo-green.png" alt="Teal" className="h-12 w-auto shrink-0 dark:hidden" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/teal-logo-white.png" alt="Teal" className="hidden h-12 w-auto shrink-0 dark:block" />
                <span className="flex flex-col border-l border-border pl-2.5 leading-none">
                  <span className="text-[15px] font-semibold tracking-tight text-text">UpSkill</span>
                  {/* "Academy" was the AI & Data framing. The platform serves
                      every unit now, so the wordmark says what it is. */}
                  <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-text-subtle">
                    {t("shell.wordmark", "Learning")}
                  </span>
                </span>
              </>
            )}
          </Link>
        </div>

        {/* nav */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
          {groups.map((group) => (
            <div key={group.titleKey}>
              {!collapsed && (
                <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-subtle">
                  {t(group.titleKey, group.title)}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        title={collapsed ? t(item.labelKey, item.label) : undefined}
                        className={[
                          "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-accent/10 text-accent-text"
                            : "text-text-muted hover:bg-surface-2 hover:text-text",
                          collapsed ? "justify-center" : "",
                        ].join(" ")}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent" />
                        )}
                        <Icon
                          name={item.icon}
                          size={18}
                          className={active ? "text-accent-text" : "text-text-subtle group-hover:text-text"}
                        />
                        {!collapsed && <span className="truncate">{t(item.labelKey, item.label)}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* collapse toggle (desktop only) */}
        <div className="hidden border-t border-border p-3 md:block">
          <button
            onClick={toggleCollapsed}
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium text-text-subtle transition-colors hover:bg-surface-2 hover:text-text"
            title={collapsed ? t("shell.expand") : t("shell.collapse")}
          >
            <Icon
              name="chevron-right"
              size={18}
              className={collapsed ? "" : "rotate-180 transition-transform"}
            />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
