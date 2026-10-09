"use client";

import Icon from "@/components/Icon";
import NotificationsBell from "@/components/NotificationsBell";
import ThemeToggle from "@/components/ThemeToggle";
import ProfileChip from "@/components/ProfileChip";
import LanguageToggle from "@/components/LanguageToggle";
import { useT } from "@/lib/i18n";

export default function Topbar({ onMenu }: { onMenu: () => void }) {
  const t = useT();

  function openCommand() {
    window.dispatchEvent(new CustomEvent("aida-open-command"));
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-md md:px-6">
      <button className="btn-icon md:hidden" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" size={18} />
      </button>

      {/* command palette trigger — doubles as global search */}
      <button
        onClick={openCommand}
        className="group flex h-9 max-w-md flex-1 items-center gap-2.5 rounded-lg border border-border bg-surface px-3 text-sm text-text-subtle shadow-xs transition-colors hover:border-border-strong hover:bg-surface-2 md:flex-initial md:w-72"
      >
        <Icon name="search" size={16} />
        <span className="flex-1 text-left">{t("shell.search")}</span>
        <span className="hidden items-center gap-1 sm:flex">
          <span className="kbd">⌘</span>
          <span className="kbd">K</span>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <NotificationsBell />
        <LanguageToggle />
        <ThemeToggle />
        <div className="h-6 w-px bg-border" />
        <ProfileChip />
      </div>
    </header>
  );
}
