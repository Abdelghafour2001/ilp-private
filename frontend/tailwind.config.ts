import type { Config } from "tailwindcss";

/**
 * Token-driven theme. Colors are CSS variables holding space-separated RGB
 * channels (e.g. `13 148 136`) so Tailwind's `/<alpha>` opacity modifiers keep
 * working (`bg-accent/15`, `text-text-muted/60`, …). The actual values for each
 * channel live in globals.css under `:root` (light) and `.dark` (dark), so every
 * utility automatically follows the active theme.
 */
const token = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // surfaces
        ink: token("--bg"),
        bg: token("--bg"),
        panel: token("--surface"),
        surface: token("--surface"),
        "surface-2": token("--surface-2"),
        "surface-3": token("--surface-3"),
        edge: token("--border"),
        border: token("--border"),
        "border-strong": token("--border-strong"),
        // text
        text: token("--text"),
        "text-muted": token("--text-muted"),
        "text-subtle": token("--text-subtle"),
        // brand + status
        accent: token("--accent"),
        "accent-hover": token("--accent-hover"),
        "accent-fg": token("--accent-fg"),
        "accent-text": token("--accent-text"),
        iris: token("--iris"),
        good: token("--good"),
        bad: token("--bad"),
        warn: token("--warn"),
        info: token("--info"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
        display: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "0.625rem",
        xl: "0.875rem",
        "2xl": "1.125rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(var(--shadow) / 0.05)",
        sm: "0 1px 3px 0 rgb(var(--shadow) / 0.08), 0 1px 2px -1px rgb(var(--shadow) / 0.06)",
        md: "0 4px 12px -2px rgb(var(--shadow) / 0.10), 0 2px 6px -2px rgb(var(--shadow) / 0.06)",
        lg: "0 12px 32px -8px rgb(var(--shadow) / 0.16), 0 4px 12px -4px rgb(var(--shadow) / 0.08)",
        xl: "0 24px 56px -12px rgb(var(--shadow) / 0.24)",
        glow: "0 0 0 1px rgb(var(--accent) / 0.25), 0 8px 28px -6px rgb(var(--accent) / 0.30)",
        "inner-line": "inset 0 1px 0 0 rgb(255 255 255 / 0.04)",
      },
      backgroundImage: {
        "grid-fade":
          "linear-gradient(to bottom, rgb(var(--bg) / 0) 0%, rgb(var(--bg)) 90%), radial-gradient(circle at 1px 1px, rgb(var(--border-strong) / 0.5) 1px, transparent 0)",
        "accent-sheen":
          "linear-gradient(135deg, rgb(var(--accent) / 1) 0%, rgb(var(--iris) / 1) 100%)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgb(var(--accent) / 0.5)" },
          "70%": { boxShadow: "0 0 0 8px rgb(var(--accent) / 0)" },
          "100%": { boxShadow: "0 0 0 0 rgb(var(--accent) / 0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fade-in 0.4s ease both",
        "scale-in": "scale-in 0.18s cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-ring": "pulse-ring 2s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
