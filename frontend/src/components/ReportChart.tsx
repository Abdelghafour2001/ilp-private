"use client";

/**
 * Bar, column, line and donut, drawn as plain SVG.
 *
 * No charting library on purpose: adding one means a dependency install and an
 * image rebuild in this container setup, and four chart types over a single
 * numeric series is a hundred lines of arithmetic. The trade would be worth it
 * for stacked series, dual axes or brushing — none of which the builder offers.
 *
 * Every colour comes from the theme tokens, so the charts follow light and dark
 * with the rest of the page instead of burning in a palette that only works on
 * one ground.
 */

import { useId } from "react";

export type ChartKind = "table" | "bar" | "column" | "line" | "donut";

export interface ChartRow {
  label: string;
  value: number;
}

/** Distinct enough to tell apart, and all legible on both grounds. */
const SERIES = [
  "rgb(var(--chart-1))",
  "rgb(var(--chart-2))",
  "rgb(var(--chart-3))",
  "rgb(var(--chart-4))",
  "rgb(var(--chart-5))",
  "rgb(var(--chart-6))",
];

const fmt = (n: number) =>
  Math.abs(n) >= 1000
    ? n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })
    : String(Math.round(n * 100) / 100);

/** A label that fits: long BU names otherwise collide with their neighbours. */
const clip = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

export default function ReportChart({
  kind,
  rows,
  measureLabel,
  height = 320,
}: {
  kind: ChartKind;
  rows: ChartRow[];
  measureLabel: string;
  height?: number;
}) {
  const gradientId = useId();
  const data = rows.filter((r) => Number.isFinite(r.value));

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-text-subtle">
        Rien à tracer — ajoutez une mesure numérique.
      </p>
    );
  }

  if (kind === "donut") return <Donut rows={data} />;
  if (kind === "bar") return <HorizontalBars rows={data} measureLabel={measureLabel} />;
  return (
    <Cartesian
      rows={data}
      kind={kind === "line" ? "line" : "column"}
      measureLabel={measureLabel}
      height={height}
      gradientId={gradientId}
    />
  );
}

/* ------------------------------------------------------------------ bars -- */
/* Horizontal bars are the honest default for categories: a long BU name gets
   a whole row of width instead of being rotated 45° under a column.          */
