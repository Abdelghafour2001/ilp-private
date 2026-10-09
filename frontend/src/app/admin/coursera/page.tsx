"use client";

/**
 * Coursera — the admin screen the backend always had endpoints for.
 *
 * Two independent halves, because they need different things:
 * - the public catalogue needs no credentials: preview a course by its slug and
 *   import it with its real cover art and workload;
 * - enterprise sync needs a Coursera for Business contract: pull who enrolled
 *   and how far they got, which feeds the HR hours and, for completions with a
 *   certificate, the Certifications page.
 *
 * The unmatched list is the number to watch: those are people whose Coursera
 * account does not use their corporate email, so their learning is invisible
 * to HR until it does.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AccessDenied, { isForbidden } from "@/components/AccessDenied";
import {
  api,
  type CourseraCatalogPage,
  type CourseraLookup,
  type CourseraStatus,
  type CourseraSyncResult,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Accepts a bare slug or any coursera.org/learn/<slug> URL. */
function toSlug(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/coursera\.org\/learn\/([^/?#]+)/i);
  return (match ? match[1] : trimmed).replace(/^\/+|\/+$/g, "");
}

export default function CourseraAdminPage() {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<CourseraStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [slugInput, setSlugInput] = useState("");
  const [preview, setPreview] = useState<CourseraLookup | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // Browsing the catalogue, as opposed to knowing the slug you want.
  const [browseQuery, setBrowseQuery] = useState("");
  const [catalog, setCatalog] = useState<CourseraCatalogPage | null>(null);
  const [cursor, setCursor] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const [syncBusy, setSyncBusy] = useState(false);
  const [sync, setSync] = useState<CourseraSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadStatus = useCallback(() => {
    api
      .courseraStatus()
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(loadStatus, [loadStatus]);

  async function lookup() {
    const slug = toSlug(slugInput);
    if (!slug) return;
    setLookupBusy(true);
    setPreview(null);
    setImportMsg(null);
    try {
      setPreview(await api.courseraLookup(slug));
    } catch (e) {
      setImportMsg(String((e as Error).message ?? e));
    } finally {
      setLookupBusy(false);
    }
  }

  async function browse(start: number) {
    setBrowsing(true);
    setError(null);
    try {
      const page = await api.courseraCatalog(browseQuery.trim(), start);
      setCatalog(page);
      setCursor(start);
      setPicked(new Set());
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBrowsing(false);
    }
  }

  async function importPicked() {
    if (!picked.size) return;
    setBrowsing(true);
    try {
      const r = await api.courseraImport([...picked]);
      setImportMsg(
        t("coursera.importedCount", { n: r.imported.length + r.updated.length }),
      );
      setPicked(new Set());
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBrowsing(false);
    }
  }

  function toggle(slug: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function importCourse() {
    if (!preview) return;
    setLookupBusy(true);
    try {
      const r = await api.courseraImport([preview.slug]);
      setImportMsg(
        r.imported.length
          ? t("coursera.imported", { title: r.imported[0] })
          : r.updated.length
            ? t("coursera.updated", { title: r.updated[0] })
            : t("coursera.notFound"),
      );
      setPreview(null);
      setSlugInput("");
    } catch (e) {
      setImportMsg(String((e as Error).message ?? e));
    } finally {
      setLookupBusy(false);
    }
  }

  async function importEnrolled() {
    setLookupBusy(true);
    setImportMsg(null);
    try {
      const r = await api.courseraImportEnrolled(25);
      setImportMsg(
        t("coursera.importEnrolledDone", {
          imported: r.imported.length,
          updated: r.updated.length,
          considered: r.considered,
        }),
      );
    } catch (e) {
      setImportMsg(String((e as Error).message ?? e));
    } finally {
      setLookupBusy(false);
    }
  }

  async function runSync() {
    setSyncBusy(true);
    setSyncError(null);
    setSync(null);
    try {
      setSync(await api.courseraSync());
      loadStatus();
    } catch (e) {
      setSyncError(String((e as Error).message ?? e));
    } finally {
      setSyncBusy(false);
    }
  }

  if (error && isForbidden(error)) {
    return (
      <AccessDenied
        audience="access.audience.admin"
        detailKey="access.detail.admin"
        backHref="/admin"
      />
    );
  }

  const reporting = status?.reporting;
  const live = reporting?.mode === "live";
  const modeTone =
    reporting?.mode === "live"
      ? "bg-good/15 text-good"
      : reporting?.mode === "mock"
        ? "bg-warn/15 text-warn"
        : "bg-edge text-text-subtle";
  const lastSync = reporting?.last_synced_at
    ? new Date(reporting.last_synced_at).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB")
    : t("coursera.never");

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <Link href="/admin" className="text-sm text-text-subtle hover:text-text">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold">Coursera</h1>
        <p className="text-sm text-text-muted">{t("coursera.lede")}</p>
      </header>

      {error && <p className="card text-sm text-bad">{error}</p>}

      {/* enterprise sync */}
      <section className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">{t("coursera.syncTitle")}</h2>
            <p className="text-sm text-text-muted">{t("coursera.syncHint")}</p>
          </div>
          {reporting && (
            <span className={`badge ${modeTone}`}>
              {t("coursera.mode")}: {reporting.mode}
            </span>
          )}
        </div>

        {reporting && (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-4">
            {[
              [t("coursera.credentials"), reporting.configured ? t("coursera.set") : t("coursera.missing")],
              [t("coursera.enrollments"), String(reporting.enrollments)],
              [t("coursera.unmatched"), String(reporting.unmatched)],
              [t("coursera.lastSync"), lastSync],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs uppercase tracking-wide text-text-subtle">{k}</dt>
                <dd className="text-sm font-medium tnum">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {reporting && !live && (
          <p className="text-sm text-text-muted">
            {reporting.mode === "mock" ? t("coursera.mockNote") : t("coursera.offNote")}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn"
            onClick={runSync}
            disabled={syncBusy || !reporting || reporting.mode === "off"}
          >
            {syncBusy ? t("coursera.syncing") : t("coursera.syncNow")}
          </button>
          <span className="text-xs text-text-subtle">{t("coursera.nightly")}</span>
        </div>

        {syncError && <p className="text-sm text-bad">{syncError}</p>}

        {sync && (
          <div className="space-y-3 rounded-xl border border-border p-4">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
              {[
                [t("coursera.created"), sync.created],
                [t("coursera.updatedCount"), sync.updated],
                [t("coursera.matched"), sync.matched_learners],
                [t("coursera.unmatched"), sync.unmatched],
                [t("coursera.certificates"), sync.certificates_recorded],
                [
                  t("coursera.hours"),
                  `${sync.measured_hours} h ${t("coursera.measured")} · ${sync.estimated_hours} h ${t("coursera.estimated")}`,
                ],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <dt className="text-xs uppercase tracking-wide text-text-subtle">{k}</dt>
                  <dd className="text-sm font-medium tnum">{v}</dd>
                </div>
              ))}
            </dl>
            {sync.unmatched_emails.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">{t("coursera.unmatchedTitle")}</p>
                <p className="text-xs text-text-muted">{t("coursera.unmatchedHint")}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {sync.unmatched_emails.map((email) => (
                    <li key={email} className="chip font-mono text-xs">
                      {email}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* catalogue import */}
      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">{t("coursera.catalogTitle")}</h2>
          <p className="text-sm text-text-muted">{t("coursera.catalogHint")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-ghost" onClick={importEnrolled} disabled={lookupBusy}>
            {t("coursera.importEnrolled")}
          </button>
          <span className="text-xs text-text-subtle">{t("coursera.importEnrolledHint")}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            className="input max-w-md"
            placeholder="https://www.coursera.org/learn/machine-learning"
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
          />
          <button className="btn-ghost" onClick={lookup} disabled={lookupBusy || !slugInput.trim()}>
            {t("coursera.preview")}
          </button>
        </div>

        {/* Browse, as opposed to already knowing the slug. Coursera's catalogue
            API has no text search, so the query is matched by our backend over
            the pages it pulls — the footer says how many it read. */}
        <div className="space-y-3 border-t border-edge pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input max-w-sm"
              placeholder={t("coursera.browsePlaceholder")}
              value={browseQuery}
              onChange={(e) => setBrowseQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && browse(0)}
            />
            <button className="btn-ghost" onClick={() => browse(0)} disabled={browsing}>
              {browsing ? t("coursera.browsing") : t("coursera.browse")}
            </button>
            {picked.size > 0 && (
              <button className="btn" onClick={importPicked} disabled={browsing}>
                {t("coursera.importPicked", { n: picked.size })}
              </button>
            )}
          </div>

          {catalog && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {catalog.items.map((c) => (
                  <label
                    key={c.slug}
                    className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                      picked.has(c.slug) ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={picked.has(c.slug)}
                      onChange={() => toggle(c.slug)}
                    />
                    <div className="min-w-0 space-y-1">
                      <p className="line-clamp-2 text-sm font-medium">{c.title}</p>
                      <p className="text-[11px] text-text-subtle">
                        {[c.partners.join(", "), c.workload].filter(Boolean).join(" · ") || "—"}
                      </p>
                      <p className="line-clamp-2 text-xs text-text-muted">{c.summary}</p>
                    </div>
                  </label>
                ))}
                {catalog.items.length === 0 && (
                  <p className="text-sm text-text-subtle">{t("coursera.browseNone")}</p>
                )}
              </div>

              <div className="flex items-center justify-between text-xs text-text-subtle">
                <button
                  className="btn-ghost btn-sm disabled:opacity-40"
                  disabled={browsing || cursor === 0}
                  onClick={() => browse(Math.max(0, cursor - 400))}
                >
                  ←
                </button>
                <span>
                  {t("coursera.browseScanned", { n: catalog.scanned })}
                  {catalog.search_is_local && ` · ${t("coursera.browseLocal")}`}
                </span>
                <button
                  className="btn-ghost btn-sm disabled:opacity-40"
                  disabled={browsing || catalog.exhausted}
                  onClick={() => browse(catalog.next_start)}
                >
                  →
                </button>
              </div>
            </>
          )}
        </div>

        {preview && (
          <div className="flex flex-wrap gap-4 rounded-xl border border-border p-4">
            {preview.cover_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.cover_url}
                alt=""
                className="h-24 w-40 shrink-0 rounded-lg object-cover"
              />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-semibold">{preview.title}</p>
              <p className="text-xs text-text-subtle">
                {[preview.partners.join(", "), preview.workload].filter(Boolean).join(" · ")}
              </p>
              <p className="line-clamp-3 text-sm text-text-muted">{preview.summary}</p>
              <button className="btn btn-sm mt-2" onClick={importCourse} disabled={lookupBusy}>
                {t("coursera.import")}
              </button>
            </div>
          </div>
        )}

        {importMsg && <p className="text-sm text-text-muted">{importMsg}</p>}
      </section>
    </div>
  );
}
