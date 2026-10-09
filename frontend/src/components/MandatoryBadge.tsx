"use client";

/**
 * The "obligatoire" marker, in one place so it looks identical everywhere.
 *
 * A required training that does not announce itself on the card has the same
 * completion rate as an optional one and none of the effect — people finish
 * what they know they have to finish. So this is deliberately louder than the
 * level or format badges beside it: filled rather than tinted, and never the
 * same colour as anything decorative.
 */

import { useT } from "@/lib/i18n";

export default function MandatoryBadge({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const t = useT();
  const dim = size === "sm" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      title={t("catalog.mandatoryHint")}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-bad font-semibold uppercase tracking-wide text-white ${dim} ${className}`}
    >
      <span aria-hidden>!</span>
      {t("catalog.mandatory")}
    </span>
  );
}

/** The softer companion: a programme that only asks for feedback at the end. */
export function FeedbackRequiredBadge({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <span
      title={t("catalog.feedbackHint")}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-iris/15 px-2 py-0.5 text-[11px] font-medium text-iris ${className}`}
    >
      ★ {t("catalog.feedbackRequired")}
    </span>
  );
}
