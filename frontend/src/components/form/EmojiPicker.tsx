"use client";

/**
 * Pick the emoji that becomes a course or training's cover. A curated grid
 * covers what people actually choose; the box underneath takes anything else
 * (paste from the OS picker). Replaces a one-character text input that gave
 * no hint of what it was for.
 */

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

const GROUPS: { key: string; items: string[] }[] = [
  { key: "code", items: ["📊", "📈", "🗃️", "🧮", "🧪", "🔬", "💻", "🐍", "🧩", "⚙️", "🛠️", "🔐"] },
  { key: "ai", items: ["🤖", "🧠", "✨", "🪄", "💬", "🔮"] },
  { key: "people", items: ["🗣️", "🤝", "🎯", "📋", "🧭", "💼", "🎨", "📣"] },
  { key: "learning", items: ["📚", "🎓", "📝", "💡", "🏆", "🚀", "🌱", "🌍"] },
];

export default function EmojiPicker({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string;
  onChange: (emoji: string) => void;
  label?: string;
}) {
  const t = useT();
  label = label ?? t("form.emoji");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value || "—"}`}
        onClick={() => setOpen((o) => !o)}
        className="grid h-[2.625rem] w-[2.625rem] place-items-center rounded-lg border border-border bg-surface text-xl shadow-xs transition-[border-color,transform] hover:border-border-strong active:scale-95"
      >
        {value || "＋"}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-30 mt-2 w-72 animate-scale-in rounded-xl border border-border bg-surface p-3 shadow-lg"
        >
          {GROUPS.map((g) => (
            <div key={g.key} className="mb-2 last:mb-0">
              <p className="mb-1 text-[11px] font-medium text-text-subtle">{t(`form.emoji.${g.key}`)}</p>
              <div className="grid grid-cols-8 gap-0.5">
                {g.items.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      onChange(e);
                      setOpen(false);
                    }}
                    aria-label={e}
                    aria-pressed={e === value}
                    className={`grid h-8 w-8 place-items-center rounded-md text-lg transition-[background-color,transform] hover:scale-110 hover:bg-surface-2 ${
                      e === value ? "bg-accent/15 ring-1 ring-accent/40" : ""
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <label className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-xs text-text-subtle">
            {t("form.emojiPaste")}
            <input
              className="input h-8 w-16 px-2 py-1 text-center text-base"
              maxLength={4}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              aria-label={t("form.emojiCustom")}
            />
          </label>
        </div>
      )}
    </div>
  );
}
