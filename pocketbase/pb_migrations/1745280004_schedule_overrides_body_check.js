/// <reference path="../pb_data/types.d.ts" />
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 23 Plan 23-01 — SEC-02 body-check tightening on
 * schedule_overrides.createRule.
 *
 * ADDITIVE rule update: append
 *   `@request.body.created_by_id = @request.auth.id`
 * to the existing `createRule` so a member of home H can no longer forge
 * a schedule_override that attributes `created_by_id` to a DIFFERENT
 * member of the same home. Mirrors the defense-in-depth body-check
 * already present on `completions.createRule`
 * (pocketbase/pb_migrations/1714867200_completions.js:38).
 *
 * Pre-state (1745280000_schedule_overrides.js):
 *   createRule =
 *     '@request.auth.id != "" &&
 *      @request.auth.home_members_via_user_id.home_id ?= task_id.home_id'
 *
 * Post-state (this migration):
 *   createRule = pre-state + ' && @request.body.created_by_id = @request.auth.id'
 *
 * Why this matters (research §F-10 / auth-access-control §A-05): with
 * multi-user homes (Phase 4+), a malicious home member could previously
 * POST an override with `created_by_id` pointing at another member's
 * id. The row's audit trail would then implicate the innocent user.
 * The new clause forces PB to reject any such body where the incoming
 * `created_by_id` doesn't match the authenticated caller.
 *
 * Surface unchanged:
 *   - listRule / viewRule / updateRule / deleteRule — identical member rule.
 *   - Fields + indexes unchanged.
 *
 * PB 0.37.1 pattern (Pitfall 1 in 02-01-SUMMARY — constructor drops
 * options silently): mutate existing collection in place via
 * findCollectionByNameOrId, re-assign the single rule, then app.save.
 *
 * Down migration: revert createRule to the pre-state string.
 * Idempotent per Pitfall 10 — wrap the lookup in try/catch so rolling
 * back twice on a fresh DB is a no-op.
 *
 * Timestamp 1745280004 = +1 from Phase 15's 1745280003_reschedule_marker
 * (the last allocated v1.1 prefix per D-16 convention).
 */

migrate(
  (app) => {
    const overrides = app.findCollectionByNameOrId('schedule_overrides');

    // NOTE: must keep the PRE-state verbatim. Any drift here would
    // silently widen the rule surface on the next `down` migration.
    const preCreateRule =
      '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= task_id.home_id';

    // SEC-02 additive tightening — body-check pinning created_by_id to
    // the authed caller. Mirrors completions.createRule pattern.
    overrides.createRule =
      preCreateRule + ' && @request.body.created_by_id = @request.auth.id';

    app.save(overrides);
  },
  (app) => {
    try {
      const overrides = app.findCollectionByNameOrId('schedule_overrides');
      overrides.createRule =
        '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= task_id.home_id';
      app.save(overrides);
    } catch (_) {
      /* idempotent */
    }
  },
);
