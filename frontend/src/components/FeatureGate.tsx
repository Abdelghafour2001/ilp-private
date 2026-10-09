"use client";

/**
 * A page belonging to a switched-off module says so, instead of failing.
 *
 * Hiding the sidebar entry is most of the job, but the URL survives: a
 * bookmark, a link in an old email, or somebody typing /labs still lands on a
 * page that calls an API now answering 404, and renders "Error: Not Found" —
 * which reads as a broken platform rather than a module this client did not
 * buy.
 *
 * The route is mapped to its switch through the navigation table, so there is
 * one list of which page belongs to which module rather than two that drift.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFeatures } from "@/lib/features";
import { NAV_ITEMS } from "@/lib/nav";
import { useI18n } from "@/lib/i18n";

/** The switch governing a path, or undefined for the platform's own pages. */
function featureFor(pathname: string): string | undefined {
  const match = NAV_ITEMS.filter((item) => item.feature)
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    // "/courses/12" matches "/courses"; the longest href wins when two could.
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.feature;
}

export default function FeatureGate({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const features = useFeatures();
  const key = featureFor(pathname);

  // Undefined means the answer has not arrived yet. Showing the page is the
  // right default: the API refuses anything genuinely off, and a flash of
  // "not available" on every navigation would be its own bug.
  if (!key || features?.[key] !== false) return <>{children}</>;

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="text-4xl" aria-hidden>
        🧩
      </p>
      <h1 className="mt-3 text-xl font-semibold">{t("feature.offTitle")}</h1>
      <p className="mt-2 text-sm text-text-muted">{t("feature.offBody")}</p>
      <Link href="/" className="btn mt-5 inline-flex">
        {t("feature.offHome")}
      </Link>
    </div>
  );
}
