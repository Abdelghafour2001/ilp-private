"use client";

/**
 * Card artwork for a course.
 *
 * Three cases, in order:
 *
 * 1. A real thumbnail (a YouTube/Vimeo video, or an author-supplied image) —
 *    shown with a play affordance when it came from a video.
 * 2. An external course whose platform publishes no addressable thumbnail
 *    (Coursera, Udemy, LinkedIn Learning) — a placeholder in that platform's
 *    own colours, so the card is still recognisable at a glance.
 * 3. Nothing to go on — the course's emoji on a neutral gradient.
 *
 * We deliberately do not scrape or hotlink partner artwork we have no right to
 * use; a branded placeholder is honest and ages better than a broken image.
 */

import { useState } from "react";

/** Brand colours for the platforms that show up in the catalog. */
const PROVIDER_STYLE: Record<string, { from: string; to: string; mark: string }> = {
  coursera: { from: "#0056D2", to: "#0043a8", mark: "C" },
  udemy: { from: "#A435F0", to: "#7d20c4", mark: "U" },
  "linkedin learning": { from: "#0A66C2", to: "#084d92", mark: "in" },
  linkedin: { from: "#0A66C2", to: "#084d92", mark: "in" },
  openclassrooms: { from: "#7451EB", to: "#5533c9", mark: "OC" },
  pluralsight: { from: "#F15B2A", to: "#c94718", mark: "PS" },
  datacamp: { from: "#03EF62", to: "#03b64c", mark: "DC" },
  edx: { from: "#02262B", to: "#00171a", mark: "edX" },
  cegos: { from: "#E2001A", to: "#a80014", mark: "CG" },
};

function providerStyle(provider: string) {
  return PROVIDER_STYLE[provider.trim().toLowerCase()] ?? null;
}

interface Props {
  coverUrl?: string;
  provider?: string;
  emoji?: string;
  title?: string;
  /** `aspect-video` for cards; pass a different ratio for other surfaces. */
  className?: string;
}

export default function CourseCover({
  coverUrl,
  provider = "",
  emoji = "📚",
  title = "",
  className = "aspect-video",
}: Props) {
  // A derived YouTube thumbnail can 404 (deleted or private video); fall
  // through to the placeholder rather than showing a broken image.
  const [failed, setFailed] = useState(false);
  const showImage = !!coverUrl && !failed;
  const brand = providerStyle(provider);
  // Each artless course gets one of the chart hues, picked from its emoji so
  // the builder's live preview, the catalogue and the course page all agree,
  // and the grid doesn't read as one flat tint.
  const hue = `var(--chart-${(hash(emoji) % 6) + 1})`;

  return (
    <div className={`relative w-full overflow-hidden rounded-lg bg-surface-2 ${className}`}>
      {showImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- remote
              thumbnails from arbitrary hosts; next/image would need each one
              allow-listed in next.config.js. */}
          <img
            src={coverUrl}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
          <span className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-black/55 pl-0.5 text-white backdrop-blur-sm">
              ▶
            </span>
          </span>
        </>
      ) : brand ? (
        // The platform's colour as an accent, not as a wall: a full-bleed
        // Coursera blue next to calm cards out-shouts every in-house course.
        <div className="relative flex h-full w-full items-end p-4" aria-hidden="true">
          <Pattern color={brand.from} />
          <span className="absolute inset-x-0 top-0 h-1" style={{ background: brand.from }} />
          <span className="relative flex items-center gap-2.5">
            <span
              className="grid h-9 min-w-9 place-items-center rounded-lg px-1.5 text-sm font-bold tracking-tight text-white shadow-sm"
              style={{ background: `linear-gradient(135deg, ${brand.from}, ${brand.to})` }}
            >
              {brand.mark}
            </span>
            <span className="text-sm font-semibold text-text">{provider}</span>
          </span>
        </div>
      ) : (
        <div className="relative flex h-full w-full items-end p-4" aria-hidden="true">
          <Pattern color={`rgb(${hue})`} />
          <span
            className="relative grid h-14 w-14 place-items-center rounded-2xl border bg-surface text-3xl shadow-sm transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:rotate-[-4deg]"
            style={{ borderColor: `rgb(${hue} / 0.25)` }}
          >
            {emoji}
          </span>
        </div>
      )}
      {title && <span className="sr-only">{title}</span>}
    </div>
  );
}

/** A soft wash of the hue plus a dot grid that fades out toward the corner. */
function Pattern({ color }: { color: string }) {
  return (
    <>
      <span
        className="absolute inset-0 opacity-[0.22] dark:opacity-[0.22]"
        style={{ background: `radial-gradient(120% 120% at 100% 0%, ${color}, transparent 70%)` }}
      />
      <span
        className="absolute inset-0 opacity-50 dark:opacity-30"
        style={{
          backgroundImage: `radial-gradient(${color} 1px, transparent 1.2px)`,
          backgroundSize: "14px 14px",
          maskImage: "linear-gradient(225deg, black 10%, transparent 65%)",
          WebkitMaskImage: "linear-gradient(225deg, black 10%, transparent 65%)",
        }}
      />
    </>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
