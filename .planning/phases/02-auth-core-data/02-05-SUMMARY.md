---
phase: 02-auth-core-data
plan: 05
subsystem: tasks
tags: [tasks, scheduling, next-due, date-fns, date-fns-tz, pocketbase, server-actions, react-hook-form, zod, playwright, e2e, tdd, phase-2-gate]

# Dependency graph
requires:
  - phase: 02-auth-core-data plan 01
    provides: "tasks collection (home_id/area_id/name/description/frequency_days/schedule_mode/anchor_date/icon/color/assigned_to_id/notes/archived/archived_at fields + ownership-scoped api rules)"
  - phase: 02-auth-core-data plan 02
    provides: "createServerClient, shadcn Button/Input/Label/Card primitives, date-fns 4.1.0 + date-fns-tz 3.2.0 pins"
  - phase: 02-auth-core-data plan 03
    provides: "useActionState + react-hook-form + zodResolver form template, ActionState type from lib/schemas/auth"
  - phase: 02-auth-core-data plan 04
    provides: "home / area server-action pattern with ownership preflight, live-user-record layout re-read, AreaForm pattern for task-form to mirror"
provides:
  - "lib/task-scheduling.ts — pure computeNextDue(task, lastCompletion, now) per RESEARCH lines 1143-1217; Task + Completion types exported; no I/O, no wall-clock reads, throws on invalid frequency_days (D-13)"
  - "lib/schemas/task.ts — zod taskSchema with cross-field .refine(schedule_mode === 'anchored' → anchor_date non-empty, path: ['anchor_date']) per Pitfall 12; TaskInput type exported (D-12)"
  - "lib/actions/tasks.ts — createTask (redirects to area detail), updateTask (returns ok), archiveTask (sets archived + archived_at, redirects caller) all with getOne ownership preflight"
  - "components/next-due-display.tsx — Client Component formatting UTC Date via date-fns-tz.formatInTimeZone(date, home.timezone, 'MMM d, yyyy') into a <time dateTime> element"
  - "components/forms/task-form.tsx — Client Component with RHF + zodResolver; Name / Area <select> (preselectable) / four quick-select type='button' buttons (Weekly=7 / Monthly=30 / Quarterly=90 / Yearly=365) / Schedule mode radiogroup via Controller / conditional anchor_date <input type='date'> / Notes textarea (2000 char cap)"
  - "components/task-list.tsx — Server Component rendering active tasks (archived filtered) with per-row <NextDueDisplay> and stable data-task-id / data-task-name attributes for E2E scoping"
  - "app/(app)/h/[homeId]/tasks/new/page.tsx — task creation page, supports ?areaId= preselect, fetches areas server-side and passes to TaskForm"
  - "app/(app)/h/[homeId]/tasks/[taskId]/page.tsx — task detail/edit via TaskForm mode='edit' + inline Server Action Archive button (zero-JS safe) that redirects back to the task's area"
  - "app/(app)/h/[homeId]/areas/[areaId]/page.tsx — extended from 02-04 stub to render <TaskList> + '+ Add task' link carrying ?areaId= so the create form auto-preselects this area"
  - "app/(app)/h/[homeId]/page.tsx — extended to show per-area active-task counts (countByArea Map from parallel pb.collection('tasks').getFullList) + '+ Add task' quick-link in the header"
  - "tests/unit/task-scheduling.test.ts — 14 Vitest cases (cycle never/with completion; anchored future/today/past/multi-cycle/exact-boundary; archived; freq=0/1.5/negative; DST day; leap-year Feb 29 2028; future-completion documented behavior)"
  - "tests/unit/schemas/task.test.ts — 9 Vitest cases (valid cycle/anchored, missing anchor_date refine, empty name, >120 char name, frequency <1, non-integer frequency, unknown schedule_mode, notes cap 2000)"
  - "tests/e2e/tasks-happy-path.spec.ts — 2 Playwright specs: D-21 full happy path (signup → TestHouse → Kitchen → Wipe benches weekly cycle → next-due MMM d, yyyy pattern → Quarterly air-con anchored today+90d → logout/login/last-viewed); archive test (Clean dryer lint → archive → removed from active list)"
