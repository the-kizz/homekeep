# HomeKeep "Functioning Properly" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shipped HomeKeep code correct and hermetic on any host: scheduler notifies on the dates the UI shows, seasonal/one-off scheduling has no year-skip or stale-date bugs, onboarding produces a usable By Area view with correct seasons, the suite is green regardless of host timezone, the image runs with a plain bind mount, dark mode and a real desktop layout exist, and the public-facing claims in the repo are true.

**Architecture:** Six independent work streams (A–F), each owning a disjoint set of files so they can run in parallel on separate git worktrees/branches and merge cleanly. Every stream ends with lint + typecheck + its own tests green under `TZ=UTC`. The controller merges A→F in order, runs the full suite and a Docker smoke test, then dispatches a final review.

**Tech Stack:** Next.js 16.2 (App Router, server actions, `--webpack` build), React 19, PocketBase 0.37.1 (JSVM hooks + migrations), Tailwind 4 + shadcn/radix, zod 4, date-fns + date-fns-tz, vitest 4 (jsdom + real-PB integration tests spawning `./.pb/pocketbase` on ports 18090+), Playwright 1.59.

**Spec:** `.planning/REVIEW-2026-10-09.md` (sections 2, 3, 4, 6 are the requirements; this plan is its argument). Original product spec: `SPEC.md`.

## Global Constraints

- Node `>=22`. Do not change the Next.js major, `--webpack` build flag, or Serwist (`next.config.ts:13-20`).
- All PocketBase schema changes are new migration files under `pocketbase/pb_migrations/` with a timestamp prefix ≥ `1745280007`; never edit an existing migration. **No stream in this plan needs a migration.**
- Every PB filter that embeds a value uses `pb.filter('… {:key}', { key })`, never template literals.
- Server actions keep the existing shape: zod `safeParse` → `createServerClient()` → `assertMembership`/`assertOwnership` → PB write → return `ActionState`-style discriminated unions.
- Do not add runtime dependencies. `next-themes@0.4.6` and `radix-ui` are already installed.
- Tests: new unit tests go in `tests/unit/`, mirror existing naming (`<module>.test.ts`). Integration tests that spawn PB must use a port from the register below and claim it in the file header. **Register (after this plan): 18090–18106 taken; A claims 18107 (scheduler-projection), B claims 18108 (seed-areas). 18109+ free.**
- Each stream runs only: `npm run lint`, `npm run typecheck`, and `TZ=UTC npx vitest run <its own test files>`. Do NOT run the whole vitest suite inside a stream (parallel streams would collide on PB ports). The controller runs the full suite after merge.
- Commit messages: conventional (`fix(scope): …`, `feat(scope): …`, `test(scope): …`, `docs: …`). Atomic commits. End each commit body with the attribution trailer the controller provides.
- Comments: write *why*, not which plan decided it. Do not add new `Phase N` / `D-NN` / `T-NN` references. You may delete such references in lines you are already editing; do not do mass comment cleanup (that is deliberately out of scope).
- Copy and tone: calm, domestic, lower-case sentence case in UI strings, no exclamation marks except the existing toast "welcome in."
- Do not touch files owned by another stream (ownership table below). If you believe you must, stop and report `NEEDS_CONTEXT`.
- Do not push, do not change `docker/docker-compose*.yml` ports, do not deploy.

## File ownership (exclusive per stream)

