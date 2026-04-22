# Phase 14: Seasonal UI & Seed Library — Context

**Gathered:** 2026-04-22
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (UI behavior fully specified by REQs; no ambiguous design choices)

<domain>
## Phase Boundary

Seasonal tasks are first-class in the UI: authors set active months on the task form, dormant tasks render as distinct "sleeping" rows across By Area / Person / dashboard, and the seed library ships two seasonal pairs so new households taste the feature.

**In scope (5 REQ-IDs):**
- SEAS-06 Dormant tasks render dimmed with "Sleeps until <Mon YYYY>" badge in By Area and Person views (not tap-completable from those views)
- SEAS-07 Task form "Active months" optional section (from/to month dropdowns)
- SEAS-08 Form warns (does NOT block) when anchored task falls predominantly outside active window
- SEAS-09 Seed library extends with two seasonal pairs (warm/cool mow; summer AC / winter heater)
- SEAS-10 History view shows completions regardless of current dormancy state

**Out of scope:**
- PREF dropdown in form (Phase 15 or later — still deferred)
- OOFT form toggle (Phase 15)
- Reschedule action sheet (Phase 15)
- Horizon density visualization (Phase 16)

**Deliverables:**
1. Task form: "Active months" Advanced subsection — two month dropdowns (from/to), both optional. Cross-pair validation: both set or both null. Cycle-year wrap supported (from > to means wrap).
2. Form anchored-warning: when scheduleMode=anchored AND active_from/to set AND anchor_date's month falls outside window predominantly (>50% of projected cycles dormant) → show non-blocking warning toast/inline.
3. Dormant rendering: extend BandView / PersonTaskList / ByArea views to render dimmed style (opacity-50 + dimmed text) for `isInActiveWindow(task, now) === false` tasks. Add badge: "Sleeps until <MonthName YYYY>" where date = nextWindowOpenDate(...).
4. Dormant tap-completable guard: tap/click on dormant task row in those views is a no-op (or shows toast "Task is dormant until <date>"). Completions still possible from History and task detail page.
5. Seed library: add 2 pair entries (4 seed defs total) in lib/seed-library.ts with active_from/to populated.
6. History view: verify no dormancy filter — completions always listed.
</domain>

<decisions>
## Implementation Decisions

### Form "Active months" (SEAS-07)

- **D-01 (form structure):** Inside existing Advanced collapsible (from Phase 13 last_done). Add "Active months" subsection: two shadcn Select dropdowns (or native `<select>`) — "From month" and "To month" — options 1..12 with month names ("January", "February", ...). Default: both blank → year-round.
- **D-02 (validation):** Phase 11's zod already validates paired-or-null + 1..12 range. Form should disable "To month" until "From month" selected (UX hint); submit fails validation if only one set.
- **D-03 (cross-year wrap rendering):** Label example text: "From October → To March (Oct, Nov, Dec, Jan, Feb, Mar)". Tooltip or helper text clarifies wrap behavior.

### Form anchored-warning (SEAS-08)

- **D-04 (warning math):** When scheduleMode=anchored AND active_from/to set AND anchor_date provided:
  - Project the next 6 cycles (anchor_date + k × frequency_days for k=0..5) — or 12 for annual tasks
  - Count how many projected dates fall INSIDE the active window
  - If ≤50% inside → show warning "Most scheduled cycles fall outside the active window. The task will be dormant for those dates."
- **D-05 (warning UX):** Inline Alert component with amber color, below the field group. No block on save. Dismissable or permanent until fields change.
- **D-06 (no warning for cycle-mode):** Cycle-mode tasks don't have a fixed anchor, so "predominantly outside" doesn't apply. Warning only appears when anchored.

### Dormant rendering (SEAS-06)

- **D-07 (visual style):** `opacity-50` on the row, muted-foreground text, grayscale icon, no hover effects. Shadcn Badge variant="secondary" with text "Sleeps until {formatDate(nextWindowOpenDate, 'MMM yyyy')}".
- **D-08 (no-op tap):** Click handler checks `isInActiveWindow(task, now)` via helper; if false, early-return (no toast — silent no-op keeps the UI quiet; the badge already communicates why). Alternative: minimal toast if needed.
- **D-09 (views extended):** Three views get the dormant treatment:
  - `app/(app)/h/[homeId]/page.tsx` BandView — overdue/today/soon bands filter dormants from counts (SEAS-05 already covers), Horizon strip weeks show dormants as dimmed
  - `app/(app)/h/[homeId]/by-area/page.tsx` — per-area task list includes dormants dimmed at bottom
  - `app/(app)/h/[homeId]/person/page.tsx` — per-person task list same treatment
- **D-10 (history-not-filtered):** `app/(app)/h/[homeId]/history/page.tsx` (or equivalent) shows completions list unfiltered by dormancy (SEAS-10). Completions from dormant tasks still appear with original date. No special styling needed.

