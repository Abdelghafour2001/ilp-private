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
import Icon from "@/components/Icon";
import Modal from "@/components/Modal";
import { getStoredLearner } from "@/lib/learner";
import { useFormat, useT } from "@/lib/i18n";

const LEVEL_DOT: Record<string, string> = {
  beginner: "bg-good",
  intermediate: "bg-warn",
  advanced: "bg-bad",
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

  // What this person owes, lifted to the top of whatever the filters left.
  const shown = mandatoryFirst(courses, owed, onlyOwed);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">{t("courses.title")}</h1>
          <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-text-muted">{t("courses.subtitle")}</p>
        </div>
        <Link href="/courses/new" className="btn shrink-0">
          <Icon name="plus" size={16} aria-hidden="true" /> {t("courses.new")}
        </Link>
      </header>

      {error && <div className="card border-bad/40 text-sm text-bad">{error}</div>}

      <div className="sticky top-16 z-10 -mx-4 flex flex-wrap items-center gap-2 border-b border-border bg-bg/85 px-4 py-3 backdrop-blur-md md:-mx-8 md:px-8">
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">{t("courses.searchPlaceholder")}</span>
          <Icon
            name="search"
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
          />
          <input
            className="input pl-9"
            type="search"
            name="q"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("courses.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        {/* Subject first: it is what people actually browse by. Then where it
            came from, how hard it is, and which journey it belongs to. */}
        <select
          className="input w-auto max-w-[13rem]"
          aria-label={t("courses.allDomains")}
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
          className="input w-auto max-w-[13rem]"
          aria-label={t("courses.allProviders")}
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
          className="input w-auto max-w-[13rem]"
          aria-label={t("courses.allLevels")}
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
          className="input w-auto max-w-[13rem]"
          aria-label={t("courses.allPathways")}
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
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-text-subtle hover:bg-surface-2 hover:text-text"
            onClick={() => setFilters({ domain: "", provider: "", level: "", pathway: "" })}
          >
            <Icon name="x" size={13} aria-hidden="true" /> {t("common.reset")}
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
        <span className="ml-auto text-xs text-text-subtle tnum" aria-live="polite">
          {t("courses.count", { n: shown.length })}
        </span>
      </div>

      <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {pageOf(shown, page).map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c)}
            className="group flex flex-col rounded-xl text-left"
          >
            <div
              className={`relative w-full overflow-hidden rounded-xl border transition-[border-color,box-shadow,transform] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md ${
                owed.has(c.id)
                  ? "border-bad/60 ring-1 ring-bad/30"
                  : "border-border group-hover:border-border-strong"
              }`}
            >
              <CourseCover
                coverUrl={c.cover_url}
                provider={c.provider}
                emoji={c.emoji}
                className="aspect-[16/9] rounded-none"
              />
              {owed.get(c.id) && (
                <span className="absolute left-3 top-3">
                  <OwedMarker owed={owed.get(c.id)!} />
                </span>
              )}
            </div>
            <div className="mt-3.5 flex items-center gap-1.5 text-xs text-text-subtle">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${LEVEL_DOT[c.level] ?? "bg-text-subtle"}`} aria-hidden="true" />
              <span className="capitalize">{t(`common.${c.level}`, c.level)}</span>
              {c.external_url && (
                <>
                  <span aria-hidden="true">·</span>
                  <span title={t("courses.externalOn", { provider: c.provider || t("courses.external") })}>
                    {c.provider || t("courses.external")} ↗
                  </span>
                </>
              )}
              {c.external_hours > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tnum">{c.external_hours}&nbsp;h</span>
                </>
              )}
            </div>
            <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-text group-hover:text-accent-text">
              {c.title}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-text-muted">{c.summary}</p>
            <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-3 text-xs text-text-subtle">
              <span>{t("common.by")} {c.author}</span>
              {c.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                  {tag}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
      <Pager page={page} total={shown.length} onPage={setPage} size={PAGE_SIZE} />
      {shown.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
          <Icon name="search" size={22} aria-hidden="true" className="mx-auto text-text-subtle" />
          <p className="mt-3 text-sm text-text-muted">{t("courses.empty")}</p>
          {Object.values(filters).some(Boolean) && (
            <button
              className="btn-ghost btn-sm mt-4"
              onClick={() => setFilters({ domain: "", provider: "", level: "", pathway: "" })}
            >
              {t("common.reset")}
            </button>
          )}
        </div>
      )}

      {selected && (
        <Modal
          title={selected.title}
          lede={selected.summary || undefined}
          onClose={() => setSelected(null)}
          size="sm"
          footer={
            <>
              {/* A provider course opened straight on Coursera and nothing
                  else, so L&D had no way to hand one out from the catalogue —
                  the assign panel lives on the course's own page. */}
              {canAssign && (
                <button className="btn-ghost" onClick={() => router.push(`/courses/${selected.id}`)}>
                  {t("assign.short")}
                </button>
              )}
              {selected.external_url ? (
                <a href={selected.external_url} target="_blank" rel="noreferrer" className="btn">
                  {selected.provider
                    ? t("courses.openOn", { provider: selected.provider })
                    : t("courses.openOnPlatform")}{" "}
                  <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <button className="btn" onClick={() => router.push(`/courses/${selected.id}`)}>
                  {t("courses.start")} <Icon name="arrow-right" size={15} aria-hidden="true" />
                </button>
              )}
            </>
          }
        >
          <div className="overflow-hidden rounded-xl border border-border">
            <CourseCover
              coverUrl={selected.cover_url}
              provider={selected.provider}
              emoji={selected.emoji}
              className="aspect-[2/1] rounded-none"
            />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-text-subtle">{t("courses.level", "Level")}</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-medium capitalize">
                <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[selected.level] ?? "bg-text-subtle"}`} aria-hidden="true" />
                {t(`common.${selected.level}`, selected.level)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-subtle">{t("courses.author", "Author")}</dt>
              <dd className="mt-0.5 truncate font-medium">{selected.author}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-subtle">{t("courses.added", "Added")}</dt>
              <dd className="mt-0.5 font-medium tnum">
                {fmt.date(selected.created_at, { day: "numeric", month: "short", year: "numeric" })}
              </dd>
            </div>
          </dl>
          {selected.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.tags.map((tag) => (
                <span key={tag} className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
