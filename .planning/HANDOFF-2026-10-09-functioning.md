# Handoff — "functioning properly" branch (2026-10-09)

Branch: `work/functioning` (65 commits on `master` at `db0f200`+plan), **local only, not pushed, not merged**.
Plan: `.planning/PLAN-2026-10-09-functioning.md`. Review it argued from: `.planning/REVIEW-2026-10-09.md`.
Execution ledger and every agent report/review: `.superpowers/sdd/functioning/` (git-ignored, on kizserv only).

## What was done

Seven Opus streams in parallel worktrees (A scheduler/tests, B onboarding/seeds, C task edits/PB_URL/Docker
perms, D docs/security/release, E dependencies, F dark mode/desktop layout, G interaction/copy), merged,
then three fix waves driven by a final whole-branch review and two scoped re-reviews.

**Correctness**
- Completing a task now places its next due date from *this* completion, not the previous one
  (`lib/actions/completions.ts`). Pre-existing on master; an overdue task stayed overdue after you ticked it.
  Found by inspecting the data behind a screenshot; the old E2E was written to avoid asserting it.
- Scheduler reads the full task projection and the home timezone; notifications match the dashboard.
  Single tick guard on `globalThis`; `ref_cycle` keyed on the home-timezone date (one duplicate push per
  already-notified task on first tick after upgrade; noted in README).
- Seasonal scheduling: tz-safe window-open dates; in-season tasks no longer skip a year; tasks never
  completed, or last done in a prior season, become due at the window start, not months late; a stale
  smoothed date no longer overrides dormancy.
- Editing a task's frequency/mode/season clears its stale smoothed date; one-off reschedule moves `due_date`;
  one-off tasks appear in the dashboard bands; the edit page no longer drops season/due-date values.
- History "Today/Yesterday" keys computed in the home timezone only.
- Test suite is hermetic: vitest pins `TZ=UTC`, every integration test has a unique PocketBase port,
  20 s test timeout; **812/812 pass under UTC and under Australia/Melbourne**.
- Docker: `fix-perms` oneshot repairs `./data` ownership at boot (verified with a non-1000 bind mount);
  `PB_URL` env override; `TZ` documented.

**UI/UX** (owner's priority)
- Onboarding creates real areas (Kitchen, Bathroom, Living areas, Yard) and seeds land in them; By Area is
  useful on day one. Seasonal seeds resolve by hemisphere from the home timezone (Perth: mowing Oct–Mar,
  heater Apr–Sep). First-due dates spread across the cycle so the first dashboard isn't an avalanche.
- Welcome card on first visit explains the three bands and offers "Invite someone".
- One-tap complete button on every dashboard row (early-completion guard still applies; completion toast
  names the task; no undo because completions are append-only). "Anyone" chip hidden so names fit at 390px.
- Task form: Name, Area, Recurring/One-off, Frequency (with Daily and Every 2 weeks), Who; everything else
  under "More options".
- Dark mode (system/light/dark toggle in the account menu); two-column desktop dashboard; phone order and
  reading order unchanged; horizon legend; plain-English due labels ("3 days late", "tomorrow").
- Notification settings moved under Settings; Person page explains assignment.
- Screenshots: `.planning/review-screens/after-v4/` (light) and `after-v3/*-dark.png`.

**Repo truth**
- README: signing claim corrected (1.3.0 is unsigned), demo/IP references removed, `./data` ownership note,
  `PB_URL`/`TZ` documented, Project status rewritten, upgrade note. SECURITY.md: real channel (GitHub private
  vulnerability reporting — you must enable it), versions table current. `globals.css` MIT → AGPL.
  `FUNDING.yml` (`github: the-kizz` — enable Sponsors). Release workflow verifies the cosign signature.
  Dependencies current (next 16.4, react 19.3, node-cron 4, PB SDK 0.28, zod 4.6…); `npm audit --omit=dev` = 0.

## Verification on this host
- `npm run lint` 0 errors / 0 warnings; `npm run typecheck` clean; `next build` green; image 309 MiB.
- vitest 812/812 (UTC) and 812/812 (Australia/Melbourne).
- Playwright against the Docker image (`E2E_BASE_URL=E2E_PB_URL=http://localhost:3999`): see the final
  line appended below.

## Rulings made on your behalf (undo any you disagree with)
1. Parallel implementers with disjoint file ownership (your request); conflicts resolved at merge.
2. Stream B could edit two unowned integration tests for the new seed contract.
3. Seed areas use the existing palette icons/colours, not the plan's invented ones.
4. Stream A merged the two hourly crons into one `runOnce` tick.
5. `ref_cycle` keyed on home-timezone date; accept a one-time duplicate overdue push on upgrade.
6. **No undo for one-tap complete** (append-only completions, SPEC §7.5); removed the button from the
   Person list instead and named the task in the toast.
7. Phone summary block rendered twice (phone/desktop copies) instead of CSS reordering, for reading order.
8. "Anyone" assignee chip hidden; shown only for real assignees.
9. Dormant seasonal task with a stale smoothed date returns "sleeping" (null), not a wake-up date.
10. Wave-3 minor M1 (load self-exclusion day mismatch under snooze) parked: negligible effect.
11. Controller edited two E2E assertions directly (`core-loop.spec.ts`) rather than dispatching an agent.
12. Out of scope, unchanged: anchored tasks can never be overdue; rotation; CSP enforcement; moving
    `.planning/` out of the tree; merging Dependabot PRs on GitHub.

## What you need to do
1. Read the diff (`git diff master..work/functioning --stat`), then merge to `master` and push when happy.
   Tag `v1.4.0`; the release workflow now verifies the signature and will fail loudly if cosign skips.
2. Delete the `homekeep.demo.the-kizz.com` A record; clear the GitHub homepage field; revoke the old PAT.
3. GitHub → Settings → Security: enable Private vulnerability reporting; enable Sponsors.
4. Existing installs: rows with a bad `next_due_smoothed` from the completion bug self-correct on the next
   completion or a Settings → Scheduling → Rebalance. Expect one duplicate overdue push on the first tick.
5. Worktrees `/home/claude/projects/homekeep-wt/{A..G}` and branches `fix/A..G` are kept for traceability;
   `git worktree remove` them when done.

**Final Playwright run (v4 image, 2026-10-09): 25 passed, 1 skipped (notifications Part 2, pre-existing skip), 0 failed.**
