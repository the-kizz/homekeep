'use client';

/**
 * CoverageRing (03-02 Plan, D-15, VIEW-05, SPEC §8.1).
 *
 * Pure display primitive — hand-rolled SVG. Uses the "radius 16 ⇒
 * circumference ≈ 100" trick so that `stroke-dashoffset = 100 - clamped`
 * is a direct percentage mapping (no math per pixel). The SVG is
 * `-rotate-90` so the filled arc begins at the 12 o'clock position and
 * sweeps clockwise (Pitfall 9).
 *
 * Motion policy (RESEARCH §Reduced-motion):
 *   - `motion-safe:` prefix makes the transition conditional on
 *     `prefers-reduced-motion: no-preference`. Users with reduced
 *     motion enabled see an instant snap to the final dashoffset.
 *
 * Accessibility:
 *   - `role="img"` + `aria-label="Coverage X%"` so assistive tech
 *     announces the percentage as a single atomic value.
 *   - The nested SVG is `aria-hidden` — the wrapper owns the label.
 *
 * No runtime dependencies beyond React + Tailwind classes.
 */
/** Status tone for a coverage percentage: ≥85 healthy, 60–84 soon, <60 overdue. */
export type CoverageTone = 'healthy' | 'soon' | 'overdue';
export function coverageTone(pct: number): CoverageTone {
  if (pct >= 85) return 'healthy';
  if (pct >= 60) return 'soon';
  return 'overdue';
}

const STROKE: Record<CoverageTone, string> = {
  healthy: 'stroke-status-healthy',
  soon: 'stroke-status-soon',
  overdue: 'stroke-status-overdue',
};

const SIZES = {
  sm: { box: 'size-16', num: 'text-lg', stroke: 3.25 },
  md: { box: 'size-28', num: 'text-2xl', stroke: 3 },
  lg: { box: 'size-[120px]', num: 'text-3xl', stroke: 2.75 },
} as const;

export function CoverageRing({
  percentage,
  size = 'md',
  caption = size === 'md',
}: {
  percentage: number;
  /** sm = 64px phone summary row, lg = 120px desktop aside, md = legacy 112px. */
  size?: keyof typeof SIZES;
  /** Show the "on schedule" caption under the ring (the summary rows carry it in text instead). */
  caption?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
  const offset = 100 - clamped;
  const tone = coverageTone(clamped);
  const dims = SIZES[size];
  return (
    <div
      role="img"
      aria-label={`Coverage ${clamped}%`}
      data-coverage-tone={tone}
      className="inline-flex shrink-0 flex-col items-center gap-2"
    >
      <div className={`relative inline-flex items-center justify-center ${dims.box}`}>
        <svg viewBox="0 0 36 36" className={`${dims.box} -rotate-90`} aria-hidden="true">
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            className="stroke-hairline"
            strokeWidth={dims.stroke}
          />
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            className={`${STROKE[tone]} motion-safe:transition-[stroke-dashoffset] motion-safe:duration-[600ms] motion-safe:ease-out`}
            strokeWidth={dims.stroke}
            strokeLinecap="round"
            strokeDasharray="100 100"
            strokeDashoffset={offset}
          />
        </svg>
        <span
          className={`pointer-events-none absolute font-display font-medium tabular-nums tracking-tight ${dims.num}`}
        >
          {clamped}%
        </span>
      </div>
      {caption && (
        <span className="section-label">On schedule</span>
      )}
    </div>
  );
}