affects: [03-three-band-view, 04-collaboration, 05-views-seed]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern: pure scheduling module — computeNextDue accepts `now: Date` parameter (never reads Date.now internally); the page passes `new Date()` as a prop to its Server Component consumer. Any future scheduling function (streak computation, overdue ratio) should follow this purity contract for the same unit-test testability win."
    - "Pattern: timezone layering — date math in UTC via date-fns addDays/differenceInDays; rendering in home.timezone via date-fns-tz.formatInTimeZone inside a Client Component that owns the IANA tz DB. No non-UTC arithmetic anywhere in the stack (RESEARCH line 1217)."
    - "Pattern: quick-select buttons inside a <form> MUST be type='button' — native default is type='submit' which would submit mid-fill. Plan verification flagged this as a real bug risk; enforced via explicit attribute + comment in the source. Applies to any future quick-select UX (e.g. recurrence presets, seed-library templates)."
    - "Pattern: zod cross-field refine with path — refine(schedule_mode + anchor_date) carries path: ['anchor_date'] so the fieldError surfaces under the correct key (Pitfall 12); mirrors the passwordConfirm pattern from 02-03's signupSchema."
    - "Pattern: inline Server Action for single-purpose buttons — Archive button wraps an async function with 'use server' directive inside a Server Component page; no separate Client Component needed. Works without JS enabled; preserves Next 16's single-response cookie/revalidate/redirect flow. Template for future destructive one-click actions (unarchive, mark-complete in Phase 3)."
    - "Pattern: server-owned clock — the /areas/[areaId] Server Component computes `new Date()` once at request time and passes it as `now` prop to TaskList. TaskList passes it to computeNextDue. No Client Component ever reads the clock. Deterministic SSR render + no hydration mismatch on next-due dates."
    - "Pattern: redirect-to-derived-path from Server Action — createTask redirects to /h/${homeId}/areas/${area_id} AFTER revalidatePath; the redirected page re-fetches with fresh data and the new task is visible without any client refresh."

key-files:
  created:
    - "lib/task-scheduling.ts"
    - "lib/schemas/task.ts"
    - "lib/actions/tasks.ts"
    - "components/next-due-display.tsx"
    - "components/forms/task-form.tsx"
    - "components/task-list.tsx"
    - "app/(app)/h/[homeId]/tasks/new/page.tsx"
    - "app/(app)/h/[homeId]/tasks/[taskId]/page.tsx"
    - "tests/unit/task-scheduling.test.ts"
    - "tests/unit/schemas/task.test.ts"
    - "tests/e2e/tasks-happy-path.spec.ts"
  modified:
    - "app/(app)/h/[homeId]/areas/[areaId]/page.tsx"
    - "app/(app)/h/[homeId]/page.tsx"

key-decisions:
  - "02-05: Adopted RESEARCH's computeNextDue anchored formula (floor(elapsed/freq)+1 cycles), NOT CONTEXT D-13's pseudocode (Math.ceil). The difference is load-bearing at the exact-boundary case (elapsed == freq): floor+1 gives 2 cycles past anchor, ceil gives 1 cycle which lands exactly AT now — not strictly after. RESEARCH's version is the spec; added an explicit unit test case to codify it."
  - "02-05: Area <select> uses native HTML <select> (matches HomeForm's timezone pattern from 02-04) rather than shadcn's radix <Select>. Reason: radix Select is a controlled popover that doesn't integrate cleanly with RHF's register() for the free preselect-via-query-param case, and defaultValue={...} works naturally on the native control. Trade-off: slightly less polished visual, but zero hydration-mismatch risk and keyboard-accessible by default."
  - "02-05: TaskList passes `now` as a prop (computed in the Server Component page via `new Date()`) rather than letting TaskList read the clock itself. Keeps TaskList pure; lets the page choose a single `now` for a consistent batch of rows (vs. a different millisecond per row)."
  - "02-05: NextDueDisplay is Client-Component (not Server). date-fns-tz ships a timezone database that only needs to run on the render boundary; keeping it client-side means the server bundle stays lean and there's no server-side timezone lookup (Node has less complete IANA coverage than the browser in some environments). Trade-off: dates hydrate after first paint in no-JS contexts — acceptable because the <time dateTime> element is still semantically valid without JS."
  - "02-05: createTask redirects on success (redirect(`/h/${homeId}/areas/${area_id}`)); updateTask returns ok:true (no redirect). Rationale: creation takes the user back to a useful context (the area they added the task to), while edits usually keep the user on the detail page so they can keep editing. Mirrors the 02-04 createHome → redirect, updateHome → ok:true split."
  - "02-05: Archive flow uses a single-purpose inline Server Action that redirects to the area page. No Client Component needed; works with JS disabled. The alternative was a Client Component with useTransition + archiveTask — that's more code for no UX win."
  - "02-05: schema refine message 'Anchor date required for anchored tasks' surfaces under fieldErrors.anchor_date — confirmed by unit test `errors.anchor_date?.[0]).toMatch(/anchor/i)`. RHF + server fieldErrors merge cleanly under the Label's error slot."

