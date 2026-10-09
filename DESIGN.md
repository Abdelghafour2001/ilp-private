---
version: 1
name: UpSkill
description: "An internal learning & development workspace: a calm, clean enterprise canvas (#f7f8fa light / #090c11 dark), white or charcoal cards with hairline slate borders, slate text, and a single teal accent (#0d9488) for the primary action, links and focus. Indigo (#4f46e5) is a secondary hue reserved for data-viz and gamification, never for chrome. Type is Hanken Grotesk with slight negative tracking on headings; JetBrains Mono for code and keyboard hints. The UI is dense but quiet: information first, decoration last, used daily in bright offices by people who did not choose it."

colors:
  # light (:root) — source of truth is frontend/src/app/globals.css
  canvas: "#f7f8fa"
  surface: "#ffffff"
  surface-2: "#f6f8fb"
  surface-3: "#eef2f7"
  border: "#e2e8f0"
  border-strong: "#cbd5e1"
  text: "#0f172a"
  text-muted: "#334155"
  text-subtle: "#475569"
  accent: "#0d9488"
  accent-hover: "#0f766e"
  accent-fg: "#ffffff"
  accent-text: "#0f766e"
  iris: "#4f46e5"
  good: "#009e73"
  bad: "#d55e00"
  warn: "#ca8a04"
  info: "#0284c7"
  chart: ["#0d9488", "#4f46e5", "#ca8a04", "#0284c7", "#be185d", "#059669"]

colors-dark:
  canvas: "#090c11"
  surface: "#141a23"
  surface-2: "#1c232f"
  surface-3: "#262f3d"
  border: "#232c39"
  border-strong: "#364253"
  text: "#e9eff6"
  text-muted: "#9caabd"
  text-subtle: "#7c8ca2"
  accent: "#14b8a6"
  accent-hover: "#2dd4bf"
  accent-fg: "#04100f"
  accent-text: "#2dd4bf"
  iris: "#818cf8"
  good: "#34d399"
  bad: "#f4744b"
  warn: "#eab308"
  info: "#38bdf8"
  chart: ["#2dd4bf", "#818cf8", "#facc15", "#38bdf8", "#f472b6", "#34d399"]

typography:
  sans: "Hanken Grotesk (next/font, --font-sans)"
  mono: "JetBrains Mono (next/font, --font-mono)"
  features: "cv05, ss01; tabular-nums via .tnum on any number that is compared"
  scale:
    page-title: "text-2xl / font-semibold / tracking -0.02em"
    section-title: "text-lg / font-semibold"
    card-title: "text-base / font-semibold"
    body: "text-sm (14px) — the default for app UI"
    meta: "text-xs (12px) / text-text-muted or text-text-subtle"
    eyebrow: "text-xs / font-semibold / uppercase / tracking 0.14em / text-subtle"

rounded:
  badge: "6px (rounded-md)"
  control: "10px (rounded-lg) — buttons, inputs, icon buttons"
  card: "14px (rounded-xl)"
  panel: "18px (rounded-2xl)"
  pill: "9999px — chips, progress bars, step indicators"

spacing:
  base: "4px (Tailwind scale)"
  card-padding: "20px (p-5)"
  page-gutter: "16px mobile / 32px md+"
  content-max: "72rem (max-w-6xl)"
  stack: "space-y-3 inside cards, space-y-6 between sections"

components:
  - .btn          # primary — one per view region
  - .btn-ghost    # secondary / cancel
  - .btn-soft     # tertiary, accent-tinted
  - .btn-sm, .btn-icon
  - .card, .card-hover, .panel
  - .input, .select, .textarea, .label
  - .badge (+ .badge-good/-bad/-warn/-accent), .chip, .kbd
  - .eyebrow, .link, .divider, .skeleton, .skip-link
  - Modal (components/Modal.tsx) — the only dialog
---

# UpSkill design system

