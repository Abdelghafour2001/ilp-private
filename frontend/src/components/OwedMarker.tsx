"use client";

/**
 * The deadline on a catalogue card, for an entry this person owes.
 *
 * MandatoryBadge says "this is obligatory" about the content itself. This says
 * "and *you* have until the 20th" — the half the learner actually acts on, and
 * the half that was only visible on another screen.
 */

import type { Assigned } from "@/lib/mandatory";
import { isOverdue } from "@/lib/mandatory";
import { useT } from "@/lib/i18n";

export default function OwedMarker({ owed }: { owed: Assigned }) {
  const t = useT();
  const late = isOverdue(owed);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        late ? "bg-bad text-white" : "bg-warn/20 text-warn"
      }`}
    >
      {owed.due_date
        ? `${late ? t("track.overdueShort", "En retard") : t("track.due")} ${owed.due_date}`
        : t("catalog.mandatory")}
    </span>
  );
}
