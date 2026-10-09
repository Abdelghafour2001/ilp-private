"use client";

/**
 * The report builder — group, measure, filter, save a view, and the periodic
 * PDF reports underneath it.
 *
 * It used to be its own screen beside Governance, and L&D could not tell the
 * two apart: one said "Reports", the other "Governance", and both were about
 * the organisation. They are now two tabs of the same page, and this is the
 * half that was /reports. The old route still renders it, so links and
 * bookmarks keep working.
 */
/**
 * The report builder.
 *
 * Pick a dataset, drop columns into "group by" and "measure", filter, choose a
 * chart, save it under a name. The layout follows that order left to right,
 * because it is the order the question gets asked in.
 *
 * The page runs a query on every change rather than behind an "Apply" button.
 * With aggregation happening server-side over at most a few tens of thousands
 * of rows, the round trip is faster than the deliberation, and a builder that
 * only shows you the answer after you commit is a form, not a tool.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  api,
  type DatasetColumn,
  type DatasetSummary,
  type QueryResult,
  type SavedViewOut,
} from "@/lib/api";
import { getStoredLearner } from "@/lib/learner";
import ReportChart, { type ChartKind } from "@/components/ReportChart";
import { downloadCsv, dateStamp } from "@/lib/csv";
import AccessDenied, { isForbidden } from "@/components/AccessDenied";
import PeriodicReportPanel from "@/components/PeriodicReportPanel";
import { useT } from "@/lib/i18n";

type Measure = { column: string; agg: string; label: string };
type Filter = { column: string; op: string; value: string };

const AGGS = [
  { key: "sum", label: "Somme" },
  { key: "avg", label: "Moyenne" },
  { key: "count", label: "Nombre" },
  { key: "count_distinct", label: "Nombre distinct" },
  { key: "min", label: "Min" },
  { key: "max", label: "Max" },
];

const OPS = [
  { key: "eq", label: "=" },
  { key: "ne", label: "≠" },
  { key: "contains", label: "contient" },
  { key: "gt", label: ">" },
  { key: "gte", label: "≥" },
  { key: "lt", label: "<" },
  { key: "lte", label: "≤" },
];

const CHARTS: { key: ChartKind; label: string; icon: string }[] = [
  { key: "table", label: "Tableau", icon: "▦" },
  { key: "bar", label: "Barres", icon: "▤" },
  { key: "column", label: "Colonnes", icon: "▥" },
  { key: "line", label: "Courbe", icon: "◺" },
  { key: "donut", label: "Anneau", icon: "◍" },
];

export default function ReportsWorkbench() {
  const t = useT();
  const [learnerId, setLearnerId] = useState<number | undefined>();
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [view, setView] = useState<"app" | "coursera" | "both">("app");
  const [views, setViews] = useState<SavedViewOut[]>([]);

  const [dimensions, setDimensions] = useState<string[]>([]);
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [chart, setChart] = useState<ChartKind>("bar");
  // One pager for the whole result. It used to live inside the table, which
  // left the chart drawing all 235 groups — the scroll that had no end.
  const PAGE = 25;
  const [page, setPage] = useState(0);
  // Find a person without building a filter for it. A report of 276 people is
  // a roster, and the first thing anybody does with a roster is look somebody
  // up — which was three clicks through the filter builder before.
  const [find, setFind] = useState("");

  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [shareIt, setShareIt] = useState(true);

  const dataset = datasets.find((d) => d.id === datasetId) ?? null;
  const columns: DatasetColumn[] = useMemo(() => dataset?.columns ?? [], [dataset]);
  const numeric = columns.filter((c) => c.type === "number");

  const loadDatasets = useCallback(
    async (id?: number) => {
      try {
        const res = await api.reportDatasets(id);
        setDatasets(res.datasets);
        setDatasetId((current) => current ?? res.datasets[0]?.id ?? null);
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  useEffect(() => {
    const learner = getStoredLearner();
    setLearnerId(learner?.id);
    loadDatasets(learner?.id);
  }, [loadDatasets]);

  useEffect(() => {
    if (datasetId) api.savedViews(learnerId, datasetId).then((r) => setViews(r.views)).catch(() => {});
  }, [datasetId, learnerId]);

  // Starting configuration for a freshly picked dataset: first text column
  // grouped, first numeric column summed. An empty builder shows nothing and
  // makes the user guess what it is for.
  useEffect(() => {
    if (!dataset) return;
    const text = dataset.columns.find((c) => c.type === "text");
    const num = dataset.columns.find((c) => c.type === "number");
    setDimensions(text ? [text.name] : []);
    setMeasures(
      num ? [{ column: num.name, agg: "sum", label: num.name }] : [],
    );
    setFilters([]);
  }, [dataset]);

  const runQuery = useCallback(async () => {
    if (!datasetId || measures.length === 0) {
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.runReportQuery(datasetId, {
          learner_id: learnerId,
          dimensions,
          measures,
          // A filter with no value yet is still being typed, not an empty match.
          filters: filters
            .filter((f) => f.column && f.value !== "")
            .map((f) => ({ ...f, value: coerce(f.value, columns, f.column) })),
          sort: { by: measures[0]?.label, dir: "desc" },
          limit: 1000,
        }),
      );
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [datasetId, dimensions, measures, filters, learnerId, columns]);

  useEffect(() => {
    const timer = setTimeout(runQuery, 220);
    return () => clearTimeout(timer);
  }, [runQuery]);

  /** Point the builder at the table that answers this platform, and start it
   *  on the hours for that platform rather than on an empty report. */
  function pickSource(next: "app" | "coursera" | "both", wants: string) {
    setView(next);
    const target = datasets.find((d) => d.name === wants);
    if (target && target.id !== datasetId) setDatasetId(target.id);
    setFilters([]);
    if (next === "coursera") {
      setDimensions(["BU fournisseur"]);
      setMeasures([{ column: "Heures", agg: "sum", label: "sum(Heures)" }]);
    } else {
      setDimensions(["BU"]);
      const column = next === "both" ? "Heures totales" : "Heures UpSkill";
      setMeasures([{ column, agg: "sum", label: `sum(${column})` }]);
    }
  }

  async function saveView() {
    if (!datasetId || !saveName.trim()) return;
    try {
      await api.saveReportView({
        learner_id: learnerId,
        dataset_id: datasetId,
        name: saveName.trim(),
        shared: shareIt,
        config: { dimensions, measures, filters, chart },
      });
      setSaveName("");
      const r = await api.savedViews(learnerId, datasetId);
      setViews(r.views);
    } catch (e) {
      setError(String(e));
    }
  }

  function applyView(view: SavedViewOut) {
    const c = view.config as {
      dimensions?: string[];
      measures?: Measure[];
      filters?: Filter[];
      chart?: ChartKind;
    };
    setDimensions(c.dimensions ?? []);
    setMeasures(c.measures ?? []);
    setFilters(c.filters ?? []);
    setChart(c.chart ?? "bar");
    api.markViewOpened(view.id).catch(() => {});
  }

  const matched = useMemo(() => {
    const rows = result?.rows ?? [];
    const needle = find.trim().toLowerCase();
    if (!needle) return rows;
    // Across every column: somebody typing "cyber" may mean the practice, the
    // team or a job title, and asking which would be the wrong question.
    return rows.filter((row) =>
      Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(needle)),
    );
  }, [result, find]);
  const pageCount = Math.max(1, Math.ceil(matched.length / PAGE));
  const pagedRows = useMemo(
    () => matched.slice(page * PAGE, page * PAGE + PAGE),
    [matched, page],
  );
  // A new result is a new question: start it at the top.
  useEffect(() => setPage(0), [result, find]);

  const chartRows = useMemo(() => {
    if (!result || measures.length === 0) return [];
    const label = measures[0].label;
    return pagedRows.map((row) => ({
      label: dimensions.map((d) => String(row[d] ?? "—")).join(" · ") || "Total",
      value: Number(row[label] ?? 0),
    }));
  }, [result, pagedRows, measures, dimensions]);

  async function exportRich(fmt: "xlsx" | "pdf") {
    if (!datasetId) return;
    try {
      await api.exportReport(datasetId, {
        learner_id: learnerId,
        dimensions,
        measures,
        filters: filters
          .filter((f) => f.column && f.value !== "")
          .map((f) => ({ ...f, value: coerce(f.value, columns, f.column) })),
        sort: { by: measures[0]?.label, dir: "desc" },
        limit: 500,
        fmt,
        // A table view still exports a chart-less file rather than silently
        // inventing a chart the user never chose.
        chart,
        title: saveName.trim() || `${measures[0]?.label ?? "Rapport"} par ${dimensions.join(" · ") || "total"}`,
      });
    } catch (e) {
      setError(String(e));
    }
  }

  function exportCsv() {
    if (!result) return;
    downloadCsv(
      `aida-rapport-${dateStamp()}`,
      result.rows.map((row) => {
        const out: Record<string, unknown> = {};
        dimensions.forEach((d) => (out[d] = row[d]));
        measures.forEach((m) => (out[m.label] = row[m.label]));
        return out;
      }),
    );
  }

  // A refusal is a different screen, not a red banner over an empty builder.
  if (error && isForbidden(error)) {
    return (
      <AccessDenied
        audience="access.audience.hr"
        detailKey="access.detail.reports"
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("reports.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            {t("reports.lede")}
          </p>
        </div>
      </header>

      {error && (
        <div className="card border-bad/40 text-sm text-bad" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {/* Looking somebody up is the most common thing done on this page, so the
          box for it is the first thing on it rather than a control beside the
          chart. It filters whatever the report currently holds. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-md flex-1"
          placeholder={t("reports.findPlaceholder")}
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
        {find.trim() && result && (
          <span className="text-xs text-text-subtle">
            {t("reports.matching", { n: matched.length, total: result.rows.length })}
          </span>
        )}
        {find.trim() && (
          <button className="text-xs text-text-subtle hover:text-text" onClick={() => setFind("")}>
            ✕ {t("common.reset")}
          </button>
        )}
      </div>

      <div className="space-y-1">
        <h2 className="font-semibold">🔎 {t("reports.builder")}</h2>
        <p className="text-sm text-text-muted">{t("reports.builderHint")}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* ----------------------------------------------------- sidebar -- */}
        <aside className="space-y-4">
          <section className="card space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
              {t("reports.dataset")}
            </h2>
            {/* The same three-way choice the analytics screen offers, here as a
                shortcut over the dataset list: most people arrive knowing which
                platform they want to look at, not which table holds it. */}
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
              {(
                [
                  ["app", `📊 ${t("org.view.app")}`, "Collaborators"],
                  ["coursera", `🎓 ${t("org.view.coursera")}`, "Coursera"],
                  ["both", `🔀 ${t("org.view.both")}`, "Collaborators"],
                ] as const
              ).map(([value, label, wants]) => (
                <button
                  key={value}
                  onClick={() => pickSource(value, wants)}
                  className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                    view === value
                      ? "bg-accent/15 text-accent-text"
                      : "text-text-subtle hover:text-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              className="input w-full"
              value={datasetId ?? ""}
              onChange={(e) => setDatasetId(Number(e.target.value))}
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.kind === "builtin" ? "◆ " : "⬆ "}
                  {d.name} ({d.row_count})
                </option>
              ))}
            </select>
            {dataset && (
              <p className="text-xs text-text-subtle">
                {dataset.description || dataset.source_filename}
                {dataset.owner && ` · ${dataset.owner}`}
              </p>
            )}
          </section>

          <FieldBox
            title={t("reports.groupBy")}
            hint="Les lignes du rapport"
            options={columns.map((c) => c.name)}
            selected={dimensions}
            onToggle={(name) =>
              setDimensions((d) =>
                d.includes(name) ? d.filter((x) => x !== name) : [...d, name].slice(0, 4),
              )
            }
          />

          <section className="card space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
              {t("reports.measure")}
            </h2>
            {measures.map((m, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <select
                  className="input min-w-0 flex-1 text-xs"
                  value={m.column}
                  onChange={(e) =>
                    setMeasures((ms) =>
                      ms.map((x, j) =>
                        j === i ? { ...x, column: e.target.value, label: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input w-28 text-xs"
                  value={m.agg}
                  onChange={(e) =>
                    setMeasures((ms) =>
                      ms.map((x, j) => (j === i ? { ...x, agg: e.target.value } : x)),
                    )
                  }
                >
                  {AGGS.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-ghost btn-sm shrink-0"
                  aria-label={t("reports.removeMeasure")}
                  onClick={() => setMeasures((ms) => ms.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="btn-soft btn-sm w-full"
              disabled={columns.length === 0 || measures.length >= 6}
              onClick={() => {
                const next = numeric[0] ?? columns[0];
                if (next)
                  setMeasures((ms) => [
                    ...ms,
                    { column: next.name, agg: next.type === "number" ? "sum" : "count", label: next.name },
                  ]);
              }}
            >
              + Ajouter une mesure
            </button>
          </section>

          <section className="card space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
              {t("reports.filters")}
            </h2>
            {filters.map((f, i) => (
              <div key={i} className="space-y-1.5 rounded-lg bg-surface-2 p-2">
                <div className="flex items-center gap-1.5">
                  <select
                    className="input min-w-0 flex-1 text-xs"
                    value={f.column}
                    onChange={(e) =>
                      setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))
                    }
                  >
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input w-20 text-xs"
                    value={f.op}
                    onChange={(e) =>
                      setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))
                    }
                  >
                    {OPS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-ghost btn-sm shrink-0"
                    aria-label={t("reports.removeFilter")}
                    onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
                <input
                  className="input w-full text-xs"
                  placeholder="valeur"
                  value={f.value}
                  onChange={(e) =>
                    setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                  }
                />
              </div>
            ))}
            <button
              className="btn-soft btn-sm w-full"
              disabled={columns.length === 0}
              onClick={() =>
                setFilters((fs) => [...fs, { column: columns[0].name, op: "eq", value: "" }])
              }
            >
              + Ajouter un filtre
            </button>
          </section>

          {views.length > 0 && (
            <section className="card space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
                {t("reports.savedViews")}
              </h2>
              <ul className="space-y-1">
                {views.map((v) => (
                  <li key={v.id} className="flex items-center gap-1.5">
                    <button
                      className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2"
                      onClick={() => applyView(v)}
                      title={`${v.name} — ${v.owner}`}
                    >
                      {v.shared ? "🌍" : "🔒"} {v.name}
                    </button>
                    {v.mine && (
                      <button
                        className="btn-ghost btn-sm shrink-0"
                        aria-label={t("reports.deleteView")}
                        onClick={async () => {
                          await api.deleteReportView(v.id, learnerId);
                          setViews((vs) => vs.filter((x) => x.id !== v.id));
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        {/* -------------------------------------------------------- canvas -- */}
        <div className="space-y-4">
          <div className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-0.5">
                {CHARTS.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setChart(c.key)}
                    aria-pressed={chart === c.key}
                    title={c.label}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      chart === c.key ? "bg-accent text-accent-fg" : "text-text-subtle hover:text-text"
                    }`}
                  >
                    <span aria-hidden>{c.icon}</span> {c.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs text-text-subtle">
                {busy && <span>{t("reports.calculating")}</span>}
                {result && (
                  <span>
                    {result.group_count} groupe{result.group_count > 1 ? "s" : ""} ·{" "}
                    {result.totals._rows} ligne{result.totals._rows > 1 ? "s" : ""}
                  </span>
                )}
                <button className="btn-ghost btn-sm" disabled={!result} onClick={exportCsv}>
                  ⬇ CSV
                </button>
                {/* Excel and PDF carry the chart; CSV is the raw numbers for
                    whoever wants to do their own thing with them. */}
                <button className="btn-ghost btn-sm" disabled={!result} onClick={() => exportRich("xlsx")}>
                  ⬇ Excel
                </button>
                <button className="btn-ghost btn-sm" disabled={!result} onClick={() => exportRich("pdf")}>
                  ⬇ PDF
                </button>
              </div>
            </div>

            {result && measures.length > 0 ? (
              chart === "table" ? (
                <ResultTable rows={pagedRows} dimensions={dimensions} measures={measures} />
              ) : (
                <ReportChart kind={chart} rows={chartRows} measureLabel={measures[0].label} />
              )
            ) : (
              <p className="py-12 text-center text-sm text-text-subtle">
                {t("reports.needMeasure")}
              </p>
            )}

            {result && measures.length > 0 && pageCount > 1 && (
              <div className="flex items-center justify-between border-t border-edge pt-2 text-sm">
                <button
                  className="btn-ghost btn-sm disabled:opacity-40"
                  disabled={page === 0}
                  onClick={() => setPage((n) => Math.max(0, n - 1))}
                >
                  ←
                </button>
                <span className="tabular-nums text-text-subtle">
                  {page * PAGE + 1}–{Math.min(matched.length, (page + 1) * PAGE)} /{" "}
                  {matched.length} · {t("reports.page", { n: page + 1, of: pageCount })}
                </span>
                <button
                  className="btn-ghost btn-sm disabled:opacity-40"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((n) => Math.min(pageCount - 1, n + 1))}
                >
                  →
                </button>
              </div>
            )}

            {result && result.truncated && (
              <p className="text-xs text-warn">
                Affichage limité aux {result.rows.length} premiers groupes — les totaux
                ci-dessous portent sur l&apos;ensemble.
              </p>
            )}
          </div>

          {result && measures.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {measures.map((m) => (
                <div key={m.label} className="card">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                    {AGGS.find((a) => a.key === m.agg)?.label} · {m.column}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {result.totals[m.label] === null || result.totals[m.label] === undefined
                      ? "—"
                      : Number(result.totals[m.label]).toLocaleString("fr-FR")}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="card flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
                {t("reports.saveView")}
              </label>
              <input
                className="input mt-1 w-full"
                placeholder={t("reports.namePlaceholder")}
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={shareIt}
                onChange={(e) => setShareIt(e.target.checked)}
              />
              Partager avec l&apos;équipe RH
            </label>
            <button className="btn" disabled={!saveName.trim()} onClick={saveView}>
              {t("common.save")}
            </button>
          </div>
        </div>
      </div>

      {/* The ready-made reports, folded away under the builder: it is the
          occasional job — one PDF a month — and open it pushed the thing
          people come here for down the page. */}
      <PeriodicReportPanel />
    </div>
  );
}

function FieldBox({
  title,
  hint,
  options,
  selected,
  onToggle,
}: {
  title: string;
  hint: string;
  options: string[];
  selected: string[];
  onToggle: (name: string) => void;
}) {
  return (
    <section className="card space-y-2">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">{title}</h2>
        <p className="text-[11px] text-text-subtle">{hint}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((name) => {
          const on = selected.includes(name);
          return (
            <button
              key={name}
              onClick={() => onToggle(name)}
              aria-pressed={on}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                on
                  ? "border-accent bg-accent/15 font-medium text-accent-text"
                  : "border-border text-text-subtle hover:text-text"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ResultTable({
  rows,
  dimensions,
  measures,
}: {
  /** Already the current page: the pager lives on the screen, not in here,
   *  so the chart and the table always show the same slice. */
  rows: Record<string, unknown>[];
  dimensions: string[];
  measures: Measure[];
}) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-subtle">
            {dimensions.map((d) => (
              <th key={d} className="py-2 pr-4 font-semibold">
                {d}
              </th>
            ))}
            {measures.map((m) => (
              <th key={m.label} className="py-2 pr-4 text-right font-semibold">
                {m.label}
              </th>
            ))}
            <th className="py-2 text-right font-semibold">{t("reports.rows")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {dimensions.map((d) => (
                <td key={d} className="py-1.5 pr-4">
                  {cell(row, d)}
                </td>
              ))}
              {measures.map((m) => (
                <td key={m.label} className="py-1.5 pr-4 text-right tabular-nums">
                  {row[m.label] === null || row[m.label] === undefined
                    ? "—"
                    : Number(row[m.label]).toLocaleString("fr-FR")}
                </td>
              ))}
              <td className="py-1.5 text-right tabular-nums text-text-subtle">
                {String(row._rows ?? "")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Columns that name a person, and the column that carries the address their
 *  record is keyed by. Grouping by somebody should let you open them. */
const PERSON_COLUMNS = ["Collaborateur", "Personne", "Email"];

function cell(row: Record<string, unknown>, column: string) {
  const value = row[column];
  if (value === null || value === undefined) return "—";
  if (!PERSON_COLUMNS.includes(column)) return String(value);

  // The record lives under the provider address. When the report groups by
  // name rather than email, look for an email on the same row; without one
  // there is nothing to open, so the name stays plain text.
  const email = String(row["Email"] ?? (column === "Email" ? value : "")).trim();
  if (!email.includes("@")) return String(value);
  return (
    <Link href={`/people/${encodeURIComponent(email)}`} className="hover:text-accent">
      {String(value)}
    </Link>
  );
}

/** A filter typed as text has to match the column's real type, or "= 2025"
 *  against a number column silently matches nothing. */
function coerce(value: string, columns: DatasetColumn[], column: string) {
  const type = columns.find((c) => c.name === column)?.type;
  if (type === "number") {
    const n = Number(value.replace(",", ".").replace(/\s/g, ""));
    return Number.isFinite(n) ? n : value;
  }
  return value;
}
