/** Circular XP→level progress ring. Pure SVG, theme-aware via currentColor + tokens. */
export default function LevelRing({
  level,
  pct,
  size = 72,
  stroke = 7,
  label,
}: {
  level: number;
  pct: number;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * c;

  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="text-surface-3"
          stroke="currentColor"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke="rgb(var(--accent))"
          strokeDasharray={`${dash} ${c}`}
          style={{ transition: "stroke-dasharray 0.6s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">
        <div>
          <p className="font-mono text-lg font-semibold tnum text-text">{level}</p>
          <p className="text-[9px] font-medium uppercase tracking-wide text-text-subtle">
            {label ?? "Lvl"}
          </p>
        </div>
      </div>
    </div>
  );
}