| Stream | Owns (may create/modify) |
|---|---|
| A | `lib/scheduler.ts`, `lib/task-scheduling.ts`, `vitest.config.ts`, `tests/unit/scheduler*.test.ts`, `tests/unit/task-scheduling.test.ts`, `tests/unit/task-extensions*.test.ts`, `tests/unit/seasonal-rendering.test.ts`, `tests/unit/horizon-strip.test.tsx`, `tests/unit/last-viewed-home-idor.test.ts`, new `tests/unit/scheduler-projection-integration.test.ts` |
| B | `lib/seed-library.ts`, `lib/actions/seed.ts`, `lib/schemas/seed.ts`, `components/onboarding-wizard.tsx`, `components/seed-task-card.tsx`, `app/(app)/h/[homeId]/onboarding/page.tsx`, `tests/unit/seed-library.test.ts`, `tests/unit/schemas/seed.test.ts`, `tests/unit/actions/seed-tcsem.test.ts`, new `tests/unit/seed-areas-integration.test.ts`, `tests/e2e/onboarding.spec.ts` |
| C | `lib/actions/tasks.ts`, `lib/actions/reschedule.ts`, `lib/pocketbase-server.ts`, `lib/pocketbase-admin.ts`, `lib/pocketbase.ts`, `app/api/health/route.ts`, `lib/constants.ts`, `tests/unit/actions/tasks-tcsem.test.ts`, `tests/unit/actions/reschedule-actions.test.ts`, `tests/unit/pocketbase-server.test.ts`, `tests/unit/pocketbase.test.ts`, `tests/unit/health.test.ts`, `.env.example`, `docker/Dockerfile` (entrypoint/permissions only) |
| D | `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `app/globals.css` (comment line 18 only), `.github/FUNDING.yml`, `.github/workflows/release.yml`, `docs/deployment.md`, `docs/deployment-hardening.md`, `.gitignore` |
| E | `package.json`, `package-lock.json`, `next.config.ts` (only if a dep bump forces it), `.github/workflows/ci.yml` (TZ env only), `.github/dependabot.yml` |
| F | `app/layout.tsx`, `components/account-menu.tsx`, new `components/theme-provider.tsx`, new `components/theme-toggle.tsx`, `app/(app)/h/[homeId]/page.tsx` (max-width only), `components/band-view.tsx` (layout wrapper only, see Stream G note), `components/nav-shell.tsx`, `components/top-tabs.tsx`, `components/coverage-ring.tsx`, `components/most-neglected-card.tsx`, `components/horizon-strip.tsx`, `tests/unit/coverage-ring.test.tsx`, `tests/unit/components/horizon-strip-density.test.tsx`, new `tests/unit/components/theme-toggle.test.tsx`, new `tests/unit/components/band-view-layout.test.tsx`, `tests/e2e/views.spec.ts` |
| G | `components/task-row.tsx`, `components/task-band.tsx`, `components/person-task-list.tsx`, `components/band-view.tsx` (handler wiring only), `components/forms/task-form.tsx`, new `components/welcome-card.tsx`, `app/(app)/h/[homeId]/page.tsx` (one `<WelcomeCard>` line only), `app/(app)/h/[homeId]/person/page.tsx`, `app/(app)/h/[homeId]/settings/page.tsx`, new `app/(app)/h/[homeId]/settings/notifications/page.tsx`, `components/notification-prefs-form.tsx`, `tests/unit/task-row.test.tsx`, `tests/unit/components/task-form-ooft.test.tsx`, new `tests/unit/components/welcome-card.test.tsx`, `tests/e2e/notifications.spec.ts` |

Shared read-only context for every stream: `lib/task-scheduling.ts` exports `computeNextDue(task, lastCompletion, now, override?, timezone?)`, `isInActiveWindow(month, from, to)`, `nextWindowOpenDate(now, from, to, timezone)`, `isOoftTask(task)`, type `Task` (fields: `id, created, archived, frequency_days, schedule_mode, anchor_date, due_date?, preferred_days?, active_from_month?, active_to_month?, next_due_smoothed?, reschedule_marker?`).

---

## Stream A — Scheduler correctness and hermetic tests

### Task A1: Pin the test process to UTC and dedupe the PB port collision

**Files:**
- Modify: `vitest.config.ts`
- Modify: `tests/unit/last-viewed-home-idor.test.ts:30-35` (port 18100 → 18109 is NOT allowed; use **18107 is reserved for A3**, so use **18110** here and claim it in the header comment)

- [ ] In `vitest.config.ts`, before `defineConfig`, add `process.env.TZ = 'UTC';` with a one-line comment: scheduling math is asserted as UTC instants; the Dockerfile sets no TZ, so production is UTC too, and the code must still be tz-safe (A2).
- [ ] Change the port in `last-viewed-home-idor.test.ts` from `18100` to `18110` (constant and header comment). `load-smoothing-integration.test.ts` keeps 18100.
- [ ] Run `npx vitest run tests/unit/last-viewed-home-idor.test.ts tests/unit/load-smoothing-integration.test.ts` **without** `TZ=UTC` in the shell (the config must set it). Expected: both pass.
- [ ] Commit: `test: pin vitest to UTC and move IDOR integration test off port 18100`

### Task A2: Make `nextWindowOpenDate` host-timezone independent and fix the in-season wake-up year skip

**Files:**
- Modify: `lib/task-scheduling.ts:336-348` (wake-up guard) and `:515-528` (`nextWindowOpenDate`)
- Test: `tests/unit/task-scheduling.test.ts`, `tests/unit/task-extensions.test.ts`

Bug 1 (host tz): `nextWindowOpenDate` builds `new Date(Date.UTC(targetYear, from-1, 1))` then calls `fromZonedTime(localMidnight, timezone)`. `fromZonedTime` interprets the Date's *local wall-clock fields*, so on a non-UTC host the result shifts by the host offset. Fix: construct the wall-clock string instead:

```ts
// Midnight on the 1st of `from` month in the home's timezone, as a UTC instant.
const wall = `${targetYear}-${String(from).padStart(2, '0')}-01T00:00:00`;
return fromZonedTime(wall, timezone);
```

Bug 2 (year skip): the guard `if (lastInPriorSeason && !(inWindowNow && !lastCompletion))` only exempts fresh tasks. When `inWindowNow` is true and the last completion was in a prior season, the task is awake and should fall through to natural cadence, not jump to next year's window. Replace the condition with `if (lastInPriorSeason && !inWindowNow)` and update the comment to say: a task whose current month is inside its window is already awake; wake-up dates only apply while dormant.

- [ ] Write failing tests in `tests/unit/task-scheduling.test.ts` under a new `describe('seasonal wake-up — in-window with prior-season completion')`:
  1. window Oct–Mar, `lastCompletion` = `2025-11-15T00:00:00Z`, `now` = `2026-11-10T00:00:00Z`, `frequency_days: 14`, tz `UTC` → result equals the natural cycle date (`2025-11-29` is in the past, so expect `computeNextDue` to return a date `<= now` or the anchored formula result, whichever the existing cycle branch yields — assert `result.getUTCFullYear() === 2025 || result <= now`, and explicitly assert `result.getUTCFullYear() !== 2027`).
  2. Same but `now` = `2026-07-10` (out of window) → `2026-10-01T00:00:00Z` (unchanged behaviour).
- [ ] Write a failing host-tz test in `tests/unit/task-extensions.test.ts`: temporarily set `process.env.TZ` is not possible after start, so instead assert the pure contract with a timezone argument: `nextWindowOpenDate(new Date('2026-04-15T12:00:00Z'), 10, 3, 'Australia/Perth').toISOString() === '2026-09-30T16:00:00.000Z'` and `nextWindowOpenDate(new Date('2026-02-01T00:00:00Z'), 4, 9, 'America/New_York').toISOString() === '2026-04-01T04:00:00.000Z'`.
- [ ] Run `TZ=Australia/Melbourne npx vitest run tests/unit/task-scheduling.test.ts tests/unit/task-extensions.test.ts tests/unit/seasonal-rendering.test.ts tests/unit/task-extensions-integration.test.ts tests/unit/seasonal-ui-integration.test.ts tests/unit/horizon-strip.test.tsx` (override the config TZ on purpose). Before the fix: the 15 timezone failures listed in the review §1. After: all pass. If `horizon-strip.test.tsx` still fails ("expected 'Mar' to match /Apr/"), fix the test to derive the expected label from the `now` it passes, in UTC.
- [ ] Also run the same set with the default (UTC). Pass.
- [ ] Commit: `fix(scheduling): tz-safe nextWindowOpenDate; in-season seasonal tasks no longer skip a year`

### Task A3: Scheduler reads the full task projection and the home timezone; one tick at a time

**Files:**
- Modify: `lib/scheduler.ts:189-270` (`processOverdueNotifications`), `:273-380` (`processWeeklySummaries`), `:134-187` (`runOnce`)
- Test: `tests/unit/scheduler.test.ts` (existing, port 18097), new `tests/unit/scheduler-projection-integration.test.ts` (port **18107**)

- [ ] In both `getFullList` calls replace the `fields:` projection with the full scheduling set: `'id,home_id,area_id,name,frequency_days,schedule_mode,anchor_date,created,archived,due_date,preferred_days,active_from_month,active_to_month,next_due_smoothed,reschedule_marker'`.
- [ ] Fetch the home's timezone once per home (the homes loop already has the home record or id; use `pb.collection('homes').getOne(homeId, { fields: 'id,timezone' })` if not present) and pass it as the 5th argument to every `computeNextDue(...)` call in this file. Default `'UTC'` when empty.
- [ ] Add a module-level `let ticking = false;` guard inside `runOnce`: if `ticking` is true, log `[scheduler] tick skipped — previous tick still running` and return `{ skipped: true }` (extend the return type accordingly); set `ticking = true` in a `try` and reset in `finally`. The cron callbacks and the admin route both go through `runOnce`; verify this by reading `app/api/admin/run-scheduler/route.ts` (read-only, owned by nobody) — if the route calls `processOverdueNotifications` directly, route it through `runOnce` instead (you may edit that route file for this one change; note it in your report).
- [ ] New integration test `tests/unit/scheduler-projection-integration.test.ts` (copy the PB bootstrap pattern from `tests/unit/scheduler.test.ts`, port 18107): create a home in tz `Australia/Perth`, a user with `ntfy_topic` and `notify_overdue=true`, two tasks: (a) cycle task `frequency_days: 7`, last completion 10 days ago, `next_due_smoothed` = tomorrow; (b) seasonal task window Apr–Sep (`active_from_month: 4, active_to_month: 9`), `frequency_days: 14`, no completions, run with `now` in November. Stub `sendNtfy` (`vi.mock('@/lib/ntfy')`). Run `processOverdueNotifications(now)` (add an optional `now` parameter if the function reads `new Date()` internally; default to `new Date()`). Assert: **zero** notifications rows for both tasks. Then a third task (c) cycle `frequency_days: 3`, last completion 5 days ago, `next_due_smoothed` empty → exactly one notification row, and calling `processOverdueNotifications(now)` again creates no second row.
- [ ] Add a unit test for the `ticking` guard in `tests/unit/scheduler.test.ts`: call `runOnce()` twice without awaiting the first; the second resolves with `{ skipped: true }`.
- [ ] Run `TZ=UTC npx vitest run tests/unit/scheduler.test.ts tests/unit/scheduler-projection-integration.test.ts`. Pass.
- [ ] Commit: `fix(scheduler): use full task projection + home timezone so pushes match the dashboard; guard overlapping ticks`

### Task A4: One-off branch wins over a stale smoothed date

**Files:**
- Modify: `lib/task-scheduling.ts:255-262` and `:355-360`
- Test: `tests/unit/task-scheduling.test.ts`

- [ ] Move the `if (isOoft) { … }` short-circuit to run **before** the smoothed branch (it is already computed near the top; just relocate the return). A one-off task with a leftover `next_due_smoothed` must return `due_date`.
- [ ] Failing test: `frequency_days: null, due_date: '2026-12-01T00:00:00Z', next_due_smoothed: '2026-10-20T00:00:00Z', schedule_mode: 'cycle'`, no completion → `2026-12-01T00:00:00.000Z`.
- [ ] Run `TZ=UTC npx vitest run tests/unit/task-scheduling.test.ts`. Pass. Also confirm the "branch composition matrix" cases still pass.
- [ ] Commit: `fix(scheduling): one-off due_date takes precedence over a stale smoothed date`

---

## Stream B — Onboarding that produces real areas, correct seasons, calm first run

### Task B1: Seed library — hemisphere-correct seasons

**Files:**
- Modify: `lib/seed-library.ts:30-56` (type), `:305-347` (seasonal entries)
- Test: `tests/unit/seed-library.test.ts`

Replace fixed months with a `season: 'warm' | 'cool'` tag on the four seasonal seeds and export a resolver:

```ts
export type Hemisphere = 'north' | 'south';
export type SeedSeason = 'warm' | 'cool';

