"use client";

import { useEffect, useState } from "react";
import { useMandatory, mandatoryFirst } from "@/lib/mandatory";
import OwedMarker from "@/components/OwedMarker";
import Pager, { PAGE_SIZE, pageOf } from "@/components/Pager";
import { type Pathway } from "@/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type CourseSummary } from "@/lib/api";
import CourseCover from "@/components/CourseCover";
import { getStoredLearner } from "@/lib/learner";
import { useFormat, useT } from "@/lib/i18n";

const LEVEL: Record<string, string> = {
  beginner: "bg-good/15 text-good",
  intermediate: "bg-warn/15 text-warn",
  advanced: "bg-bad/15 text-bad",
};

/** "data-science" reads as a slug; "Data science" reads as a subject. */
function prettify(slug: string): string {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function CoursesCatalog() {
  const router = useRouter();
  const t = useT();
  const fmt = useFormat();
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [q, setQ] = useState("");
  const [onlyOwed, setOnlyOwed] = useState(false);
  const owed = useMandatory("course");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CourseSummary | null>(null);
  // The catalogue is 800+ entries now that the provider catalogues are in it.
  const [page, setPage] = useState(0);
  // Server-side, because filtering 833 entries in the browser means shipping
  // all 833 first.
  const [filters, setFilters] = useState({ domain: "", provider: "", level: "", pathway: "" });
  const [pathways, setPathways] = useState<Pathway[]>([]);
  // The same list the server enforces in `can_curate`.
  const canAssign = ["trainer", "manager", "bu_head", "hr", "hr_lead", "admin"].includes(
    getStoredLearner()?.role ?? "",
  );
  const [facets, setFacets] = useState<{ domains: string[]; providers: string[] }>({
    domains: [],
    providers: [],
  });

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .listCourses(q || undefined, undefined, {
          domain: filters.domain || undefined,
          provider: filters.provider || undefined,
          level: filters.level || undefined,
          pathway: filters.pathway ? Number(filters.pathway) : undefined,
        })
        .then((rows) => {
          setCourses(rows);
          setPage(0);
        })
        .catch((e) => setError(String(e)));
    }, 200);
    return () => clearTimeout(t);
  }, [q, filters]);

  // The choices themselves come from the unfiltered catalogue, so narrowing on
  // one axis never empties the others.
  useEffect(() => {
    api
      .listCourses()
      .then((all) => {
        setFacets({
          domains: [...new Set(all.map((c) => c.domain).filter(Boolean))].sort(),
          providers: [...new Set(all.map((c) => c.provider).filter(Boolean))].sort(),
        });
      })
      .catch(() => {});
    api.listPathways().then(setPathways).catch(() => {});
  }, []);

  // Esc closes the detail card
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // What this person owes, lifted to the top of whatever the filters left.
  const shown = mandatoryFirst(courses, owed, onlyOwed);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("courses.title")}</h1>
          <p className="mt-1 text-sm text-text-subtle">{t("courses.subtitle")}</p>
        </div>
        <Link href="/courses/new" className="btn shrink-0">
          + {t("courses.new")}
        </Link>
      </div>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-sm"
          placeholder={t("courses.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {/* Subject first: it is what people actually browse by. Then where it
            came from, how hard it is, and which journey it belongs to. */}
        <select
          className="input max-w-[13rem]"
          value={filters.domain}
          onChange={(e) => setFilters((f) => ({ ...f, domain: e.target.value }))}
        >
          <option value="">{t("courses.allDomains")}</option>
          {facets.domains.map((d) => (
            <option key={d} value={d}>
              {prettify(d)}
            </option>
          ))}
        </select>
        <select
          className="input max-w-[11rem]"
          value={filters.provider}
          onChange={(e) => setFilters((f) => ({ ...f, provider: e.target.value }))}
        >
          <option value="">{t("courses.allProviders")}</option>
          {facets.providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className="input max-w-[10rem]"
          value={filters.level}
          onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value }))}
        >
          <option value="">{t("courses.allLevels")}</option>
          {["beginner", "intermediate", "advanced"].map((l) => (
            <option key={l} value={l}>
              {t(`common.${l}`, l)}
            </option>
          ))}
        </select>
        <select
          className="input max-w-[13rem]"
          value={filters.pathway}
          onChange={(e) => setFilters((f) => ({ ...f, pathway: e.target.value }))}
        >
          <option value="">{t("courses.allPathways")}</option>
          {pathways.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.emoji} {p.title}
            </option>
          ))}
        </select>
        {Object.values(filters).some(Boolean) && (
          <button
            className="text-xs text-text-subtle hover:text-text"
            onClick={() => setFilters({ domain: "", provider: "", level: "", pathway: "" })}
          >
            ✕ {t("common.reset")}
          </button>
        )}
        {owed.size > 0 && (
          <button
            onClick={() => setOnlyOwed((v) => !v)}
            className={`badge ${
              onlyOwed ? "bg-bad text-white" : "bg-bad/15 text-bad hover:bg-bad/25"
            }`}
          >
            ! {t("catalog.onlyMandatory", { n: owed.size })}
          </button>
        )}
        <span className="ml-auto text-xs text-text-subtle">
          {t("courses.count", { n: shown.length })}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pageOf(shown, page).map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c)}
            className={`card group flex flex-col gap-2 text-left transition ${
              owed.has(c.id)
                ? "border-bad/60 ring-1 ring-bad/30 hover:border-bad"
                : "hover:border-accent"
            }`}
          >
            <CourseCover
              coverUrl={c.cover_url}
              provider={c.provider}
              emoji={c.emoji}
              title={c.title}
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {owed.get(c.id) && <OwedMarker owed={owed.get(c.id)!} />}
                {c.external_url && (
                  <span
                    className="badge bg-iris/15 text-iris"
                    title={t("courses.externalOn", { provider: c.provider || t("courses.external") })}
                  >
                    ↗ {c.provider || t("courses.external")}
                  </span>
                )}
              </div>
              <span className={`badge ${LEVEL[c.level] ?? "bg-edge text-text-subtle"}`}>
                {t(`common.${c.level}`, c.level)}
              </span>
            </div>
            <h3 className="font-medium group-hover:text-accent">{c.title}</h3>
            <p className="line-clamp-2 text-sm text-text-subtle">{c.summary}</p>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-1 pt-2 text-xs text-text-subtle">
              <span>{t("common.by")} {c.author}</span>
              <div className="flex gap-1">
                {c.tags.slice(0, 2).map((t) => (
                  <span key={t} className="badge bg-edge text-text-subtle">{t}</span>
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
      <Pager page={page} total={shown.length} onPage={setPage} size={PAGE_SIZE} />
      {shown.length === 0 && !error && (
        <p className="text-sm text-text-subtle">{t("courses.empty")}</p>
      )}

      {/* detail popup — click outside (or Esc) to dismiss */}
      {selected && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-lg animate-scale-in rounded-2xl border border-border bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={selected.title}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <CourseCover
                  coverUrl={selected.cover_url}
                  provider={selected.provider}
                  emoji={selected.emoji}
                  title={selected.title}
                />
              </div>
              <button className="btn-icon" aria-label={t("common.close")} onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{selected.title}</h2>
              <span className={`badge ${LEVEL[selected.level] ?? "bg-edge text-text-subtle"}`}>
                {t(`common.${selected.level}`, selected.level)}
              </span>
              {selected.external_url && (
                <span className="badge bg-iris/15 text-iris">
                  ↗ {selected.provider || t("courses.external")}
                </span>
              )}
            </div>
            {selected.summary && (
              <p className="mt-2 text-sm text-text-muted">{selected.summary}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-1">
              {selected.tags.map((t) => (
                <span key={t} className="badge bg-edge text-text-subtle">{t}</span>
              ))}
            </div>
            <p className="mt-3 text-xs text-text-subtle">
              {t("common.by")} {selected.author} ·{" "}
              {fmt.date(selected.created_at, { day: "numeric", month: "short", year: "numeric" })}
            </p>
            <div className="mt-5 flex gap-2">
              {selected.external_url ? (
                <a
                  href={selected.external_url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn flex-1 text-center"
                >
                  {selected.provider
                    ? t("courses.openOn", { provider: selected.provider })
                    : t("courses.openOnPlatform")}{" "}↗
                </a>
              ) : (
                <button className="btn flex-1" onClick={() => router.push(`/courses/${selected.id}`)}>
                  {t("courses.start")} →
                </button>
              )}
              {/* A provider course opened straight on Coursera and nothing
                  else, so L&D had no way to hand one out from the catalogue —
                  the assign panel lives on the course's own page. */}
              {canAssign && (
                <button
                  className="btn-ghost"
                  onClick={() => router.push(`/courses/${selected.id}`)}
                >
                  📌 {t("assign.short")}
                </button>
              )}
              <button className="btn-ghost" onClick={() => setSelected(null)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
