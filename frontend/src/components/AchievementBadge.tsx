"use client";

/**
 * An achievement, drawn as a badge rather than printed as an emoji.
 *
 * A bare 🌱 next to a label reads as decoration. A minted disc with a rim, the
 * Teal mark and a tier colour reads as something awarded — which is the whole
 * point of a badge, and the reason people screenshot them.
 *
 * Drawn in SVG so it stays crisp at any size, follows the theme, and costs no
 * image request. The tier comes from the achievement itself, so the visual
 * weight tracks how hard it was to earn instead of being uniform.
 */

import { useId } from "react";

export type BadgeTier = "bronze" | "silver" | "gold" | "teal";

/** Rim and field per tier. Teal is the house tier — the platform's own
 *  milestones — and is deliberately the one that matches the logo. */
const TIERS: Record<BadgeTier, { rim: string; field: string; ink: string }> = {
  bronze: { rim: "#B0703C", field: "#F3E3D6", ink: "#7A4A22" },
  silver: { rim: "#8C98A4", field: "#EDF1F5", ink: "#4C5967" },
  gold: { rim: "#C79A1E", field: "#FAF0D2", ink: "#7A5C08" },
  teal: { rim: "#16A79E", field: "#DFF3F1", ink: "#0F766E" },
};

export default function AchievementBadge({
  emoji,
  label,
  tier = "teal",
  size = 72,
  locked = false,
  title,
}: {
  emoji: string;
  label?: string;
  tier?: BadgeTier;
  size?: number;
  /** Not yet earned: shown as an outline so the catalogue reads as a goal
   *  rather than hiding what there is to aim at. */
  locked?: boolean;
  title?: string;
}) {
  const gradientId = useId();
  const palette = TIERS[tier];
  const r = 50;

  return (
    <figure className="flex flex-col items-center gap-1.5" title={title ?? label}>
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        role="img"
        aria-label={label ?? "badge"}
        className={locked ? "opacity-45 grayscale" : ""}
      >
        <defs>
          <radialGradient id={gradientId} cx="35%" cy="28%" r="80%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="100%" stopColor={palette.field} />
          </radialGradient>
        </defs>

        {/* the disc */}
        <circle cx="60" cy="60" r={r} fill={`url(#${gradientId})`} />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={palette.rim}
          strokeWidth={locked ? 2 : 5}
          strokeDasharray={locked ? "6 5" : undefined}
        />
        {/* an inner hairline: what makes a disc read as minted rather than as
            a coloured circle */}
        <circle cx="60" cy="60" r={r - 8} fill="none" stroke={palette.rim} strokeWidth="0.8" opacity="0.55" />

        {/* the symbol */}
        <text
          x="60"
          y="66"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="40"
        >
          {emoji}
        </text>

        {/* the house mark, small, at the foot of the disc — attribution, not
            ornament: it says who issued this. */}
        <text
          x="60"
          y="97"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fontFamily="Helvetica, Arial, sans-serif"
          fill={palette.ink}
          letterSpacing="0.5"
        >
          Teal
        </text>
      </svg>
      {label && (
        <figcaption className="max-w-[9rem] text-center text-[11px] font-medium leading-tight text-text-muted">
          {label}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * The tier an achievement sits in.
 *
 * Derived from the badge id rather than stored, so the catalogue stays a plain
 * list on the server and the visual language lives with the visuals. Milestones
 * the platform itself defines get the house tier; the rest scale with effort.
 */
export function tierFor(badgeId: string): BadgeTier {
  if (/(master|legend|complete|champion)/.test(badgeId)) return "gold";
  if (/(streak|roll|explorer|high_roller|centurion)/.test(badgeId)) return "silver";
  if (/(first|starter|hello)/.test(badgeId)) return "bronze";
  return "teal";
}
