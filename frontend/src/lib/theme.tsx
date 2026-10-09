"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "aida.theme";

/** Inline script injected before paint to avoid a flash of the wrong theme. */
export const themeScript = `(function(){try{var t=localStorage.getItem('${KEY}');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t;}catch(e){}})();`;

function current(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function apply(t: Theme) {
  const el = document.documentElement;
  el.classList.toggle("dark", t === "dark");
  el.style.colorScheme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent("aida-theme-changed", { detail: t }));
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(current());
    const onChange = () => setTheme(current());
    window.addEventListener("aida-theme-changed", onChange);
    return () => window.removeEventListener("aida-theme-changed", onChange);
  }, []);

  const toggle = useCallback(() => {
    apply(current() === "dark" ? "light" : "dark");
  }, []);

  const set = useCallback((t: Theme) => apply(t), []);

  return { theme, toggle, set };
}
