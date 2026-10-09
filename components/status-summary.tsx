import clsx from 'clsx';
import { CoverageRing, coverageTone } from '@/components/coverage-ring';

/**
 * StatusSummary — the dashboard's one compact status header
 * (DESIGN-2026-10-09 §1).
 *
 *   phone   → a horizontal row: 64px ring, then two lines of text.
 *   desktop → a surface-2 card: 120px ring above the same two lines.
 *
 * Line one names the state ("On schedule", "A little behind", "Falling
 * behind") in the coverage tone
 * (≥85 healthy, 60–84 soon, <60 overdue). Line two counts the two live
 * bands as a sentence, each number in its status colour. Pure display.
 * `aside` (phone row only) sits at the right edge: the streak pill.
 */
const TONE_TEXT = {
  healthy: 'text-status-healthy',
  soon: 'text-status-soon-deep',
  overdue: 'text-status-overdue',
} as const;

/** The ring already shows the number; the line says what it means. */
const TONE_WORDS = {
  healthy: 'On schedule',
  soon: 'A little behind',
  overdue: 'Falling behind',
} as const;

export function StatusSummary({
  percentage,
  overdue,
  thisWeek,
  layout,
  aside,
}: {
  percentage: number;
  overdue: number;
  thisWeek: number;
  layout: 'row' | 'card';
  aside?: React.ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(percentage)));
  const tone = coverageTone(pct);
  const lines = (
    <div className={clsx('min-w-0', layout === 'card' && 'text-center')}>
      <p
        data-status-line
        className={clsx('font-display text-lg font-medium leading-snug', TONE_TEXT[tone])}
      >
        {TONE_WORDS[tone]}
      </p>
      <p className="mt-0.5 text-[13px] leading-5 text-pretty text-muted-foreground">
        <span
          className={clsx(
            'tabular-nums',
            overdue > 0 && 'font-semibold text-status-overdue',
          )}
        >
          {overdue}
        </span>{' '}
        overdue, <span
          className={clsx(
            'tabular-nums',
            thisWeek > 0 && 'font-semibold text-status-soon-deep',
          )}
        >
          {thisWeek}
        </span>{' '}
        this week
      </p>
    </div>
  );

  if (layout === 'row') {
    return (
      <div data-status-summary="row" className="flex items-center gap-4">
        <CoverageRing percentage={pct} size="sm" caption={false} />
        {lines}
        {aside && <div className="ml-auto shrink-0 self-start pt-1">{aside}</div>}
      </div>
    );
  }
  return (
    <div
      data-status-summary="card"
      className="flex flex-col items-center gap-4 rounded-xl border border-hairline bg-surface-2 px-6 py-6"
    >
      <CoverageRing percentage={pct} size="lg" caption={false} />
      {lines}
    </div>
  );
}