Read this before building or changing any screen in `frontend/`. Tokens live in
`frontend/src/app/globals.css` (as RGB channels) and are exposed as Tailwind
colors in `frontend/tailwind.config.ts`. **Use the tokens, never raw hex or
Tailwind palette colors** (`bg-slate-100`, `text-teal-600`): those don't follow
the dark theme.

## Overview

UpSkill is an internal tool. People open it between meetings to find a course,
finish a lab, approve a request or check a team's progress. The design job is to
make the next action obvious and the data legible, in French and English, in
light and dark, on a laptop in a bright office and occasionally on a phone.

- **Quiet chrome, loud content.** Neutral surfaces and hairline borders; color
  is spent on state (progress, status, due) and on the one primary action.
- **One accent.** Teal means "act here" or "this is a link". If everything is
  teal, nothing is.
- **Enterprise, not corporate.** Friendly copy and small moments of delight
  (level ring, badges, quests) live inside the content, not in the frame.

## Colors

### Brand & accent
- `accent` for the primary button, active nav item, links (`accent-text`), focus
  ring, and selected states.
- `accent/10`–`accent/15` tints for soft buttons, selected rows, active chips.
- `iris` only in charts, XP/level/gamification visuals. Never on buttons or nav.
- `bg-accent-sheen` / `.text-gradient` (teal → indigo): at most once per screen,
  for a hero number or brand moment. Not on body text, not on buttons.

### Surfaces
`canvas` (page) → `surface` (cards) → `surface-2` (hover, inset wells, table
header) → `surface-3` (pressed, nested wells). Separate layers with a border
first; add shadow only when something floats (menus, modals, hovered cards).

### Text
`text` for content and headings, `text-muted` for secondary copy, `text-subtle`
for meta, placeholders and eyebrows. All three pass AA on every surface; don't
add `opacity-*` to text to make it lighter, pick the next token instead.

### Semantic
`good` / `bad` are an Okabe-Ito bluish-green / vermillion pair, distinguishable
for color-blind users. Still never rely on color alone: pair status with an
icon or a word (`✓ Done`, `Overdue`). Use the `.badge-*` helpers for status
pills. `warn` for "due soon / expiring"; `info` for neutral notices.

### Charts
Use `--chart-1` … `--chart-6` in order. The first series is not "the brand
one"; don't recolor it to accent.

## Typography

- Hanken Grotesk everywhere; JetBrains Mono for code, IDs, `.kbd`.
- App body is `text-sm`. Larger body text is for reading views (lessons,
  markdown), not for forms or tables.
- Headings: semibold, `-0.02em` tracking, balanced wrap (set globally).
- One `h1` per page (the page title). Don't skip levels for styling; restyle
  the right level instead.
- Numbers that are compared (scores, counts, durations, table columns) get
  `.tnum`.
- Use `…` not `...`; loading labels end with `…` ("Saving…"). Use `Intl.*`
  for dates and numbers; the app is bilingual, so never hardcode a format.

## Layout

- App shell: sticky sidebar (md+), sticky 64px topbar, content in
  `max-w-6xl` with `px-4 md:px-8` gutters. Don't fight the shell with
  full-bleed sections inside it.
- Page anatomy: eyebrow (optional) → `h1` + one-line lede → primary action
  top-right → content. Filters sit directly above the list they filter.