function HorizontalBars({
  rows,
  measureLabel,
}: {
  rows: ChartRow[];
  measureLabel: string;
}) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <div className="flex flex-col gap-2 py-2">
      {rows.map((row, i) => (
        <div key={`${row.label}-${i}`} className="grid grid-cols-[minmax(90px,26%)_1fr_auto] items-center gap-3">
          <span className="truncate text-xs text-text-muted" title={row.label}>
            {row.label || "—"}
          </span>
          <span className="h-5 overflow-hidden rounded-sm bg-surface-2">
            <span
              className="block h-full rounded-sm transition-[width] duration-500"
              style={{
                width: `${Math.max(1.5, (Math.abs(row.value) / max) * 100)}%`,
                background: SERIES[i % SERIES.length],
              }}
            />
          </span>
          <span className="tabular-nums text-xs font-semibold" title={measureLabel}>
            {fmt(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- columns + line -- */
function Cartesian({
  rows,
  kind,
  measureLabel,
  height,
  gradientId,
}: {
  rows: ChartRow[];
  kind: "column" | "line";
  measureLabel: string;
  height: number;
  gradientId: string;
}) {
  // The viewBox leaves room for the axis labels; without the padding the
  // outermost tick and the last category label render outside the drawing.
  const W = 720;
  const H = height;
  const PAD = { top: 16, right: 16, bottom: 46, left: 56 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = rows.map((r) => r.value);
  const rawMax = Math.max(...values, 0);
  const rawMin = Math.min(...values, 0);
  // Round the top up to something a person would write on an axis.
  const step = niceStep((rawMax - rawMin) / 4 || 1);
  const max = Math.ceil(rawMax / step) * step || step;
  const min = Math.floor(rawMin / step) * step;
  const span = max - min || 1;

  const y = (v: number) => PAD.top + plotH - ((v - min) / span) * plotH;
  const bandWidth = plotW / rows.length;
  const cx = (i: number) => PAD.left + bandWidth * (i + 0.5);

  const ticks: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));

  const points = rows.map((r, i) => `${cx(i)},${y(r.value)}`).join(" ");
  const area = `M ${PAD.left},${y(Math.max(min, 0))} L ${rows
    .map((r, i) => `${cx(i)},${y(r.value)}`)
    .join(" L ")} L ${PAD.left + plotW},${y(Math.max(min, 0))} Z`;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[520px]"
        role="img"
        aria-label={`${measureLabel} par catégorie`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--chart-1))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(var(--chart-1))" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={y(t)}
              y2={y(t)}
              stroke="rgb(var(--border))"
              strokeWidth={t === 0 ? 1.5 : 1}
              strokeDasharray={t === 0 ? undefined : "3 4"}
            />
            <text
              x={PAD.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize="11"
              fill="rgb(var(--label))"
            >
              {fmt(t)}
            </text>
          </g>
        ))}

        {kind === "column"
          ? rows.map((r, i) => {
              const barW = Math.max(6, Math.min(46, bandWidth * 0.6));
              const top = Math.min(y(r.value), y(0));
              const barH = Math.max(1, Math.abs(y(r.value) - y(0)));
              return (
                <rect
                  key={`${r.label}-${i}`}
                  x={cx(i) - barW / 2}
                  y={top}
                  width={barW}
                  height={barH}
                  rx="3"
                  fill={SERIES[i % SERIES.length]}
                >
                  <title>{`${r.label}: ${fmt(r.value)}`}</title>
                </rect>
              );
            })
          : (
            <>
              <path d={area} fill={`url(#${gradientId})`} />
              <polyline
                points={points}
                fill="none"
                stroke="rgb(var(--chart-1))"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {rows.map((r, i) => (
                <circle key={`${r.label}-${i}`} cx={cx(i)} cy={y(r.value)} r="3.5" fill="rgb(var(--chart-1))">
                  <title>{`${r.label}: ${fmt(r.value)}`}</title>
                </circle>
              ))}
            </>
          )}

        {rows.map((r, i) => (
          <text
            key={`lbl-${r.label}-${i}`}
            x={cx(i)}
            y={H - 16}
            textAnchor="middle"
            fontSize="11"
            fill="rgb(var(--label))"
          >
            {clip(r.label || "—", Math.max(6, Math.floor(bandWidth / 7)))}
            <title>{r.label}</title>
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ----------------------------------------------------------------- donut -- */
function Donut({ rows }: { rows: ChartRow[] }) {
  const positive = rows.filter((r) => r.value > 0);
  const total = positive.reduce((s, r) => s + r.value, 0);
  if (total <= 0) {
    return (
      <p className="py-10 text-center text-sm text-text-subtle">
        Un anneau a besoin de valeurs positives.
      </p>
    );
  }

  const R = 78;
  const STROKE = 30;
  const circumference = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center justify-center gap-8 py-3">
      <svg viewBox="0 0 200 200" className="h-48 w-48 shrink-0" role="img">
        <g transform="rotate(-90 100 100)">
          {positive.map((row, i) => {
            const share = row.value / total;
            const dash = share * circumference;
            const el = (
              <circle
                key={`${row.label}-${i}`}
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={SERIES[i % SERIES.length]}
                strokeWidth={STROKE}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${row.label}: ${fmt(row.value)} (${Math.round(share * 100)}%)`}</title>
              </circle>
            );
            offset += dash;
            return el;
          })}
        </g>
        <text x="100" y="96" textAnchor="middle" fontSize="15" fontWeight="700" fill="rgb(var(--text))">
          {fmt(total)}
        </text>
        <text x="100" y="114" textAnchor="middle" fontSize="10" fill="rgb(var(--label))">
          total
        </text>
      </svg>

      <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto text-xs">
        {positive.map((row, i) => (
          <li key={`${row.label}-${i}`} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: SERIES[i % SERIES.length] }}
            />
            <span className="truncate" title={row.label}>
              {row.label || "—"}
            </span>
            <span className="ml-auto shrink-0 tabular-nums font-semibold">
              {Math.round((row.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 1, 2, 5, 10, 20, 50… — the numbers people actually put on an axis. */
function niceStep(rough: number) {
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rough) || 1)));
  const scaled = rough / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}
