import { formatDistanceToNow } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { AvatarCircle, initialsOf } from '@/components/avatar-circle';

/**
 * HistoryTimeline — reverse-chronological completion feed grouped by day
 * (05-02 Task 3, D-09 + D-11, HIST-01/03).
 *
 * Pure presentational — all data shaping happens in the parent Server
 * Component. The timeline groups by local day (in the home's timezone)
 * under sticky `sticky top-0` headers that read "Today" / "Yesterday"
 * / `{EEEE, MMM d}` per CONTEXT §specifics.
 *
 * Each row renders a small AvatarCircle + "{user} completed {task}" + a
 * color-dotted area chip + relative time (formatDistanceToNow) to match
 * the SPEC §8.4 line shape. The relative time has a `title` attribute
 * with the absolute local timestamp for users who hover (HIST-03 "when").
 *
 * Entries must arrive pre-sorted DESC by completed_at — the parent
 * guarantees this (completions from PB come sorted by the fetch helper).
 */
export type HistoryEntry = {
  id: string;
  completed_at: string;
  user: { id: string; name: string };
  task: { id: string; name: string };
  area: { id: string; name: string; color: string };
};

export function HistoryTimeline({
  entries,
  timezone,
  now = new Date(),
}: {
  entries: HistoryEntry[];
  timezone: string;
  /** Reference instant for the Today / Yesterday headers; tests pin it. */
  now?: Date;
}) {
  if (entries.length === 0) {
    return (
      <p
        className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
        data-history-empty
      >
        No completions yet — your history starts with the first check ✓
      </p>
    );
  }

  // Bucket entries by yyyy-MM-dd in the home's timezone. Preserves the
  // input order (already DESC) within each bucket.
  const buckets = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const key = formatInTimeZone(
      new Date(e.completed_at),
      timezone,
      'yyyy-MM-dd',
    );
    const arr = buckets.get(key) ?? [];
    arr.push(e);
    buckets.set(key, arr);
  }

  // Today + Yesterday keys for header copy. Today's key comes straight
  // from the home timezone; yesterday is one calendar day earlier,
  // computed on a UTC date-only value so neither the server's own
  // timezone nor a 23/25-hour DST day can shift it.
  const todayKey = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const yesterdayKey = new Date(Date.UTC(ty, tm - 1, td - 1))
    .toISOString()
    .slice(0, 10);

  // Keys DESC (newest day first) — input is already DESC, so a deduped
  // Array.from(buckets.keys()) preserves that ordering.
  const orderedKeys = Array.from(buckets.keys());

  return (
    <div className="space-y-4" data-history-timeline>
      {orderedKeys.map((key) => {
        const bucket = buckets.get(key)!;
        const firstAt = new Date(bucket[0].completed_at);
        const heading =
          key === todayKey
            ? 'Today'
            : key === yesterdayKey
              ? 'Yesterday'
              : formatInTimeZone(firstAt, timezone, 'EEEE, MMM d');
        return (
          <section key={key} className="space-y-2" data-history-day={key}>
            <h3
              className="sticky top-0 z-10 bg-background/95 backdrop-blur py-1 text-xs uppercase tracking-wide text-muted-foreground"
              data-history-day-header={key}
            >
              {heading}
            </h3>
            <ul className="space-y-2">
              {bucket.map((e) => {
                const relative = formatDistanceToNow(
                  new Date(e.completed_at),
                  { addSuffix: true },
                );
                const absolute = formatInTimeZone(
                  new Date(e.completed_at),
                  timezone,
                  'MMM d, yyyy h:mm a',
                );
                return (
                  <li
                    key={e.id}
                    data-history-entry
                    data-completion-id={e.id}
                    data-user-id={e.user.id}
                    data-task-id={e.task.id}
                    data-area-id={e.area.id}
                    className="flex items-start gap-3 rounded border p-3"
                  >
                    <AvatarCircle
                      size="sm"
                      variant="solid"
                      initials={initialsOf(e.user.name)}
                      title={e.user.name}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-baseline gap-1 text-sm">
                        <span className="font-medium truncate">
                          {e.user.name}
                        </span>
                        <span className="text-muted-foreground">completed</span>
                        <span className="font-medium truncate">
                          {e.task.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
                          data-area-chip
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: e.area.color }}
                            aria-hidden="true"
                          />
                          <span className="truncate max-w-[10rem]">
                            {e.area.name}
                          </span>
                        </span>
                        <span
                          className="text-muted-foreground tabular-nums"
                          title={absolute}
                        >
                          {relative}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
