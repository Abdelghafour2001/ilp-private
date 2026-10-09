"use client";

/**
 * Language switch (FR / EN).
 *
 * The choice is stored locally so it applies immediately and survives reloads.
 * For a signed-in learner it is also persisted on their profile, because the
 * backend uses it to pick the language of the emails and in-app notifications
 * it generates for them — an interface in English that mails you in French is
 * worse than either one alone.
 */

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import { LOCALES, useI18n, type Locale } from "@/lib/i18n";

export default function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(next: Locale) {
    setLocale(next);
    setOpen(false);
    const me = getStoredLearner();
    // Best-effort: a failure here only means the next email keeps the old
    // language, so it must never interrupt the switch the user just made.
    if (me?.id) api.setLocale(me.id, next).catch(() => {});
  }

  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  return (
    <div className="relative" ref={boxRef}>
      <button
        className="btn-icon"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("shell.language")}
        title={t("shell.language")}
      >
        <span className="text-sm">{current.flag}</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-30 mt-2 w-40 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          {LOCALES.map((l) => (
            <button
              key={l.code}
              role="option"
              aria-selected={l.code === locale}
              onClick={() => choose(l.code)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface-2 ${
                l.code === locale ? "text-accent-text" : "text-text-muted"
              }`}
            >
              <span>{l.flag}</span>
              <span className="flex-1">{l.label}</span>
              {l.code === locale && <span>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
