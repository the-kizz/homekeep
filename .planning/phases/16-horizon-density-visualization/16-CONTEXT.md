# Phase 16: Horizon Density Visualization — Context

**Gathered:** 2026-04-22
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (pure visual layer over Phase 12 LOAD data; no new data)

<domain>
## Phase Boundary

Visual feedback for the LOAD thesis: HorizonStrip shows per-month density; shifted tasks wear a ⚖️ badge; TaskDetailSheet surfaces ideal-vs-scheduled dates. Pure UI phase — no new data fields, no server actions, no migration.

**In scope (5 REQ-IDs):**
- LVIZ-01 HorizonStrip month cells show density indicator (background tint scaling with task count)
- LVIZ-02 Tapping heavy month opens existing Sheet drawer (already implemented) with density-aware rendering
- LVIZ-03 Task rows shifted by smoother show ⚖️ badge with tooltip explaining the shift
- LVIZ-04 Badge appears ONLY when `displacement > 0 days` (natural ideal != scheduled date)
- LVIZ-05 TaskDetailSheet "Schedule" section shows ideal vs scheduled dates when smoothed

**Out of scope:**
- Manual rebalance (Phase 17)
- SPEC docs (Phase 18)
- Effort-aware rendering (v1.2+)
- Multi-month drill-down (v1.2+)

**Deliverables:**
1. HorizonStrip density: compute per-month task count (via existing `computeHouseholdLoad` result or inline count); apply tint (opacity-based on count / max count) to each month cell.
2. `⚖️` Badge component: appears next to task name when `next_due_smoothed` differs from natural ideal. Tooltip: "Shifted from Mar 15 to Mar 17 to smooth household load" (or similar).
3. TaskDetailSheet "Schedule" section: show natural ideal date + scheduled date side-by-side when they differ. Hide both when equal.
4. Helper: `getIdealAndScheduled(task, lastCompletion, now, timezone)` returns `{ ideal, scheduled, displaced }` — pure function.
5. Tests: ~10 unit + 3 integration scenarios.
</domain>

<decisions>
## Implementation Decisions

### Density indicator (LVIZ-01/02)

- **D-01 (tint pattern):** Per month cell in HorizonStrip, compute `count = tasks due this month` (from already-available task data in BandView). Normalize to 0..1 via `count / max(count across visible months)`. Apply background opacity scaling: `bg-primary/10` for light (0.2), `bg-primary/30` (0.5), `bg-primary/50` (0.8+). Minimum 3 tint steps.
- **D-02 (tap existing Sheet):** LVIZ-02 says Sheet is already implemented. Extend its contents to show density-aware rendering — e.g., the Sheet lists tasks-in-month sorted by date with the shifted badge inline.
- **D-03 (fallback for empty month):** Empty month = no tint (default cell background). Existing visual pattern preserved.

### ⚖️ Badge (LVIZ-03/04)

- **D-04 (displacement detection):** `ideal = natural date computed via computeNextDue with next_due_smoothed stripped` (similar to the "natural task" construction in Phase 15's RescheduleActionSheet). If `ideal !== scheduled`, display badge. Use existing helper pattern from 15-02 (`stripSmoothed(task)` → natural `task`).
- **D-05 (badge render):** Inline `<span>` with ⚖️ emoji and `aria-label="Shifted"` + `title="Shifted from {ideal} to {scheduled}"`. shadcn Tooltip on hover if available.
- **D-06 (placements):** BandView (next to task name in row), PersonTaskList (same), By Area list (same), Sheet drawer list (same).
- **D-07 (no badge on dormant tasks):** Dormant tasks already render dimmed + "Sleeps until" badge; no ⚖️ for them.

### TaskDetailSheet Schedule section (LVIZ-05)

- **D-08 (show only when shifted):** If `ideal !== scheduled`, render Schedule section with two rows: "Ideal: {formatIdeal}" and "Scheduled: {formatScheduled}" + short note "Shifted by {days} days to smooth household load".
- **D-09 (hide when equal):** When ideal === scheduled, section omitted entirely (no empty state).

### Helper

- **D-10 (`getIdealAndScheduled` signature):** Pure function in `lib/horizon-density.ts` (or extend `lib/task-scheduling.ts`):
  ```ts
  function getIdealAndScheduled(task, lastCompletion, now, timezone): {
    ideal: Date | null;
    scheduled: Date | null;
    displaced: boolean;
  }
  ```
  - `ideal` = computeNextDue(task, lastCompletion, now, undefined, timezone) with a copy of task that has next_due_smoothed=null
  - `scheduled` = computeNextDue(task, lastCompletion, now, undefined, timezone) — unmodified
  - `displaced = ideal && scheduled && ideal.getTime() !== scheduled.getTime()`

### Test scope

- **D-11 (~10 unit + 3 integration on port 18104):**
  - 3 density tests: cell with count=0 has no tint; count=5 has bg-primary/30; max-count month has bg-primary/50
  - 3 badge tests: task with smoothed != natural → badge renders; smoothed === natural → no badge; archived/dormant → no badge
  - 2 helper tests: getIdealAndScheduled returns correct shapes; dormant returns {ideal: null, scheduled: null, displaced: false}
  - 2 TaskDetailSheet tests: Schedule section visible when shifted; hidden when not
  - 3 integration scenarios on port 18104:
    1. Post-LOAD completion leaves ⚖️ badge visible
    2. Anchored task (LOAD-06 bypass) never shows badge
    3. HorizonStrip month-cell tint scales with real task distribution

### Port allocation

- **D-12 (Port 18104 claimed):** 18090..18104 log.

### Claude's Discretion
- Exact tint steps / opacity values — recommend 3 steps (10%, 30%, 50%) for visual clarity
- Badge render: emoji vs icon component — recommend emoji (no new dep)
- Tooltip vs inline text — recommend Tooltip if radix-tooltip already installed, else inline title
- Schedule section layout (stacked vs side-by-side) — recommend stacked on mobile, side-by-side desktop
</decisions>

<canonical_refs>
- `.planning/ROADMAP.md` §"Phase 16"
- `.planning/REQUIREMENTS.md` LVIZ-01..05
- `components/band-view.tsx` — HorizonStrip component
- `components/task-detail-sheet.tsx` — Schedule section target
- `components/task-row.tsx` — badge insertion point
- `components/person-task-list.tsx` — badge insertion point
- `components/dormant-task-row.tsx` — exclusion reference (no ⚖️ for dormant)
- `lib/task-scheduling.ts` — computeNextDue
- `lib/load-smoothing.ts` — placement data
</canonical_refs>

<deferred>
- Effort-aware density (v1.2+)
- Multi-month drill-down (v1.2+)
- Month-granularity click handlers beyond current sheet (v1.2+)
</deferred>

---

*Phase: 16-horizon-density-visualization*
*Context gathered: 2026-04-22*
