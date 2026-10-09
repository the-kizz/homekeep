import clsx from 'clsx';

/*
 * Band heading + surface, shared by the dashboard bands, the Horizon, the
 * Sleeping list and the landing-page sample. Server-safe (no hooks).
 */
export type BandTone = 'overdue' | 'thisWeek' | 'horizon' | 'dormant';

const PILL_TONE: Record<string, string> = {
  overdue: 'bg-status-overdue-soft text-status-overdue',
  thisWeek: 'bg-status-soon/15 text-status-soon-deep',
};

/**
 * Bold palette signature: the band heading is a solid block in the band's
 * colour (red, peg yellow, cobalt, pool blue; cobalt is upcoming only) sitting on top of its list
 * like a lid. Notebook keeps the quiet title + count pill.
 */
const BLOCK_TONE: Record<BandTone, string> = {
  overdue: 'bold:bg-status-overdue bold:text-on-status',
  thisWeek: 'bold:bg-status-soon bold:text-on-soon',
  horizon: 'bold:bg-status-upcoming bold:text-on-status',
  dormant: 'bold:bg-status-dormant bold:text-on-status',
};

/** Classes for the surface that sits under a BandHeader. */
export const BAND_SURFACE =
  'overflow-hidden rounded-xl border border-hairline bg-surface-2 bold:rounded-t-none bold:border-t-0';

/** Spacing between a BandHeader and its surface (none in Bold: they join). */
export const BAND_STACK = 'space-y-3 bold:space-y-0';

/**
 * Band heading: Lora title with a status-coloured count pill. The band
 * body is ONE hairline surface; rows inside are divided, not boxed.
 */
export function BandHeader({
  label,
  count,
  variant,
  as: Tag = 'h2',
}: {
  label: string;
  count: number;
  variant?: string;
  as?: 'h2' | 'h3';
}) {
  const block = BLOCK_TONE[(variant ?? '') as BandTone] ?? '';
  return (
    <div
      className={clsx(
        'flex items-center gap-2.5 px-1',
        block && 'bold:rounded-t-xl bold:px-4 bold:py-2.5',
        block,
      )}
    >
      <Tag
        className={clsx(
          'font-display text-xl font-medium tracking-tight text-foreground',
          block && 'bold:font-bold bold:text-inherit',
        )}
      >
        {label}
      </Tag>
      {count > 0 && (
        <span
          data-band-count={count}
          className={clsx(
            'rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
            PILL_TONE[variant ?? ''] ?? 'bg-muted text-muted-foreground',
            block &&
              'bold:ml-auto bold:bg-transparent bold:px-0 bold:font-display bold:text-xl bold:font-bold bold:text-inherit',
          )}
        >
          {count}
        </span>
      )}
    </div>
  );
}

