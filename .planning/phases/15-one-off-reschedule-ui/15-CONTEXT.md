# Phase 15: One-Off & Reschedule UI — Context

**Gathered:** 2026-04-22
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (requirements fully specified; SNZE-07 marker field design decided below)

<domain>
## Phase Boundary

Users can create one-off tasks and rearrange any task's next occurrence from any view via a mobile-friendly action sheet. "Just this time" writes a schedule_overrides row (Phase 10); "From now on" mutates tasks.anchor_date (anchored) or tasks.next_due_smoothed (cycle) with a marker flag preserved by REBAL. ExtendWindowDialog for cross-season snoozes.

**In scope (6 REQ-IDs):**
- OOFT-04 Task form distinguishes Recurring vs One-off; anchored disallowed for one-off
- SNZE-01 Reschedule action sheet from any task in any view
- SNZE-02 Date picker defaults to natural next due
- SNZE-03 "Just this time" / "From now on" radio (default: Just this time)
- SNZE-07 "From now on" mutates anchor_date (anchored) OR next_due_smoothed+marker (cycle); no override row
- SNZE-08 Snoozing past active window prompts ExtendWindowDialog

**Out of scope:**
- PREF dropdown in form (v1.2)
- Horizon density viz (Phase 16)
- Manual rebalance (Phase 17 — reads the marker flag shipped here)

**Deliverables:**
1. Task form: "Recurring" vs "One-off" toggle at top of form. When "One-off": disable frequency + anchored mode; enable due_date. When "Recurring": enable frequency + anchored toggle; hide due_date. (OOFT-04)
2. `<RescheduleActionSheet>` component (shadcn Sheet/Drawer) — date picker + radio + submit. Accessible from every task row (BandView, PersonTaskList, TaskDetailSheet, By Area).
3. Server actions:
   - `snoozeTaskAction` — "Just this time" → writes schedule_overrides row (mirrors Phase 10 creation pattern)
   - `rescheduleTaskAction` — "From now on" → mutates anchor_date or next_due_smoothed with marker, no override row
4. Migration: add `tasks.reschedule_marker TIMESTAMP NULL` field — set to `now` when "From now on" is used, cleared to null on next rebalance or natural completion. REBAL preservation reads this field.
5. `<ExtendWindowDialog>` — confirmation modal when snooze date lands outside active_from/to window. Options: "Cancel" / "Extend active window to {month}" / "Continue dormant" (snooze row written but task still dormant on that date — edge case).
6. Tests: ~15 unit + 4 integration scenarios on port **18103**.
</domain>

<decisions>
## Implementation Decisions

### OOFT-04 form toggle

- **D-01 (top-level toggle):** Radio group at top of form: "Recurring" (default) vs "One-off". State-driven reveals: "Recurring" shows frequency + schedule_mode (cycle/anchored) + last_done; "One-off" shows due_date field, hides frequency/schedule_mode/last_done.
- **D-02 (schedule_mode anchored disabled for one-off):** If user selects one-off, schedule_mode silently sets to 'cycle' in form state (but since frequency is null, computeNextDue routes OOFT branch — mode irrelevant). Anchored toggle is visually disabled or hidden.
- **D-03 (form submit payload):** Recurring: send frequency_days + schedule_mode + anchor_date (if anchored) + last_done (optional). One-off: send frequency_days=null + due_date (required). createTaskAction from Phase 13 already handles both via isOoftTask check.

### SNZE-01/02/03 action sheet

- **D-04 (<RescheduleActionSheet> component):** Shadcn Sheet (slides up on mobile, dialog on desktop). Props: `task`, `lastCompletion?`, `onClose`. Contents:
  - Header: "Reschedule '<task.name>'"
  - Body: date picker (shadcn DatePicker), default = natural next due (via computeNextDue with no override, timezone-aware)
  - Radio: "Just this time" (default) / "From now on"
  - Submit button: "Reschedule"
  - Cancel button
