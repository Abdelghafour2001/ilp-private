"use client";

/**
 * What someone sees when they reach a page their role does not cover.
 *
 * The nav already hides these entries, so arriving here means a bookmark, a
 * shared link, or a role that changed since the tab was opened — all normal,
 * none of them a mistake worth scolding somebody for. So this states the rule,
 * names who does have access, and offers somewhere to go instead. A raw
 * "Error: 403 Forbidden" tells the reader they did something wrong, which is
 * both unhelpful and usually untrue.
 */

import Link from "next/link";
import { useT } from "@/lib/i18n";

export default function AccessDenied({
  audience,
  detailKey,
  backHref = "/",
  backLabelKey,
}: {
  /** Translation key naming who this page is for. Keys rather than literals:
   *  the surrounding copy is translated, and a hardcoded French audience in an
   *  English shell produces half a sentence in each language. */
  audience: string;
  /** Optional key for the extra line — what they can do instead. */
  detailKey?: string;
  backHref?: string;
  backLabelKey?: string;
}) {
  const t = useT();
  const needed = t(audience);
  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="card space-y-3 text-center">
        <span aria-hidden className="text-3xl">
          🔒
        </span>
        <h1 className="text-lg font-semibold">{t("access.title")}</h1>
        <p className="text-sm text-text-muted">
          {t("access.body", { needed })}
        </p>
        {detailKey && <p className="text-sm text-text-subtle">{t(detailKey)}</p>}
        <Link href={backHref} className="btn-soft mx-auto w-fit">
          {backLabelKey ? t(backLabelKey) : t("access.back")}
        </Link>
      </div>
    </div>
  );
}

/** True when a fetch failed because the viewer is not allowed, rather than
 *  because something broke. Both arrive as a thrown Error here, and telling
 *  someone "access reserved" when the server is actually down is its own bug. */
export function isForbidden(error: unknown): boolean {
  const text = String(error);
  return (
    text.includes("403") ||
    text.toLowerCase().includes("forbidden") ||
    text.includes("Only HR or admins") ||
    text.includes("Seul le service Formation")
  );
}