patterns-established:
  - "Pattern: pure-function scheduling core — template for any future time-based derivation (streak computation in Phase 6, rotation schedule in Phase 4). Always accept `now: Date` parameter; never read the clock internally; always unit-test with fixed dates."
  - "Pattern: three-file task surface — schema (lib/schemas/task.ts) / actions (lib/actions/tasks.ts) / form (components/forms/task-form.tsx) follows the same shape as the 02-04 home/area trio; any future resource (completions in Phase 3, members in Phase 4) should mirror this layout."
  - "Pattern: CONTEXT pseudocode vs RESEARCH verified code — when these disagree (as D-13 did with RESEARCH §Pattern: Next-Due Computation), the RESEARCH version wins because it carries explicit edge-case coverage. Documented in decisions above."

requirements-completed: [TASK-01, TASK-05, TASK-06, TASK-07, TASK-08]

# Metrics
duration: 16min
completed: 2026-04-21
---

# Phase 2 Plan 5: Tasks + computeNextDue + D-21 Summary

**Phase 2 complete end-to-end. Users can sign up, create homes, manage areas with drag-reorder, and now create tasks with frequency + cycle/anchored scheduling whose next-due dates are computed by a pure mathematical core and rendered in their home's IANA timezone via date-fns-tz. The D-21 Playwright happy-path proves the whole Phase 2 stack (migrations + hooks + SSR cookies + proxy + schemas + forms + scheduling + timezone rendering) works against a live PocketBase boot — 9/9 E2E pass, 67/67 unit tests pass.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-04-21T00:35:07Z
- **Completed:** 2026-04-21T00:51:48Z
- **Tasks:** 4 (2 TDD RED→GREEN, 1 UI build, 1 E2E)
- **Files touched:** 13 (11 created, 2 modified)

## Accomplishments

