"use client";

/**
 * Bilingual UI (français / English).
 *
 * Design notes:
 *
 * - `t(key, fallback?)` never throws and never renders a raw key. A missing
 *   translation falls back to the English string, then to the fallback the
 *   caller passed, then to the key itself. That means a page can be migrated
 *   to `t()` incrementally without ever showing `nav.dashboard` to a user.
 * - The choice lives in `localStorage` so it survives reloads, and is mirrored
 *   onto `<html lang>` for screen readers and browser translation prompts.
 * - Signed-in users also persist it on their profile, so the language of the
 *   emails and notifications the backend generates matches the UI they chose.
 *
 * Interpolation is `{name}`-style: t("team.assigned", { name: "Sara" }).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en } from "./en";
import { fr } from "./fr";

export type Locale = "fr" | "en";

const STORAGE_KEY = "aida.locale";
const DICTIONARIES: Record<Locale, Record<string, string>> = { fr, en };

export const LOCALES: { code: Locale; label: string; flag: string }[] = [
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "en", label: "English", flag: "🇬🇧" },
];

type Vars = Record<string, string | number>;

interface Ctx {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, varsOrFallback?: Vars | string, maybeFallback?: string) => string;
}

const LocaleContext = createContext<Ctx | null>(null);

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** Best guess from the browser, used only on a first-ever visit. */
function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "fr";
  return navigator.language?.toLowerCase().startsWith("en") ? "en" : "fr";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Start from the server-rendered default and correct it after mount, so the
  // markup React hydrates matches what the server produced.
  const [locale, setLocaleState] = useState<Locale>("fr");

  useEffect(() => {
    let initial: Locale | null = null;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "fr" || stored === "en") initial = stored;
    } catch {
      // Private mode or blocked storage — fall through to detection.
    }
    const next = initial ?? detectLocale();
    setLocaleState(next);
    document.documentElement.lang = next;
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.documentElement.lang = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not fatal: the choice just won't survive a reload.
    }
    window.dispatchEvent(new CustomEvent("aida-locale-changed", { detail: next }));
  }, []);

  const t = useCallback<Ctx["t"]>(
    (key, varsOrFallback, maybeFallback) => {
      const vars = typeof varsOrFallback === "object" ? varsOrFallback : undefined;
      const fallback =
        typeof varsOrFallback === "string" ? varsOrFallback : maybeFallback;
      const value = DICTIONARIES[locale][key] ?? en[key] ?? fallback ?? key;
      return interpolate(value, vars);
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(LocaleContext);
  if (ctx) return ctx;
  // A component rendered outside the provider still renders readable English
  // rather than crashing the page.
  return {
    locale: "en",
    setLocale: () => {},
    t: (key, varsOrFallback, maybeFallback) => {
      const vars = typeof varsOrFallback === "object" ? varsOrFallback : undefined;
      const fallback =
        typeof varsOrFallback === "string" ? varsOrFallback : maybeFallback;
      return interpolate(en[key] ?? fallback ?? key, vars);
    },
  };
}

/** Shorthand for the common case. */
export function useT() {
  return useI18n().t;
}

/** Locale-aware date/number helpers, so formats follow the chosen language. */
export function useFormat() {
  const { locale } = useI18n();
  const tag = locale === "en" ? "en-GB" : "fr-FR";
  return useMemo(
    () => ({
      date: (value: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) =>
        value ? new Date(value).toLocaleDateString(tag, opts) : "—",
      time: (value: string | Date) =>
        new Date(value).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" }),
      dateTime: (value: string | Date) =>
        new Date(value).toLocaleString(tag, {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
      number: (value: number) => value.toLocaleString(tag),
    }),
    [tag],
  );
}
