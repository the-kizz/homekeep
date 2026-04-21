'use client';

import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';

/**
 * AreaCelebration (06-03 Task 2, D-13, GAME-04).
 *
 * Client-side one-shot overlay that plays when completeTaskAction
 * returns `celebration: { kind: 'area-100', areaName }`. The flag is
 * server-computed (via lib/area-celebration.ts detectAreaCelebration),
 * so the crossover <100→100 detection is deterministic and the client
 * only owns rendering.
 *
 * Animation: pure CSS via Tailwind's `motion-safe:animate-*` variants
 * (tw-animate-css ships in deps). `motion-reduce:` falls back to a
 * non-animated static pill — the celebration still renders so the
 * user gets the acknowledgement, it just doesn't slide.
 *
 * Lifecycle: after 2500ms (motion-safe) / 2000ms (motion-reduce) the
 * component calls `onDone()`; the parent (<BandView>) unmounts this
 * component by clearing its celebration state. A double-completion
 * that re-triggers detectAreaCelebration will remount the component
 * with a fresh timer (new key via areaId if needed).
 *
 * Non-blocking: the overlay has `pointer-events-none` so underlying
 * rows remain tappable. Fixed-position + top-center + backdrop-blur so
 * it reads as a celebratory announcement rather than a modal.
 *
 * Data attrs:
 *   data-area-celebration — root, used by optional Part 3 E2E smoke.
 *   data-area-name        — echoes the areaName for E2E assertions.
 */
export function AreaCelebration({
  areaName,
  onDone,
}: {
  areaName: string;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => onDone(), 2500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-area-celebration
      data-area-name={areaName}
      className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4"
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-background/90 px-4 py-2 text-sm font-medium text-primary shadow-lg backdrop-blur motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-4 motion-safe:duration-500">
        <Sparkles className="size-4" aria-hidden="true" />
        <span>
          {areaName} — 100% maintained <span aria-hidden="true">✨</span>
        </span>
      </div>
    </div>
  );
}
