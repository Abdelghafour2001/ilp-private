import type { SVGProps } from "react";

/**
 * Dependency-free icon set (lucide-style, 24-grid, stroke-based). Keeps the
 * bundle lean — no icon library — while giving the shell crisp, consistent
 * line icons that follow `currentColor`.
 */
export type IconName =
  | "home"
  | "courses"
  | "labs"
  | "stacks"
  | "challenges"
  | "sessions"
  | "assets"
  | "playground"
  | "studio"
  | "leaderboard"
  | "admin"
  | "settings"
  | "search"
  | "command"
  | "sun"
  | "moon"
  | "sparkles"
  | "arrow-right"
  | "chevron-right"
  | "chevron-down"
  | "x"
  | "check"
  | "flame"
  | "bolt"
  | "trophy"
  | "plus"
  | "menu"
  | "logout"
  | "book"
  | "formations"
  | "team"
  | "calendar"
  | "award"
  | "bell"
  | "org"
  | "target"
  | "route"
  | "file"
  | "play"
  | "quiz"
  | "external"
  | "pencil"
  | "trash"
  | "clock"
  | "mail"
  | "lock";

const PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5",
  team: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7.4M22 21v-1a7 7 0 0 0-4-6.3",
  calendar: "M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  bell: "M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9ZM10.3 20a2 2 0 0 0 3.4 0",
  org: "M12 3v4M12 3h-2m2 0h2M6 11h12M6 11v-2h12v2M6 11v3m12-3v3M4 17h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4Z",
  target: "M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 12m-5 0a5 5 0 1 0 10 0 5 5 0 1 0-10 0M12 12m-1 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0",
  route: "M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm14-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM7 17h8a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h8",
  award: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm-3.3-1.3L7 21l5-2 5 2-1.7-7.3",
  formations: "M2 9l10-5 10 5-10 5L2 9Zm4 3v5c0 1.2 2.7 2.5 6 2.5s6-1.3 6-2.5v-5M22 9v6",
  courses: "M3 7l9-4 9 4-9 4-9-4Zm0 0v6m4-1.8V17c0 1.1 2.2 2 5 2s5-.9 5-2v-5.8",
  labs: "M9 3h6M10 3v6L5.5 17.5A2 2 0 0 0 7.3 21h9.4a2 2 0 0 0 1.8-3.5L14 9V3M8 14h8",
  stacks: "M12 3 3 7.5l9 4.5 9-4.5L12 3ZM3 12l9 4.5L21 12M3 16.5 12 21l9-4.5",
  challenges: "M5 21V4a1 1 0 0 1 1-1h11l-2.5 4L17 11H6M5 21h4",
  sessions:
    "M3 4h18v11H3zM3 4v11M8 20h8M12 15v5M7 8l2.5 2.5L7 13M13 12h4",
  assets:
    "M3 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  playground:
    "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM7 9l3 3-3 3M13 15h4",
  studio:
    "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-2 2.3-2.3Z",
  leaderboard: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3",
  admin: "M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3Z",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z",
  search: "M11 11m-7 0a7 7 0 1 0 14 0 7 7 0 1 0-14 0M21 21l-4.3-4.3",
  command: "M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6 4.5 4.5M19.5 19.5 18 18M18 6l1.5-1.5M4.5 19.5 6 18M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
  sparkles:
    "M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8L12 3ZM18 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-down": "M6 9l6 6 6-6",
  x: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5 10 17l9-10",
  flame:
    "M12 22a7 7 0 0 0 7-7c0-3-2-5-3-7-1.5 1-2 2-2 2s-1-3-4-7c0 4-3 5-3 9a7 7 0 0 0 5 10Z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M8 21h8M12 17v4",
  plus: "M12 5v14M5 12h14",
  menu: "M4 6h16M4 12h16M4 18h16",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  book: "M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5ZM18 17H6",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 13h6M9 17h4",
  play: "M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M10 8.5v7l5.5-3.5L10 8.5Z",
  quiz: "M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.3M12 17h.01",
  external: "M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4",
  pencil: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  clock: "M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0M12 7v5l3 2",
  mail: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM3 7l9 6 9-6",
  lock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM8 11V7a4 4 0 0 1 8 0v4",
};

export default function Icon({
  name,
  size = 18,
  ...props
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