/** Warm = Apr–Sep north / Oct–Mar south. Cool is the complement. */
export function seasonWindow(season: SeedSeason, hemisphere: Hemisphere): { active_from_month: number; active_to_month: number } {
  const warmNorth = { active_from_month: 4, active_to_month: 9 };
  const coolNorth = { active_from_month: 10, active_to_month: 3 };
  if (hemisphere === 'north') return season === 'warm' ? warmNorth : coolNorth;
  return season === 'warm' ? coolNorth : warmNorth;
}

/** Southern hemisphere if the IANA zone is in Australia, NZ, southern Africa or South America; else north. */
export function hemisphereFromTimezone(tz: string): Hemisphere {
  if (/^(Australia|Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Apia))\//.test(tz) || /^Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Apia)$/.test(tz)) return 'south';
  if (/^Africa\/(Johannesburg|Maputo|Harare|Windhoek|Lusaka|Gaborone|Maseru|Mbabane|Blantyre)$/.test(tz)) return 'south';
  if (/^America\/(Sao_Paulo|Buenos_Aires|Argentina\/|Santiago|Montevideo|Asuncion|La_Paz|Lima)/.test(tz)) return 'south';
  if (/^Antarctica\//.test(tz) || /^Indian\/(Mauritius|Reunion)$/.test(tz)) return 'south';
  return 'north';
}
```

Seasonal seeds become: "Mow lawn (warm season)" `season: 'warm'`, "Mow lawn (cool season)" `season: 'cool'`, "Service air conditioner" `season: 'warm'`, "Service heater" `season: 'cool'`. Remove their hard-coded `active_from_month/active_to_month`. Keep the `active_*` fields on the `SeedTask` type as optional for any non-seasonal override (none today).

- [ ] Failing tests: `seasonWindow('warm','south')` → `{4? no: {10,3}}`; `seasonWindow('cool','south')` → `{4,9}`; `hemisphereFromTimezone('Australia/Perth')` → `'south'`; `'Europe/London'` → `'north'`; `'America/Sao_Paulo'` → `'south'`; every seed with `season` has no `active_from_month`; exactly 4 seeds carry `season`; the two "Mow lawn" seeds have opposite seasons; heater is `cool`, air conditioner is `warm`.
- [ ] Run `TZ=UTC npx vitest run tests/unit/seed-library.test.ts`. Pass.
- [ ] Commit: `fix(seeds): seasonal seeds resolve by hemisphere; heater/aircon/mowing no longer contradict each other`

### Task B2: Seed action — server-authoritative payload, quota, hemisphere, areas, calm first-due

**Files:**
- Modify: `lib/actions/seed.ts`, `lib/schemas/seed.ts`
- Test: `tests/unit/actions/seed-tcsem.test.ts`, `tests/unit/schemas/seed.test.ts`, new `tests/unit/seed-areas-integration.test.ts` (port **18108**)

New input contract (produced for B3):

```ts
export type SeedSelectionInput = {
  seed_id: string;
  name?: string;            // optional override, max 100
  frequency_days?: number;  // optional override, int 1..365
  area: { kind: 'existing'; id: string } | { kind: 'suggested'; key: 'kitchen'|'bathroom'|'living'|'yard'|'whole_home' };
};
export async function batchCreateSeedTasks(input: { home_id: string; selections: SeedSelectionInput[] }): Promise<{ ok: true; count: number; areasCreated: number } | { ok: false; formError: string }>
```

Behaviour:
1. `name`/`frequency_days` default from `SEED_LIBRARY` by `seed_id`; overrides are validated by the schema.
2. Call `assertTasksQuota(pb, home_id)` from `lib/quotas.ts` (read its signature; it counts active tasks and throws/returns on breach) and refuse the batch if `existing + selections.length > MAX_TASKS_PER_HOME`. Return `formError: 'This home has reached its task limit'`.
3. For `area.kind === 'suggested'` with key ≠ `whole_home`: find an existing area in this home whose lower-cased name equals the label (`Kitchen`, `Bathroom`, `Living areas`, `Yard`); otherwise create it via `pb.collection('areas').create({ home_id, name, icon, color, scope: 'location', sort_order })` with icon/colour from the table below and `sort_order` = current max + 1. Create each needed area once (dedupe by key) **before** the batch; respect `assertAreasQuota` (if creating would exceed `MAX_AREAS_PER_HOME`, fall back to Whole Home for those seeds and report `areasCreated` honestly). `whole_home` maps to the `is_whole_home_system` area.

   | key | name | icon | color |
   |---|---|---|---|
   | kitchen | Kitchen | `cooking-pot` | `#C9A27E` |
   | bathroom | Bathroom | `bath` | `#9FB4C7` |
   | living | Living areas | `sofa` | `#B8A9A0` |
   | yard | Yard | `trees` | `#9BAE8C` |

   Check each icon name exists in `lucide-react@1.8.0` (`node -e "console.log(Object.keys(require('lucide-react')).includes('CookingPot'))"`); substitute `utensils`, `droplets`, `armchair`, `tree-pine` if missing. Read `lib/area-palette.ts` and `lib/schemas/area.ts` first and use their colour/icon validators so the created areas pass the same rules as user-created ones.
4. Seasonal seeds: compute `active_from/to_month` with `seasonWindow(seed.season, hemisphereFromTimezone(home.timezone))`.
5. Calm first-due: instead of placing every seed within its first cycle, spread first-due dates: for seed index `i` in the batch with frequency `f`, pass a synthetic `lastCompletion.completed_at = now - (f * (i % 4) / 4)` days into the existing `placeNextDue` bridge (read the current TCSEM code in this file: it already builds a synthetic `lastCompletion` from `firstIdeal`). The effect: roughly a quarter of seeds due within the first quarter of their cycle, a quarter in the second, etc. Daily/3-day tasks (`f <= 3`) are exempt (always natural). Document the rule in one comment.
6. Keep the atomic `pb.createBatch()` for tasks + `homes.onboarded=true`. Area creation happens before the batch (not atomic with it; acceptable, areas are harmless if the batch fails).

- [ ] Update `lib/schemas/seed.ts` to the new `SeedSelectionInput` (discriminated `area` union; `name`, `frequency_days` optional). Update `tests/unit/schemas/seed.test.ts` accordingly (reject unknown `area.kind`, reject `frequency_days: 0`, accept a bare `{ seed_id, area: { kind: 'suggested', key: 'kitchen' } }`).
- [ ] Update `tests/unit/actions/seed-tcsem.test.ts` for the new contract (its mocks for `createServerClient`, `membership`, `load-smoothing` stay). Add a test: a selection with `name: 'x'.repeat(101)` → `formError`. Add a test: quota mock reporting 495 existing + 10 selections → `formError` about the task limit.
- [ ] New `tests/unit/seed-areas-integration.test.ts` (port 18108; copy the bootstrap pattern from `tests/unit/tcsem-integration.test.ts`): home in `Australia/Perth`; submit 6 seeds across kitchen/bathroom/yard/whole_home including both mow-lawn seeds. Assert: areas `Kitchen`, `Bathroom`, `Yard` now exist (and not `Living areas`), tasks reference them, `areasCreated === 3`, "Mow lawn (warm season)" has `active_from_month === 10 && active_to_month === 3`, "Service heater" (if included) has `4..9`. Submit again with 2 kitchen seeds → `areasCreated === 0` (reused). Assert `homes.onboarded === true`.
- [ ] Run `TZ=UTC npx vitest run tests/unit/schemas/seed.test.ts tests/unit/actions/seed-tcsem.test.ts tests/unit/seed-areas-integration.test.ts`. Pass.
- [ ] Commit: `feat(onboarding): seeds create real areas, respect quotas, resolve seasons by hemisphere, and spread first-due dates`

### Task B3: Wizard UI — area per seed, invite nudge, hemisphere note

**Files:**
- Modify: `components/onboarding-wizard.tsx`, `components/seed-task-card.tsx`, `app/(app)/h/[homeId]/onboarding/page.tsx`
- Test: `tests/e2e/onboarding.spec.ts`

- [ ] Selection state becomes `{ action, name, frequency_days, area: SeedSelectionInput['area'] }`, defaulting `area` to `{ kind: 'suggested', key: seed.suggested_area }`. The card's area control (`SeedTaskCard` Edit) lists existing areas **plus** the suggested area as "Kitchen (will be created)" when no area of that name exists yet. Pass `areas` through unchanged.
- [ ] Page passes `home.timezone`; the wizard shows one muted line under the header: `Seasonal tasks use <southern|northern>-hemisphere seasons based on your home's timezone (<tz>).` using `hemisphereFromTimezone` from `lib/seed-library.ts`.
- [ ] After a successful submit, the toast becomes `${count} tasks added across ${areasCreated + 1} areas — welcome in.` and navigation goes to `/h/${home.id}?welcome=1`. (Stream F owns the dashboard page and does **not** read this param; it is harmless. Do not add UI for it here.)
- [ ] Add an "Invite your partner" link-button in the sticky footer beside Add (href `/h/${home.id}/settings`, `variant="ghost"`, label `Invite someone`). It must not block submit.
- [ ] Update `tests/e2e/onboarding.spec.ts`: after submit, `GET /api/collections/areas/records?filter=home_id="…"` via the existing REST helpers returns ≥ 4 areas including `Kitchen`; and the By Area page (`/h/:id/by-area`) shows a card with text `Kitchen`. Keep existing assertions.
- [ ] `npm run lint && npm run typecheck`. Do not run Playwright locally (port 3001 is occupied on this host); state in the report that E2E was updated but not executed.
- [ ] Commit: `feat(onboarding): per-seed area with auto-create, hemisphere note, invite nudge`

---

## Stream C — Task edits stay correct; PB URL configurable; first-run permissions

### Task C1: Clear or recompute `next_due_smoothed` when a task's schedule changes

**Files:**
- Modify: `lib/actions/tasks.ts:374-560` (`updateTask`)
- Test: `tests/unit/actions/tasks-tcsem.test.ts`

Rule: in `updateTask`, after parsing, load the existing task (`getOne`, fields `frequency_days,schedule_mode,active_from_month,active_to_month,due_date,next_due_smoothed`). If any of `frequency_days`, `schedule_mode`, `active_from_month`, `active_to_month` changed, or the task switched to/from one-off, include `next_due_smoothed: ''` and `reschedule_marker: ''` in the update body. Otherwise leave both untouched. (Recompute is deliberately not done here; the next completion re-places it. Say so in a comment.)

- [ ] Failing tests (mock PB like the existing file does): (1) frequency 7→90 → update body contains `next_due_smoothed: ''`; (2) same frequency, name change only → body has no `next_due_smoothed` key; (3) cycle → one-off → body contains both clears.
- [ ] Run `TZ=UTC npx vitest run tests/unit/actions/tasks-tcsem.test.ts`. Pass.
- [ ] Commit: `fix(tasks): clear stale smoothed date and marker when a task's schedule changes`

### Task C2: Reschedule of a one-off writes `due_date`, not `next_due_smoothed`

**Files:**
- Modify: `lib/actions/reschedule.ts:140-200`
- Test: `tests/unit/actions/reschedule-actions.test.ts`

- [ ] In `rescheduleTaskAction`, when `isOoftTask(task)` (import from `lib/task-scheduling.ts`), "From now on" writes `{ due_date: iso, reschedule_marker: iso }` and never `next_due_smoothed`. "Just this time" on a one-off behaves the same as "From now on" (a one-off has one occurrence) — return the same success shape.
- [ ] Failing tests: one-off + from-now-on → update body has `due_date` and no `next_due_smoothed`; one-off + just-this-time → same body, no `schedule_overrides` create.
- [ ] Run `TZ=UTC npx vitest run tests/unit/actions/reschedule-actions.test.ts`. Pass.
- [ ] Commit: `fix(reschedule): one-off tasks reschedule their due date`

### Task C3: `PB_URL` env override + health check uses it

**Files:**
- Modify: `lib/constants.ts` (add `export const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';` with a comment that it is server-only), `lib/pocketbase-server.ts:24`, `lib/pocketbase-admin.ts:43`, `lib/pocketbase.ts:22`, `app/api/health/route.ts:12`, `.env.example` (document `PB_URL` as advanced, default shown)
- Test: `tests/unit/pocketbase-server.test.ts`, `tests/unit/health.test.ts`

- [ ] Replace the four literals with `PB_URL`. Ensure `lib/constants.ts` has no `'use client'` and that `PB_URL` is not imported by any client component (grep `components/` for `constants` — only `getBuildIdPublic`/`HOMEKEEP_BUILD` may be used there; if `lib/constants.ts` is imported client-side, put `PB_URL` in a new `lib/pb-url.ts` instead and say so).
- [ ] Test: with `vi.stubEnv('PB_URL', 'http://pb.test:1234')` and module re-import, `createServerClient()` returns a client whose `baseURL === 'http://pb.test:1234'`; health route fetches that URL (mock `fetch`).
- [ ] Run `TZ=UTC npx vitest run tests/unit/pocketbase-server.test.ts tests/unit/health.test.ts tests/unit/pocketbase.test.ts`. Pass.
- [ ] Commit: `feat(config): PB_URL env override for the PocketBase base URL`

### Task C4: Bind-mount permissions — fail loudly and fix when possible

**Files:**
- Modify: `docker/Dockerfile` (runtime stage), new `docker/s6-rc.d/fix-perms/{type,up,dependencies.d/base}` and add `fix-perms` to `docker/s6-rc.d/pocketbase/dependencies.d/` and `docker/s6-rc.d/user/contents.d/`
- Docs: note in `.env.example` next to `PUID/PGID`

Current failure: with `-v ./data:/app/data` owned by a non-1000 host user, PB logs `mkdir /app/data/pb_data: permission denied` and health reports `degraded` forever.

- [ ] Add a oneshot s6 service `fix-perms` (`type` = `oneshot`, `up` = `/etc/s6-overlay/scripts/fix-perms.sh`) that runs as root before `pocketbase`: if `/app/data` is not writable by uid 1000, `chown -R node:node /app/data` and log `[fix-perms] chowned /app/data to node (uid 1000)`; if chown fails (read-only mount), print a clear error with the `docker run --user` / `chown` remedy and exit 1 so the container stops instead of running degraded. Put the script at `docker/fix-perms.sh` and `COPY` it in the Dockerfile with exec bit.
- [ ] Verify: `docker buildx build --load -t homekeep-permtest -f docker/Dockerfile .` then `mkdir -p /tmp/hk-perm && sudo chown 1001:1001 /tmp/hk-perm` (or any non-1000 uid you have) and `docker run --rm -d --name hk-permtest -p 127.0.0.1:3998:3000 -v /tmp/hk-perm:/app/data homekeep-permtest`; within 40 s `curl -s localhost:3998/api/health` reports `"pocketbase":"ok"`. Stop/remove the container and image afterwards. Record the exact output in the report.
- [ ] Commit: `fix(docker): repair data-volume ownership at boot instead of running degraded`

---

## Stream D — Truthful docs, disclosure channel, release verification

### Task D1: Fix false or stale claims

**Files:** `README.md`, `SECURITY.md`, `app/globals.css:16-19`, `CONTRIBUTING.md`, `docs/deployment.md`

- [ ] `app/globals.css` line 18: `MIT` → `AGPL-3.0-or-later`.
- [ ] `SECURITY.md`: supported-versions table → `1.3.x ✅`, `≤1.2.x ❌`. Replace the placeholder email + PGP paragraph with: report via **GitHub private vulnerability reporting** (`https://github.com/the-kizz/homekeep/security/advisories/new`), and note that the maintainer must enable it under Settings → Security → "Private vulnerability reporting" (add that line to the "Maintainer fork checklist" in README too). Remove "placeholder" wording. Keep the SLA. Update the "Last updated" line to 2026-10-09.
- [ ] `README.md`: (a) cosign paragraph: "Release tags from v1.2.0 are signed" and add one sentence: "v1.3.0 was published without a signature; verify `1.2.1`, or any tag ≥ the next release, with the command below." (b) remove every mention of `46.62.151.57`, `homekeep.demo.the-kizz.com` and "live demo" (grep); (c) test counts: replace exact numbers with "600+ unit/integration tests and a Playwright E2E suite"; (d) Quickstart: directly under the `docker run` one-liner add a note: "The `./data` folder must be writable by uid 1000 (the container repairs ownership at boot when it can; if you see `permission denied` in `docker logs`, run `sudo chown -R 1000:1000 ./data`)." (e) add a short "Environment variables" row for `PB_URL` (advanced) and `TZ`.
- [ ] `docs/deployment.md`: remove the "Phase 7 Plan 1" and "Phase 2.1 pattern" phrases in the lines you touch; add the same `./data` ownership note under LAN mode.
- [ ] `CONTRIBUTING.md`: replace "Read `.planning/PROJECT.md`" with a 5-line "Principles" list inlined (calm over urgent; shared not competitive; forgiveness built in; self-hosted first; one container). Add a "Running the tests" paragraph: `TZ` is pinned to UTC by vitest config; integration tests spawn PocketBase on ports 18090–18110; run `node scripts/dev-pb.js` once to download the binary.
- [ ] Commit: `docs: fix licence comment, security contact, release-signing and demo claims`

### Task D2: Sponsors file and release-time signature verification

**Files:** `.github/FUNDING.yml` (new), `.github/workflows/release.yml`

- [ ] Create `.github/FUNDING.yml` with `github: the-kizz`. (GitHub Sponsors must still be enabled by the owner; say so in the report.)
- [ ] In `release.yml`, after the "Sign image with cosign" step add:
  ```yaml
      - name: Verify signature
        env:
          DIGEST: ${{ steps.build.outputs.digest }}
        run: |
          cosign verify "ghcr.io/${{ github.repository }}@${DIGEST}" \
            --certificate-identity-regexp '^https://github.com/${{ github.repository }}/.github/workflows/release.yml@.+' \
            --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```
  and make the "Verify multi-arch manifest" step also run `cosign tree "ghcr.io/${{ github.repository }}@${DIGEST}"` so the log shows the `.sig` and attestations. Keep every `uses:` SHA-pinned exactly as it is.
- [ ] Run `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml'))"` to validate YAML (`pip`-less: `node -e "require('js-yaml')"` is available in node_modules; either is fine).
- [ ] Commit: `ci(release): verify the cosign signature in the release workflow; add FUNDING.yml`

### Task D3: `.gitignore` and hardening doc touch-ups

**Files:** `.gitignore`, `docs/deployment-hardening.md`

- [ ] Ensure `.superpowers/`, `.pb/`, `data/`, `.env`, `test-results/`, `playwright-report/`, `.planning/review-screens/*.png` are **not** ignored if already tracked (do not ignore `review-screens`; leave it tracked) — only add `.superpowers/` and `*.tsbuildinfo` if missing.
- [ ] `docs/deployment-hardening.md`: item 9 (PAT rotation) — add "If the old VPS is gone, revoking the classic PAT is the whole task." Item 12b (password policy) — unchanged. Add item 16: "Set `TZ` to the household timezone in compose if you want scheduler logs in local time; scheduling math is timezone-aware regardless."
- [ ] Commit: `docs(hardening): PAT and TZ notes; ignore .superpowers`

---

## Stream E — Dependencies

### Task E1: Bring dependencies current without breaking the build

**Files:** `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, `.github/dependabot.yml`

- [ ] Set `"version": "1.3.0"` (matches the latest tag; the controller decides the next tag).
- [ ] Bump in this order, running `npm run build` (needs `NEXT_TELEMETRY_DISABLED=1`) and `npm run typecheck` after each group; revert a group that breaks and record why:
  1. Patch/minor within range: `next` + `eslint-config-next` → `16.4.0`, `react`/`react-dom`/`@types/react*` → latest 19.x, `zod` 4.6.x, `date-fns` 4.4, `react-hook-form` 7.89, `@hookform/resolvers` 5.9, `lucide-react` 1.53 (check the icon names used in `lib/area-palette.ts` and `components/*` still exist: grep for `from 'lucide-react'` and run typecheck), `pocketbase` SDK 0.28.x (read its changelog for `createBatch`/`impersonate` signature changes; grep usages), `serwist`/`@serwist/next` 9.5.x, `tailwindcss`/`@tailwindcss/postcss` 4.3, `sonner`, `tailwind-merge`, `radix-ui` 1.7, `@playwright/test` 1.64, `vitest` 4.x latest (not 5), `jsdom` 29.x latest, `typescript` 6.x latest (not 7), `eslint` 9.x latest (not 10).
  2. `node-cron` 3 → 4.6: API changed (`cron.schedule` returns a `ScheduledTask` with `start/stop` methods still; `validate` still exists; check `timezone` option name). Update `lib/scheduler.ts` **only if required for the type to compile — this is the one cross-stream exception; limit the edit to the import/option lines and report the exact diff.** If more than that is needed, keep `node-cron@3` and run `npm audit` to confirm the `uuid` advisory is dev-impact only; record the decision.
  3. Dev: `@vitejs/plugin-react` 6, `@testing-library/jest-dom` 7, `concurrently` 10, `@eslint/eslintrc`, `@types/node` 22.x latest (stay on 22 to match `engines`).
- [ ] Keep every dependency exact-pinned (no `^`), matching the repo convention.
- [ ] `npm audit --omit=dev` must report 0 critical and 0 high; `npm audit` overall should drop below 10 total. Paste both summaries in the report.
- [ ] `.github/workflows/ci.yml`: add `TZ: UTC` under the "Unit tests" step `env:` (belt and braces with A1) — this is the only change to this file.
- [ ] `.github/dependabot.yml`: add an `npm` ecosystem entry (weekly, `open-pull-requests-limit: 5`, group `npm-minor` for minor+patch).
- [ ] Run `npm run lint && npm run typecheck && NEXT_TELEMETRY_DISABLED=1 npm run build && TZ=UTC npx vitest run tests/unit/smoke.test.ts tests/unit/schemas tests/unit/task-scheduling.test.ts tests/unit/components`. Pass.
- [ ] Commit in groups: `chore(deps): …` per group, plus `ci: pin TZ=UTC for unit tests; dependabot npm ecosystem`.

---

## Stream F — Dark mode and a desktop layout

### Task F1: Theme provider and toggle

**Files:** new `components/theme-provider.tsx`, new `components/theme-toggle.tsx`, `app/layout.tsx`, `components/account-menu.tsx`

- [ ] `components/theme-provider.tsx`: `'use client'`, re-export `ThemeProvider` from `next-themes` with props `attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange`.
- [ ] `app/layout.tsx`: wrap `{children}` + `<Toaster />` in the provider; add `suppressHydrationWarning` on `<html>`. Keep every existing meta tag and the `DemoBanner`.
- [ ] `components/theme-toggle.tsx`: a `DropdownMenuItem`-compatible control cycling `system → light → dark` with `Sun`/`Moon`/`Monitor` lucide icons, label `Appearance: System|Light|Dark`. Mount it in `components/account-menu.tsx` above the logout item, separated by `DropdownMenuSeparator`.
- [ ] Audit `app/globals.css` `.dark` tokens render acceptably: the warm accent stays `#D4A574`; backgrounds use the existing `.dark` values. If any component hard-codes `bg-white`, `text-black`, `bg-stone-50`, etc. (grep `components/` and `app/` for `bg-white|text-black|bg-stone-|border-stone-|bg-amber-50`), replace with semantic tokens (`bg-background`, `bg-card`, `text-foreground`, `bg-muted`, `border-border`) **only in files Stream F owns**; list any others in the report.
- [ ] Test: `tests/unit/components/theme-toggle.test.tsx` — renders label `Appearance: System` by default; clicking cycles to `Light` then `Dark` (mock `next-themes` `useTheme`).
- [ ] `npm run lint && npm run typecheck && TZ=UTC npx vitest run tests/unit/components/theme-toggle.test.tsx`.
- [ ] Commit: `feat(ui): dark mode via next-themes with an Appearance toggle in the account menu`

### Task F2: Desktop dashboard layout

**Files:** `app/(app)/h/[homeId]/page.tsx`, `components/band-view.tsx`, `components/nav-shell.tsx`, `components/top-tabs.tsx`

Target at `≥ lg` (1024px): a two-column grid, `max-w-6xl`, left column (`lg:col-span-7`) = Overdue, This Week, Sleeping bands; right column (`lg:col-span-5`, `lg:sticky lg:top-20`) = Coverage ring + streak, Most neglected card, Horizon strip. Below `lg` the current single-column order is unchanged byte-for-byte in DOM order (use CSS grid `order`/column placement, not conditional rendering, so E2E selectors and hydration stay identical).

- [ ] Read `components/band-view.tsx` to find where `CoverageRing`, `MostNeglectedCard`, `HorizonStrip` and the three `TaskBand`s render. Wrap them in a grid container: `<div className="grid gap-6 lg:grid-cols-12">` with `<section className="space-y-6 lg:col-span-7">` for bands and `<aside className="space-y-6 lg:col-span-5 lg:sticky lg:top-20 lg:self-start">` for the rest. On phone the aside must render **first** (ring on top as today): use `order-first lg:order-none` on the aside.
- [ ] `app/(app)/h/[homeId]/page.tsx`: header container `max-w-4xl` → `max-w-6xl`. `nav-shell.tsx`/`top-tabs.tsx`: match `max-w-6xl` so the tabs align.
- [ ] Verify visually: `NEXT_TELEMETRY_DISABLED=1 npm run build` then `PORT=3997 npx next start -p 3997` with `PB_URL=http://127.0.0.1:18111` and `node scripts/dev-pb.js` is **not** possible without Stream C's `PB_URL`; instead render a screenshot via the existing Storybook-less path: write a throwaway vitest DOM test that renders `BandView` with fixture tasks (copy fixtures from `tests/unit/components/horizon-strip-density.test.tsx`) and asserts the aside has class `order-first` and the grid has `lg:grid-cols-12`. Keep that test as `tests/unit/components/band-view-layout.test.tsx`.
- [ ] Run `npm run lint && npm run typecheck && TZ=UTC npx vitest run tests/unit/components tests/unit/horizon-strip.test.tsx tests/unit/task-row.test.tsx tests/unit/coverage-ring.test.tsx`.
- [ ] Commit: `feat(ui): two-column dashboard on desktop; phone order unchanged`

### Task F3: Horizon legend and ⚖️ explanation

**Files:** `components/horizon-strip.tsx`

- [ ] Under the 12-month strip add a one-line muted legend: `Darker months are busier · ⚖️ moved to balance the month` (reuse the `ShiftBadge` icon component if it exports one; otherwise the glyph). Hide on `sm` and below? No — keep on all sizes, `text-xs text-muted-foreground`.
- [ ] Update `tests/unit/horizon-strip-density.test.tsx` (owned by F) to assert the legend text is present; do not touch `tests/unit/horizon-strip.test.tsx` (owned by A) — if it asserts an exact child count that your change breaks, report `NEEDS_CONTEXT` with the failing assertion instead of editing it.
- [ ] Commit: `feat(ui): horizon legend explains density tint and shift badge`

---

## Stream G — Interaction: easy to do, easy to see

Owner's brief: "Key is UI and UX. Needs to feel intuitive. Easy to do. Easy to visualise." Every task here must reduce taps or make state legible at a glance. No new concepts, no new settings.

Ownership note shared with F: both F and G may edit `components/band-view.tsx`. F edits only the JSX layout wrapper around `CoverageRing`/`MostNeglectedCard`/`HorizonStrip`/`TaskBand` (grid/aside markup). G edits only handler wiring and props passed to `TaskBand` / `TaskDetailSheet` (`onComplete=`, `onDetail=`, `onQuickComplete=` lines and `handleTap`). Do not reformat the file.

### Task G1: One-tap complete on every row, guard preserved

**Files:** `components/task-row.tsx`, `components/task-band.tsx`, `components/person-task-list.tsx`, `components/band-view.tsx` (wiring only), `tests/unit/task-row.test.tsx`

`TaskRow` already takes `onComplete(taskId)` and `onDetail(taskId)` (`components/task-row.tsx:47-64`); since v1.2.1 the row tap opens the detail sheet. Add an explicit round check button (`aria-label="Complete <task name>"`, 44×44 hit area, `CircleCheck` lucide icon, muted until hover/focus, `text-primary` on hover) at the row's right edge, before the "in 4d / 2d late" label. Tapping it calls a new optional prop `onQuickComplete?(taskId)`; it stops propagation so the sheet does not open. When `onQuickComplete` is absent, no button renders (so legacy call sites are unchanged).

- [ ] In `components/band-view.tsx`, pass `onQuickComplete={(id) => handleComplete(id)}` to every `TaskBand` where `handleComplete` is the existing function that runs the server action with the early-completion guard (find the function the `TaskDetailSheet`'s `onComplete` ultimately calls and reuse it; do not duplicate logic). The guard dialog (`EarlyCompletionDialog`) must still appear for early completes.
- [ ] Same wiring in `components/person-task-list.tsx` (it forks the same pattern).
- [ ] Optimistic feedback: on tap the row fades to 60% and shows the check filled until the action resolves (the existing `pending` prop handles opacity; reuse it).
- [ ] Tests in `tests/unit/task-row.test.tsx`: button renders only when `onQuickComplete` is provided; clicking it calls `onQuickComplete` with the id and does **not** call `onDetail`; clicking the row body calls `onDetail` only; button has the accessible name.
- [ ] `npm run lint && npm run typecheck && TZ=UTC npx vitest run tests/unit/task-row.test.tsx tests/unit/components`.
- [ ] Commit: `feat(ui): one-tap complete button on task rows, detail tap unchanged`

### Task G2: Task form — progressive disclosure

**Files:** `components/forms/task-form.tsx`, `tests/unit/components/task-form-ooft.test.tsx`

Today the form shows Task type, Name, Area, Assign to, Frequency chips + days, Schedule mode, Advanced, Notes in one long column. Target: the first screen is **Name, Area, Frequency, Who** — everything else behind a single "More options" collapsible (reuse the existing `Collapsible` from `components/ui/collapsible.tsx`):

- "More options" contains: Task type (Recurring / One-off; selecting One-off reveals the "Do by" date and hides Frequency, as today), Schedule mode (cycle/anchored, with the plain-English helper text: `Cycle: counts from the last time you did it. Anchored: fixed calendar dates, e.g. "every 1 July".`), Last done, Active months, Preferred days, Icon/colour if present, Notes.
- Frequency chips add `Daily (1)`, `Every 2 weeks (14)` and keep Weekly/Monthly/Quarterly/Yearly; the free-text days input stays beside them.
- Submit button text stays. Edit mode (existing task) opens "More options" expanded when any non-default value is set (one-off, anchored, seasonal, notes).
- The hidden-input / RHF `Controller` bridges that submit FormData must keep the same field `name`s so `lib/actions/tasks.ts` is untouched. Grep the action's `formData.get('…')` keys and assert nothing was renamed.

- [ ] Update `tests/unit/components/task-form-ooft.test.tsx`: the One-off radio is inside the collapsible; opening "More options" then choosing One-off reveals the "Do by" input; FormData names are unchanged (assert `input[name="frequency_days"]`, `input[name="schedule_mode"]`, `input[name="due_date"]` exist in the DOM after expanding).
- [ ] `npm run lint && npm run typecheck && TZ=UTC npx vitest run tests/unit/components/task-form-ooft.test.tsx`.
- [ ] Commit: `feat(ui): task form shows four essentials, everything else under More options`

### Task G3: First-run welcome card and empty states that teach

**Files:** new `components/welcome-card.tsx`, `app/(app)/h/[homeId]/page.tsx` (**coordination:** F owns this file for the `max-w` change only; G adds the `<WelcomeCard>` render line directly above `<BandView` — a one-line insert; do not touch anything else in the file), `tests/unit/components/welcome-card.test.tsx`

- [ ] `WelcomeCard` is a client component shown when the URL has `?welcome=1` (read via `useSearchParams`) **or** when `localStorage['hk:welcomed:<homeId>']` is absent; dismissing sets that key and strips the param with `router.replace`. Content (three lines, each with a small icon): `Overdue — things that slipped, no judgement.` / `This week — what's coming up next.` / `Horizon — the year at a glance; darker months are busier.` Two buttons: `Invite someone` (link to `/h/<id>/settings`) and `Got it`. Warm card styling (`bg-primary/10 border-primary/20`), `role="region"`, `aria-label="Welcome"`.
- [ ] Wrap any `localStorage` access in try/catch; render correctly when storage throws.
- [ ] Tests: renders when param present; `Got it` hides it and writes the key; not rendered when key exists and no param.
- [ ] `npm run lint && npm run typecheck && TZ=UTC npx vitest run tests/unit/components/welcome-card.test.tsx`.
- [ ] Commit: `feat(ui): first-run welcome card explains the three bands and nudges an invite`

### Task G4: Notifications live in Settings; Person page gets a claim action

**Files:** `app/(app)/h/[homeId]/person/page.tsx`, `app/(app)/h/[homeId]/settings/page.tsx`, new `app/(app)/h/[homeId]/settings/notifications/page.tsx`, `components/notification-prefs-form.tsx` (move only; keep the `data-notifications-ready` hydration flag and all field names), `tests/e2e/notifications.spec.ts` (update the navigation path only)

- [ ] Move the notification preferences form from the Person page to a new Settings → Notifications page (card on `/settings` titled `Notifications` with description `ntfy topic and which pushes you want.` and a button `Open notification settings`). The Person page keeps "Your tasks", "Your history", "Your stats" and adds one line under the header linking to the new page: `Notification settings →`.
- [ ] Person page "Your tasks" empty state becomes: `Nothing is assigned to you. Tasks default to "Anyone" — open a task and pick a person, or set a default person per area in By Area.` with a link to `/h/<id>/by-area`.
- [ ] `tests/e2e/notifications.spec.ts`: change `page.goto('/h/<id>/person')` to `/h/<id>/settings/notifications`; nothing else. Keep the existing `test.skip` exactly as is.
- [ ] `npm run lint && npm run typecheck && TZ=UTC npx vitest run tests/unit/actions/notification-prefs.test.ts`.
- [ ] Commit: `feat(ui): notification settings move under Settings; person page explains assignment`

### Task G5: Relative-time and band copy pass

**Files:** `components/task-row.tsx` (label only), `components/task-band.tsx` (band headers/empty copy), `lib/band-classification.ts` is **read-only**

- [ ] Row right-label: `2d late` → `2 days late`; `in 4d` → `in 4 days`; `in 0d`/today → `today`; `in 1d` → `tomorrow`; `1d late` → `yesterday`. Keep it under 12 characters at the longest (`13 days late` is fine; cap at `30+ days late`).
- [ ] Band empty copy: Overdue → `Nothing overdue. Nice.`; This Week → `Nothing due this week.`; Horizon stays.
- [ ] Update affected assertions in `tests/unit/task-row.test.tsx` and `tests/unit/components/*` you own. If `tests/unit/band-classification.test.ts` or any A-owned test asserts these strings, report `NEEDS_CONTEXT` with the file:line rather than editing it.
- [ ] Commit: `feat(ui): plain-English due labels and calmer empty states`

## Controller merge order and verification (not a subagent task)

1. Merge `fix/A` → `fix/C` → `fix/B` → `fix/G` → `fix/F` → `fix/D` → `fix/E` into `work/functioning` (branch off `master` at `db0f200`). Resolve conflicts only in `lib/scheduler.ts` (A vs E node-cron lines) and `README.md`/`.env.example` (C vs D).
2. `npm ci`, `npm run lint`, `npm run typecheck`, `NEXT_TELEMETRY_DISABLED=1 npm run build`, `npx vitest run` (no TZ override — config pins it), then once more with `TZ=Australia/Melbourne npx vitest run` to prove hermeticity.
3. Docker: build, run with a non-1000-owned bind mount on `127.0.0.1:3999`, health `ok`, signup → onboarding → By Area shows ≥ 4 areas; screenshot phone+desktop dashboards to `.planning/review-screens/after/`.
4. Final review dispatch (most capable model) over the whole branch diff; one fix wave; re-review.
5. Leave the branch unmerged into `master` and unpushed; report to Keiron with rulings.

## Out of scope (deliberately)

- Rotation / assignment modes, CSP enforcement, repo-hygiene mass comment cleanup, moving `.planning/` out of the tree, Dependabot PR merges on GitHub, DNS/PAT/Sponsors enablement, any deploy.
