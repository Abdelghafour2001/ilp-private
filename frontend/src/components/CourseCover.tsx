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

  return (
    <div
      className={`relative w-full overflow-hidden rounded-lg bg-surface-2 ${className}`}
      style={
        !showImage && brand
          ? { backgroundImage: `linear-gradient(135deg, ${brand.from}, ${brand.to})` }
          : undefined
      }
    >
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
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
              ▶
            </span>
          </span>
        </>
      ) : brand ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-white">
          <span className="text-2xl font-bold tracking-tight drop-shadow">{brand.mark}</span>
          <span className="text-[11px] font-medium uppercase tracking-widest opacity-90">
            {provider}
          </span>
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/15 to-iris/10">
          <span className="text-4xl" aria-hidden>
            {emoji}
          </span>
        </div>
      )}
      {title && <span className="sr-only">{title}</span>}
    </div>
  );
}