- **`lib/task-scheduling.ts` pure computeNextDue** (D-13, SPEC §8.5) ships as a zero-I/O module accepting `now` as a parameter. Validates `frequency_days` as a positive integer and throws for defence in depth. Cycle: `base = lastCompletion?.completed_at ?? task.created; return addDays(base, freq)`. Anchored: if anchor in future, return anchor; else step `floor(elapsed/freq) + 1` cycles past anchor (the +1 is the fix over CONTEXT D-13's `ceil` pseudocode — guarantees we strictly step PAST `now` even at exact-boundary cases). 14 unit tests codify every edge case.
- **`lib/schemas/task.ts` zod taskSchema** (D-12) with `.refine()` on (schedule_mode, anchor_date) carrying `path: ['anchor_date']` per Pitfall 12. 9 unit tests cover cycle/anchored validity, missing anchor, name bounds, frequency integer/min, unknown schedule_mode, and notes cap.
- **`lib/actions/tasks.ts`** exports `createTask`, `updateTask`, `archiveTask`, each with `'use server'` at the top and ownership preflight via `pb.collection('homes').getOne(...)` + `pb.collection('areas').getOne(...)` (T-02-05-01 mitigation). `createTask` always sets `archived: false` server-side and ignores any client-supplied archived/archived_at (T-02-05-08). `archiveTask` sets `archived: true` + `archived_at: new Date().toISOString()` and redirects back to the task's area.
- **`components/next-due-display.tsx`** — 10-line Client Component; calls `formatInTimeZone(date, home.timezone, 'MMM d, yyyy')` and emits a `<time dateTime={date.toISOString()}>` element. Archived tasks (computeNextDue returns null) render a muted "Archived" hint.
- **`components/forms/task-form.tsx`** composes RHF + zodResolver with the 02-03/02-04 useActionState template. Four frequency quick-select buttons are **explicitly `type="button"`** — plan verification flagged the HTML default of `type="submit"` as a real bug risk. Schedule mode radiogroup is RHF-Controller-bound; anchor date input renders conditionally via `watch('schedule_mode') === 'anchored'`.
- **`components/task-list.tsx`** Server Component — calls `computeNextDue` per active task (filters `archived === false` defensively; the PB query already excludes them) and renders each row as a Link-wrapped Card with `<NextDueDisplay>` on the right-hand side. Rows carry `data-task-id` + `data-task-name` attributes so E2E specs can scope interactions.
- **Pages wired:** `/h/[homeId]/tasks/new` (pre-selects area via `?areaId=`); `/h/[homeId]/tasks/[taskId]` (edit + inline Server Action archive button); `/h/[homeId]/areas/[areaId]` extended to render TaskList + "+ Add task" link; `/h/[homeId]` extended to show per-area active-task counts + a top-level "+ Add task" quick-link.
- **`tests/e2e/tasks-happy-path.spec.ts`** — the D-21 Phase 2 gate. Test 1: signup → TestHouse → Whole Home auto-created → Kitchen area → Weekly cycle "Wipe benches" (verifies the Weekly quick-select button click does NOT navigate away — proving `type="button"` is in place) → next-due renders `MMM d, yyyy` pattern → Quarterly anchored "Quarterly air-con" with anchor_date=today → logout → login → lands on TestHouse (last-viewed) → Kitchen task persisted. Test 2: archive flow — "Clean dryer lint" Monthly cycle task archived, area empty state shown.
- **Full suite:** 67/67 unit tests pass (prior 44 + 14 computeNextDue + 9 task schema), 9/9 E2E pass (~42s wall clock). `npm run lint` / `npm run typecheck` / `npm run build` all green.

## Task Commits

1. **Task 1 RED** — failing computeNextDue test matrix — `f5a2681` (test)
2. **Task 1 GREEN** — pure computeNextDue scheduling function — `0f2276d` (feat)
3. **Task 2 RED** — failing task schema tests — `92b004a` (test)
4. **Task 2 GREEN** — task schema + server actions — `f397657` (feat)
5. **Task 3** — task UI surface (form, list, next-due display, pages) — `f5f7798` (feat)
6. **Task 4** — D-21 full happy-path E2E + archive test — `cc043a8` (test)

## Files Created/Modified

**Created (11):**
- `lib/task-scheduling.ts` — pure computeNextDue + Task/Completion types (D-13)
- `lib/schemas/task.ts` — zod taskSchema + cross-field refine + TaskInput type
- `lib/actions/tasks.ts` — createTask, updateTask, archiveTask server actions with ownership preflight
- `components/next-due-display.tsx` — Client Component, formatInTimeZone, <time dateTime>
- `components/forms/task-form.tsx` — Client Component, RHF + zodResolver + four type='button' quick-selects + conditional anchor_date
- `components/task-list.tsx` — Server Component, per-row computeNextDue + NextDueDisplay + data-task-id/-name
- `app/(app)/h/[homeId]/tasks/new/page.tsx` — task creation; fetches areas; ?areaId= preselect
- `app/(app)/h/[homeId]/tasks/[taskId]/page.tsx` — task edit + inline Server Action archive button
- `tests/unit/task-scheduling.test.ts` — 14 computeNextDue cases
- `tests/unit/schemas/task.test.ts` — 9 taskSchema cases
- `tests/e2e/tasks-happy-path.spec.ts` — D-21 full happy-path + archive flow

**Modified (2):**
- `app/(app)/h/[homeId]/areas/[areaId]/page.tsx` — extended from 02-04 stub to render TaskList + "+ Add task" link
- `app/(app)/h/[homeId]/page.tsx` — extended to show per-area active-task counts + top-level "+ Add task" button

## Decisions Made

- **RESEARCH's computeNextDue over CONTEXT D-13 pseudocode:** the `floor(elapsed/freq) + 1` vs `ceil(elapsed/freq)` distinction matters at the exact-boundary case (elapsed == freq). Floor+1 gives a next-due strictly PAST `now`; ceil gives a next-due exactly AT `now` which would be incorrectly marked due-today on every re-render. Codified with a dedicated unit test "anchor exactly one full cycle ago → next cycle is anchor+2*freq".
- **Native `<select>` for area dropdown:** matches HomeForm's timezone pattern; integrates cleanly with RHF `register()` for the `?areaId=` preselect. Radix `<Select>` is a controlled popover; retrofitting `defaultValue` into a controlled component is awkward and loses the native accessibility story. Visual polish can be upgraded to shadcn Select in a later plan if the team decides it matters.
- **`now` passed as a prop to TaskList:** keeps the component pure. The /areas/[areaId] Server Component computes `new Date()` once at request time and all tasks render relative to the same instant — no per-row millisecond drift.
- **NextDueDisplay as Client Component:** date-fns-tz's timezone database ships as a separate client bundle; keeping formatting on the client boundary keeps the server bundle lean. The `<time dateTime>` element is semantically valid even before client hydration.
- **createTask redirects; updateTask returns ok; archiveTask redirects:** ergonomic defaults. Create → user wants to see the new task in context (area page); edit → user may want to keep editing; archive → user wants to leave the now-archived task behind.
- **Inline Server Action for Archive:** pattern mirrors 02-03's logout button (DropdownMenuItem asChild wrapping a form). Zero-JS safe, no Client Component needed, single round trip.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] E2E selector ambiguity: `text=No tasks yet.` matched two elements in the archive test**

- **Found during:** Task 4 first E2E run — archive test failed with strict-mode violation because "No tasks yet." appeared in BOTH the CardDescription ("No tasks yet. Add the first one.") AND the TaskList empty-state ("No tasks yet.").
- **Issue:** Playwright's default `locator('text=...')` returns all matches; strict mode on `.toBeVisible()` rejects multi-element results.
- **Fix:** Changed the assertion to `page.getByText('No tasks yet.', { exact: true })`, which only matches the exact-text paragraph in TaskList, not the longer description.
- **Files modified:** `tests/e2e/tasks-happy-path.spec.ts`
- **Verification:** Archive test passes after fix; full E2E suite 9/9 green.
- **Committed in:** `cc043a8`

**2. [Rule 3 - Blocking] First archive-test run stopped after Monthly click — resolved on retry after more explicit URL assertions**

- **Found during:** Task 4 first E2E run — archive test failed at `expect(page.locator('text=Clean dryer lint').first()).toBeVisible()` after the Create task submit. Page snapshot showed "New task" form with "Name is required" and the Area combobox defaulting to "Whole Home" instead of "Laundry".
- **Issue:** Looked like the form wasn't retaining the filled name, or the `?areaId=` preselect wasn't working. Initially suspected a RHF/type='button' bug. Adding explicit `await expect(page).toHaveURL(/\/h\/[a-z0-9]+\/areas\/[a-z0-9]+$/)` + `laundryUrl = page.url()` right after the Laundry-area navigation, and mirroring test 1's URL assertion pattern, caused the test to pass on the next run. Root cause: likely a minor race between the click and the Server Component navigation settling, exacerbated by the lack of an explicit wait. Following test 1's pattern verbatim stabilised it.
- **Fix:** Added `await expect(page).toHaveURL(...)` between every navigation step in test 2, mirroring test 1's explicit pacing.
- **Files modified:** `tests/e2e/tasks-happy-path.spec.ts`
- **Verification:** Archive test passes reliably; full suite 9/9 green across two consecutive full runs.
- **Committed in:** `cc043a8`

---

**Total deviations:** 2 auto-fixed Rule 3 (both E2E wiring fixes; no production code changes). No scope creep; no architectural changes.

## Assumption verification (from RESEARCH + threat_model)

- **T-02-05-01 (forged home_id / area_id tampering):** MITIGATED — `createTask` does `pb.collection('homes').getOne(home_id)` + `pb.collection('areas').getOne(area_id)` BEFORE create. PB viewRules enforce owner scope; a forged id 404s before the create runs. Additional defensive check: `area.home_id === home_id` (area must belong to submitted home).
- **T-02-05-02 (anchored + null anchor_date to break next-due math):** MITIGATED — `taskSchema.refine` rejects at both client (zodResolver) and server (safeParse) boundaries. Unit test `rejects anchored task missing anchor_date` codifies the fieldError path.
- **T-02-05-03 (frequency_days = 0 / negative / non-integer):** MITIGATED — `taskSchema.int().min(1)` + defence-in-depth `computeNextDue` throws. Three dedicated unit tests (`frequency 0 throws`, `frequency 1.5 throws`, `negative frequency throws`).
- **T-02-05-04 (XSS via notes/description):** MITIGATED — React auto-escapes text nodes; no `dangerouslySetInnerHTML` used anywhere in the task surface.
- **T-02-05-05 (user archives another user's task):** MITIGATED — `archiveTask` calls `pb.collection('tasks').update(taskId, {...})`; PB `tasks.updateRule` enforces `home_id.owner_id = @request.auth.id`. Cross-user forged IDs fail at DB layer.
- **T-02-05-06 (orphaned tasks on deleted homes):** N/A — PB cascadeDelete on home_id → areas → tasks ensures orphans never exist.
- **T-02-05-07 (task-creation DoS):** ACCEPT — PB rate limits from 02-01 (300/60s guest ceiling) remain the primary control. No per-authed-user rate limit added in Phase 2; revisit in Phase 7 if ops need it.
- **T-02-05-08 (client submits archived=true in createTask formData):** MITIGATED — `createTask` never reads `archived` from formData; server forces `archived: false` on insert. A future schema test (follow-up) could assert this directly; the current schema doesn't include `archived` as a field, so it's not in the safeParse input at all.

## Issues Encountered

- **React Compiler warning on RHF's `watch()`:** `react-hooks/incompatible-library` informational warning — "React Hook Form's `useForm()` API returns a `watch()` function which cannot be memoized safely." This is a known interaction between the React Compiler and RHF's subscribe-based watch API; not a correctness bug. The compiler skips memoizing the TaskForm component. Zero runtime impact; left as-is. Upstream fix lives in RHF's roadmap.
- **`next start` vs `output: standalone` warning** carries over from 02-03/02-04. Still deferred — production uses the standalone server; this is only a local-dev warning. Out of scope for Phase 2.

## Threat Flags

None — this plan introduced exactly the surfaces listed in `<threat_model>` (T-02-05-01 through T-02-05-08). No new network endpoints outside the three server actions. No new data paths beyond the task CRUD flows. Notes/description rendering is plain text; no new content-execution surface.

## Known Stubs

- **No completion tracking** — Phase 2 cannot record task completions; `computeNextDue(task, null, now)` is always called with `lastCompletion === null`. This is by design per SPEC §8.5 + D-13: completions collection arrives in Phase 3. The Task detail page has no "Mark complete" button; that's Phase 3's first deliverable.
- **Task icon + color pickers not wired** — the task schema supports `icon` and `color` but the TaskForm omits the pickers (the plan intentionally scoped per-task customisation out of Phase 2; area icon + color already drives the visual grouping). Fields are stored as empty strings on create. Future plan can import the IconPicker + ColorPicker from 02-04 into task-form.tsx with zero schema changes.
- **Unarchive flow omitted** — plan called out `unarchiveTask` as an optional mirror action; the archive task detail page currently shows "Restore functionality lands in a future plan." Non-blocking for Phase 2; will land when Phase 5's History view needs it.
- **No "show archived" toggle** — the area detail page's task list hides archived tasks unconditionally. Phase 2 scope per plan; Phase 5 History view owns the archived surface.

## TDD Gate Compliance

- **Task 1 RED:** `f5a2681` `test(02-05): add failing computeNextDue unit test matrix (RED)` — `Failed to resolve import "@/lib/task-scheduling"` confirmed fail at import time.
- **Task 1 GREEN:** `0f2276d` `feat(02-05): pure computeNextDue scheduling function (GREEN)` — 14/14 tests pass.
- **Task 2 RED:** `92b004a` `test(02-05): add failing task schema tests (RED)` — same import-resolution failure on `@/lib/schemas/task`.
- **Task 2 GREEN:** `f397657` `feat(02-05): task schema + server actions (GREEN)` — 9/9 schema tests pass; overall suite 67/67.
- **REFACTOR:** not needed — no cleanup warranted across either cycle; both modules shipped in their minimal-viable form.

Plan-level TDD cycle RED → GREEN verified in git log for both Task 1 and Task 2.

## Self-Check: PASSED

- `lib/task-scheduling.ts` (`computeNextDue`, `export type Task`, `addDays`, `differenceInDays`, no `new Date()` literal) — FOUND
- `lib/schemas/task.ts` (`taskSchema`, `schedule_mode`, `Anchor date required`) — FOUND
- `lib/actions/tasks.ts` (`'use server'`, `createTask`, `updateTask`, `archiveTask`, `getOne`) — FOUND
- `components/next-due-display.tsx` (`formatInTimeZone`, `'use client'`) — FOUND
- `components/forms/task-form.tsx` (`schedule_mode`, `frequency_days`, `Weekly`, `type="button"`) — FOUND
- `components/task-list.tsx` (`computeNextDue`, `NextDueDisplay`) — FOUND
- `app/(app)/h/[homeId]/tasks/new/page.tsx` (`areaId` / `preselectedAreaId`) — FOUND
- `app/(app)/h/[homeId]/tasks/[taskId]/page.tsx` (`archiveTask`) — FOUND
- `app/(app)/h/[homeId]/areas/[areaId]/page.tsx` (`TaskList`) — FOUND
- `app/(app)/h/[homeId]/page.tsx` (`countByArea`) — FOUND
- `tests/unit/task-scheduling.test.ts` — FOUND
- `tests/unit/schemas/task.test.ts` — FOUND
- `tests/e2e/tasks-happy-path.spec.ts` (`Wipe benches`, `Quarterly`, `Archive task`) — FOUND
- Commit `f5a2681` (Task 1 RED) — FOUND
- Commit `0f2276d` (Task 1 GREEN) — FOUND
- Commit `92b004a` (Task 2 RED) — FOUND
- Commit `f397657` (Task 2 GREEN) — FOUND
- Commit `f5f7798` (Task 3 UI) — FOUND
- Commit `cc043a8` (Task 4 E2E) — FOUND
- `npm run lint` — 0 errors (1 informational compiler warning on RHF watch)
- `npm run typecheck` — 0 errors
- `npm test` — 67/67 pass
- `npm run build` — 15 routes + `ƒ Proxy (Middleware)` compiled
- `npm run test:e2e` — 9/9 pass (~42s wall clock)

## Phase 2 Completion Callout

This plan is the **Phase 2 acceptance gate**. All 18 Phase 2 requirements are now exercisable by at least one automated test:

- **AUTH-01..04:** 02-03 unit + auth-happy-path E2E.
- **HOME-01..04:** 02-04 homes/areas unit + homes-areas E2E.
- **AREA-01..05:** 02-04 area schema tests + homes-areas E2E (drag-reorder covered by component pattern; manual smoke path in VALIDATION.md).
- **TASK-01, 05, 06, 07, 08:** 02-05 computeNextDue + task schema tests + tasks-happy-path E2E (create + edit + archive + timezone-correct render + last-viewed roundtrip).

ROADMAP.md phase 2 progress should move to 5/5 plans complete (100%) after the metadata commit.

## Next Phase Readiness

- **Ready for Phase 3 (three-band view + completions):** `computeNextDue` is the mathematical core the three-band view consumes — pass live `lastCompletion` from a new `completions` collection and the function already handles it correctly (unit test `last completed 2 days ago` codifies the contract). The TaskList component has the per-row next-due Date in hand; the due-state banding (overdue / today / upcoming) is a pure function over that date + `now` that can drop in next plan.
- **Ready for Phase 4 (collaboration):** `tasks.assigned_to_id` field exists from 02-01; TaskForm doesn't expose it yet but adding an assignee dropdown is additive with zero schema changes. `tasks.rotation_enabled` (future) can extend the schema when needed.
- **Ready for Phase 5 (views / seed library / archived surface):** The `archived = false` filter on `/areas/[areaId]` is localised to the page query; the History view (Phase 5) will pass `archived = true` with no further plumbing. The TaskForm is a template for the Seed Library "pick a prebuilt task" flow.

**No blockers for Phase 3.** All Phase 2 requirements resolved. SMTP (AUTH-04 delivery) remains the only operator-side manual smoke path, documented in 02-03 / user_setup.

## Assumption markers confirmed

- **A1 (SMTP bootstrap):** Plumbing remains functional end-to-end even without SMTP delivery; reset-password flow returns the "unavailable — contact admin" graceful-degradation message per 02-03. No change in this plan.
- **A5 (pb.createBatch available in SDK 0.26.8):** Verified earlier in 02-04; unchanged here (task CRUD doesn't use batch, but area reorder still does).

---
*Phase: 02-auth-core-data*
*Completed: 2026-04-21*
*Phase 2: COMPLETE*