- Grids: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` for cards. Avoid rows of
  three identical feature boxes when one list would read faster.
- Every list has an empty state (what this is + the action that fills it), a
  loading state (`.skeleton` with the real layout's shape), and an error state
  with a next step.
- Flex children that hold text get `min-w-0` + `truncate` / `line-clamp-*`.

## Elevation & depth

| Level | Use | Token |
|---|---|---|
| 0 | page, inline wells | border only |
| 1 | cards, inputs | `shadow-xs` / `shadow-sm` |
| 2 | hovered card, dropdown | `shadow-md` |
| 3 | popover, command palette | `shadow-lg` |
| 4 | modal | `shadow-xl` / `shadow-2xl` + `bg-black/50` backdrop |

`shadow-glow` is for one highlighted item (current step, recommended course).

## Shapes

Controls `rounded-lg`, cards `rounded-xl`, large panels `rounded-2xl`, chips and
progress bars `rounded-full`. Don't mix radii within one component; nested
elements use a smaller radius than their container.

## Components

### Buttons
- `.btn`: primary. **One per region** (page header, card, modal footer).
- `.btn-ghost`: secondary and Cancel. `.btn-soft`: low-emphasis accent action.
- `.btn-icon`: square icon button, **always** with `aria-label`.
- Labels are verbs + object ("Assign course", "Save goal"), not "OK" / "Continue".
- Destructive actions: ghost button with `text-bad`, confirmation via `Modal`
  or an undo toast. Never one-click delete.
- While a request runs, keep the button and show a spinner + "Saving…"; don't
  disable it before the click.

### Sections and panels
- Section title (`h2`, `text-base font-semibold`) sits **above** its panel, not
  inside a header bar. Meta (counts, "View all") aligns right on the same line.
- Inside a panel, split content with `divide-y` / `divide-x` and borders —
  never cards nested in cards.
- Lists of destinations are rows (`icon · label · one-line desc`), not grids of
  big cards. A row's hover is a `bg-surface-2` wash.
- Several numbers about one thing (level, XP, streak, rank) go in **one**
  composed panel with a headline and a `<dl>` strip, not N identical stat boxes.
- Empty and "ask AI" states: a dashed `border-border-strong` box with one
  sentence and the action.

### Cards
`.card` for content blocks, `.card-hover` only when the whole card is a link.
A clickable card is an `<a>`/`<Link>`, or a `<button>` when it opens a Modal;
never a `div` with `onClick`.

### Course covers
`components/CourseCover.tsx`: real image when there is one; otherwise a
chart-hue wash + fading dot grid (hue picked from the title hash) with the
course emoji on a raised tile. Provider courses show the platform colour as a
top strip and a small mark, never as a full-bleed brand block. Card meta reads
`● Level · Provider ↗ · 12 h` as a quiet line above the title, not badges.

### Forms
Everything lives in `components/form/`; use it instead of bare inputs.

- `Field`: label above, control, then the error *or* the hint. Optional fields
  say "optional"; fields that land on a card get a `count/max` counter.
  Placeholders show an *example* ("Cut invoice matching time in half"), never
  the label.
- `FormSection`: a long form is 2–3 titled sections (title + one-line lede in a
  left column on wide screens), not one endless stack.
- Choices: `Segmented` for 2–4 short options, selectable cards (icon + title +
  one line) when each option needs explaining, chips for many. Avoid a native
  `<select>` for fewer than ~6 options.
- `TagInput` for tags (chips, popular suggestions from `usePopularTags`),
  `EmojiPicker` for an item's icon, `FileDrop` for uploads (validates type and
  size before upload), `MarkdownField` for long text (Write / Preview tabs).
- Correct `type`, `inputMode`, `name`, `autoComplete`; `spellCheck={false}` on
  emails, URLs, handles and code.
- Validate as people type, but only show an error once a field has content.
  An optional field holding something invalid still blocks submit.

### Create pages
`CreateLayout` is the frame for every "create something" page:
- **Live preview** of the card as the catalogue will show it, beside the form.
- **Checklist**: required items block submit, the rest are suggestions; it
  fills in as the form does.
- **Sticky action bar**: names the one thing still blocking ("Still needed:
  Title") rather than silently greying the button; Cancel + primary submit
  with a spinner while saving.
- Multi-step builders (course, training) use the same pieces plus step pills in
  the header; a step can't be skipped while the one before it is blocked.

### Lesson players
Outline as a stepper on the left (done / current / to do), a reading column
capped at ~70ch with 15px body text, a slim progress bar in the header,
previous/next cards naming the lessons, ← → to move, and a finish screen.
Players open on the first lesson not yet done.

### Tables
- Header row: sentence case, `text-xs text-text-subtle`, `bg-surface-2/60`.
- Numbers right-aligned with `.tnum`; never colour a number just to decorate it.
- Wide tables scroll inside their panel: `panel relative overflow-x-auto` plus a
  `min-w-[…]` on the `<table>`. The `relative` matters: without it a
  `sr-only` child escapes the clip and the whole page scrolls sideways.
- Row actions: a `btn-ghost btn-sm` for the main one, an icon button (with
  `aria-label`) for destructive ones, which still confirm.
- An action that needs a choice opens one Modal with the choice inside it. It
  never depends on a control somewhere else on the page.

### Modal
Use `components/Modal.tsx`, never a hand-rolled overlay. It portals to `<body>`,
moves focus into the dialog and back to the opener on close, and closes on Esc
and backdrop click. Long forms become a
wizard via `steps`, not a taller popup.

### Navigation
Nav items come from `lib/nav.ts`. Active item: accent tint background +
`accent-text`. Navigation is always `<Link>` so ⌘/Ctrl-click works. Tabs,
filters and pagination that matter go in the URL query.

### Feedback
Toasts and async validation use `aria-live="polite"`. Progress bars animate
`transform`/width only, never `transition-all`.

## Motion

- Durations: 150ms for controls, 200ms for cards, ≤500ms for entrances
  (`animate-fade-up`, `animate-scale-in`).
- Animate `transform` and `opacity`. List transitioned properties explicitly
  (`transition-colors`, `transition-[transform,box-shadow]`), never
  `transition-all`.
- `prefers-reduced-motion` is honored globally in `globals.css`; don't
  re-enable motion with inline styles or JS-driven animation without checking
  it.
- No infinite decorative loops. `animate-pulse-ring` is for one live
  indicator at a time.

## Accessibility (non-negotiable)

- Visible focus on every interactive element (global `:focus-visible` ring;
  never `outline-none` without a replacement).
- Icon-only buttons: `aria-label`; decorative icons/glyphs: `aria-hidden`.
- Images: `alt` (or `alt=""`), explicit `width`/`height`.
- Text contrast ≥ 4.5:1: use the text tokens, never lighten them with opacity.
- Keyboard: everything reachable and operable; the skip link (`.skip-link`)
  stays first in the shell.
- Touch targets ≥ 36px (`h-9`) on desktop, 44px for primary mobile actions.

## Do's and don'ts

### Do
- Reuse the component classes above before writing new utility stacks.
- Show real data shapes in skeletons and empty states.
- Write FR and EN strings in `lib/i18n/{fr,en}.ts` together.
- Test every change in light **and** dark.

### Don't
- Raw colors (`#hex`, `bg-gray-*`, `text-teal-*`), `transition-all`,
  `outline-none` alone, `div onClick`.
- Purple/indigo gradients on chrome, glassmorphism on cards, emoji as icons
  in navigation, centered-hero marketing layouts inside the app.
- A second primary button in the same region.
- New dialogs, toasts or dropdowns that duplicate an existing component.

## Responsive behavior

- Breakpoints: Tailwind defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280).
  The sidebar becomes a drawer below `md`.
- Tables: horizontal scroll inside the card (`overflow-x-auto`) under `md`, or
  collapse to stacked rows for ≤4 columns.
- Page header actions wrap under the title on mobile (`flex-wrap`).

## Iteration guide

When building or redesigning a screen:
1. Read this file and the screen's existing components.
2. Use the `redesign-existing-projects` / `design-taste-frontend` skills for
   direction, constrained by this file: tokens here win over the skill's
   defaults.
3. Run the `web-design-guidelines` skill on the changed files before
   committing.
4. If a screen genuinely needs a new token or component, add it to
   `globals.css` / `tailwind.config.ts` **and** to this file in the same change.