### Seed library (SEAS-09)

- **D-11 (two pairs = four seeds):**
  - "Mow lawn (warm)": cycle 14d, active_from=10, active_to=3 (Southern hemisphere: active Oct-Mar = summer) OR preferred-hemisphere config. v1.1 assumes Southern per STATE.md localization?
  - "Mow lawn (cool)": cycle 30d, active_from=4, active_to=9 (winter season)
  - "Service AC": cycle 365d, active_from=10, active_to=3 (pre-summer service)
  - "Service heater": cycle 365d, active_from=4, active_to=9 (pre-winter service)
- **D-12 (hemisphere abstraction):** Don't hardcode hemisphere. The seed library (`lib/seed-library.ts`) shipped in Phase 5 uses a home.timezone to infer. For v1.1, assume Northern Hemisphere for the "warm season = Apr-Sep" convention. Document clearly in seed-library.ts that hemispheric inversion is a v1.2 concern.
  - Actually reviewing: STATE.md indicates Australia development — Southern Hemisphere convention. Keep pragmatic: add a comment noting the warm/cool labels may feel inverted for Northern users; defer localization. Pick Northern convention (warm = Apr-Sep) for v1.1.
- **D-13 (seed discovery):** Both new seed entries appear in the onboarding seed-picker UI (Phase 5 seed-library grid). No new UI work — just data adds.

### History view (SEAS-10)

- **D-14 (audit, not extend):** Read existing history view code — confirm no dormancy filter exists. If one does (unlikely since Phase 11 was data-only), remove it. If not (expected), add a test asserting completions-from-dormant-tasks are listed.

### Test scope

- **D-15 (~10 unit tests + 3 integration):**
  - 3 form tests: Active months section renders; both-or-null validation; anchored warning shows when projected cycles dormant.
  - 3 dormant-render tests: badge renders "Sleeps until Oct 2026" for task in May with Oct-Mar window; row has opacity-50 class; click is no-op.
  - 2 seed library tests: new pairs exist in seed-library.ts; render correctly in onboarding picker.
  - 2 coverage/history integration: dormant task doesn't drag coverage (regression of SEAS-05); history view shows dormant-task completion.
  - 3 integration scenarios on port **18102**:
    1. Onboarding flow creates a seasonal seed → task has active_from/to set
    2. Dormant task in By Area view has dimmed class + badge
    3. History view shows completion from currently-dormant task

### Port allocation

- **D-16 (Port 18102 claimed):** 18090..18102 log.

### Claude's Discretion
- Exact month-dropdown component (native vs shadcn Select) — recommend shadcn for consistency.
- Badge text format ("Sleeps until Oct 2026" vs "Sleeping — back in October") — recommend first (concise, date-parseable).
- Warning UX (inline vs toast) — recommend inline Alert below field group.
- Warning copy exact wording — planner/executor's call within REQ intent.
</decisions>

<canonical_refs>
- `.planning/ROADMAP.md` §"Phase 14"
- `.planning/REQUIREMENTS.md` SEAS-06..10
- `.planning/phases/11-task-model-extensions/11-CONTEXT.md` D-11..D-14 (active window data model)
- `lib/task-scheduling.ts` — `isInActiveWindow`, `nextWindowOpenDate` (Phase 11)
- `lib/seed-library.ts` — existing seeds to extend
- `components/forms/task-form.tsx` — Phase 13 Advanced collapsible
- `components/band-view.tsx`, `components/person-task-list.tsx` — views to extend with dormant rendering
- `app/(app)/h/[homeId]/by-area/page.tsx` — area view
</canonical_refs>

<code_context>
## Existing Assets
- Phase 11 `isInActiveWindow(month, from?, to?)` — dormancy check primitive
- Phase 11 `nextWindowOpenDate(now, from, to, timezone)` — badge date source
- Phase 13 Advanced collapsible in task-form — just add "Active months" subsection inside
- Phase 5 seed library pattern in `lib/seed-library.ts` — add 4 new entries
- Shadcn Alert component (likely exists) for SEAS-08 warning; Badge for SEAS-06

## Threats
- **T-14-01** Badge renders "Sleeps until NaN" if nextWindowOpenDate returns invalid — mitigate via null guard
- **T-14-02** Anchored warning math O(cycles) — bounded to 6-12 projections, negligible
- **T-14-03** Seed library hemisphere mismatch — documented as v1.2 localization concern
</code_context>

<deferred>
- Hemisphere-aware seed labels (v1.2 localization)
- PREF dropdown in form (Phase 15)
- OOFT toggle (Phase 15)
- Per-day-of-week granularity (v1.2)
</deferred>

---

*Phase: 14-seasonal-ui-seed-library*
*Context gathered: 2026-04-22*