- **D-05 (entry points — tap the "..." menu on any task):** Add menu item to existing TaskActions dropdown (if exists) or create one. Every task row surface in BandView / PersonTaskList / By Area / TaskDetailSheet exposes it. Dormant tasks (Phase 14) also get Reschedule option (user can un-dormant by snoozing into the window? No — that's a different workflow. Dormant tasks skip for v1.1; future concern).
- **D-06 (default date = natural next due):** Calls `computeNextDue(task, lastCompletion, now, undefined, timezone)` — no override, no smoothed (to get natural baseline). If result is null (dormant/archived), show error state in sheet "Task is not schedulable right now".

### SNZE-07 "From now on" marker

- **D-07 (marker field shape):** `tasks.reschedule_marker TIMESTAMP NULL` — new field, additive migration. When "From now on" used:
  - Anchored mode: set `tasks.anchor_date = picked_date` AND `tasks.reschedule_marker = now`
  - Cycle mode: set `tasks.next_due_smoothed = picked_date` AND `tasks.reschedule_marker = now`
- **D-08 (marker lifecycle):** Set to `now` when user picks "From now on". REBAL (Phase 17) reads this field — tasks with non-null marker are preserved (user intent wins over recompute). Natural completion in completeTaskAction does NOT clear the marker (user may want the intent to persist; REBAL will clear when applicable). Rebalance apply (Phase 17) clears markers for preserved tasks.
- **D-09 (no override row for "From now on"):** Writing directly to tasks.{anchor_date|next_due_smoothed} means the schedule_overrides collection stays lean. Phase 10's D-10 atomic-consumption doesn't fire since no override row exists.

### SNZE-08 ExtendWindowDialog

- **D-10 (trigger condition):** When user submits reschedule AND picked_date falls outside the task's active_from/to window (Phase 11 isInActiveWindow check), show confirmation modal BEFORE writing.
- **D-11 (modal options):**
  - "Cancel" — close dialog, no changes
  - "Extend active window to include {month_of_picked_date}" — update tasks.active_from/to to span the picked date's month
  - Return to action sheet — user picks different date
  - Actually simpler: just "Cancel" / "Extend window" / "Continue anyway" (snooze written; task appears dormant that day per isInActiveWindow — user warned)
- **D-12 (extend window mechanics):** If "Extend", widen active_from or active_to by the smallest delta to include picked_date's month. E.g., active_from=4 active_to=9 (Apr-Sep), picked=Oct 15 → extend active_to to 10 (Apr-Oct). Single-field update.

### Action server actions

- **D-13 (`snoozeTaskAction` signature):** `(formData: { task_id, snooze_until })` → `Promise<ActionResult>`. Calls Phase 10 `createOverride` helper or directly inserts schedule_overrides row via pb.createBatch (D-02 atomic-replace-active from Phase 10 still applies — existing override consumed if present).
- **D-14 (`rescheduleTaskAction` signature):** `(formData: { task_id, new_date })` → `Promise<ActionResult>`. Determines mode from task.schedule_mode:
  - Anchored: batch.update(task.id, { anchor_date: new_date, reschedule_marker: now.iso() })
  - Cycle: batch.update(task.id, { next_due_smoothed: new_date, reschedule_marker: now.iso() })
- **D-15 (idempotency):** Both actions preserve ActionResult discriminated-union semantics from Phase 2/3 (via CompleteResult pattern).

### Migration

- **D-16 (migration timestamp 1745280003):** +1 from Phase 12's 1745280002. Additive: `tasks.reschedule_marker TIMESTAMP NULL`. Use PB DateField required:false.

### Test scope

- **D-17 (~15 unit + 4 integration scenarios on port 18103):**
  - 4 form tests: one-off toggle disables frequency; anchored disallowed for one-off; due_date required for one-off; recurring preserved default behavior
  - 5 sheet tests: default date = natural; radio default = "Just this time"; submit "Just this time" calls snoozeTaskAction; submit "From now on" calls rescheduleTaskAction; cancel no-op
  - 4 action tests: snoozeTaskAction writes override + consumes prior; rescheduleTaskAction cycle sets next_due_smoothed+marker; rescheduleTaskAction anchored sets anchor_date+marker; ExtendWindowDialog triggers on out-of-window picks
  - 2 integration helper tests: reschedule_marker field exists in migration; natural completion does NOT clear marker (D-08)
  - 4 integration scenarios on port 18103:
    1. One-off lifecycle: create OOFT via form → appears in BandView → snooze to tomorrow → override written → reappears tomorrow
    2. "From now on" cycle: reschedule a cycle task 10 days forward → next_due_smoothed+marker set
    3. "From now on" anchored: reschedule an anchored task 10 days forward → anchor_date+marker set
    4. Cross-season snooze: snooze a seasonal task into dormant window → ExtendWindowDialog prompts → "Extend" widens active_to → task active on picked date

### Port + migration

- **D-18 (Port 18103):** 18090..18103 log.

### Claude's Discretion
- Date picker choice (react-day-picker vs native) — recommend react-day-picker if shadcn pattern exists
- Sheet vs Drawer on desktop — recommend Sheet for v1.1 simplicity
- Reschedule entry point: "..." menu item vs long-press — recommend menu item for discoverability
</decisions>

<canonical_refs>
- `.planning/ROADMAP.md` §"Phase 15"
- `.planning/REQUIREMENTS.md` OOFT-04 + SNZE-01,02,03,07,08
- `.planning/phases/10-schedule-override-foundation/10-CONTEXT.md` (schedule_overrides + D-02 atomic replace)
- `.planning/phases/11-task-model-extensions/11-CONTEXT.md` D-16 (marker flag deferred to here)
- `lib/schedule-overrides.ts` — Phase 10 override helpers
- `lib/task-scheduling.ts` — computeNextDue + isInActiveWindow
- `components/forms/task-form.tsx` — Phase 14 Advanced collapsible (extend with OOFT toggle)
</canonical_refs>

<deferred>
- PREF dropdown in form (v1.2)
- Alternative entry points (long-press gesture) — v1.2
- Snooze into dormant UX polish ("task will sleep through" messaging) — Phase 17+ iteration
</deferred>

---

*Phase: 15-one-off-reschedule-ui*
*Context gathered: 2026-04-22*
