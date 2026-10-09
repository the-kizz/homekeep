/// <reference path="../pb_data/types.d.ts" />
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 26 DEMO-03 — demo-user cleanup cron.
 *
 * Sweeps every 15 minutes (@ every :00 :15 :30 :45 past the hour).
 * For each user where `is_demo = true`, delete if EITHER:
 *
 *   - idle-TTL  (D-06): last_activity < now - 2h
 *   - absolute  (D-07): created       < now - 24h
 *
 * PB cascades handle the downstream mess:
 *   - homes     → cascade-delete from owner_id (ON DELETE CASCADE on
 *                 the relation — see 1714780800_init_homekeep.js
 *                 homes.owner_id.cascadeDelete=false though; see below)
 *   - areas, tasks, completions, schedule_overrides, notifications,
 *     home_members → cascade from home.id where set.
 *
 * CORRECTNESS NOTE re homes.owner_id.cascadeDelete=false:
 *   The init migration sets homes.owner_id.cascadeDelete=false so real
 *   users can't accidentally nuke their home by deleting their account
 *   (the app surfaces a "you have homes, delete them first" dialog).
 *   For demo users we DO want the cascade, so this hook explicitly
 *   deletes homes BEFORE deleting the user — same transactional effect
 *   with the existing schema.
 *
 * SAFETY GATE (D-09): the filter is `is_demo = true` AND ... — never
 * touches real users. A paranoia double-check on each row inside the
 * loop ensures that even if a future schema change breaks the filter
 * semantics, an individual real row with `is_demo = false` is skipped.
 *
 * Cron guard: if DEMO_MODE is not set, skip the sweep entirely.
 * Registered hook still loads on every boot (PB JSVM does not support
 * conditional registration), but the work is a no-op on personal
 * instances — same defence-in-depth pattern as lib/demo-session.ts.
 */

cronAdd('demo-cleanup', '*/15 * * * *', () => {
  // Dead-code on personal instances.
  if (process.env.DEMO_MODE !== 'true') {
    return;
  }

  const now = new Date();
  const idleCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000); // now-2h
  const absoluteCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); // now-24h

  // DEVIATION (Rule 1 — bug caught by tests/unit/demo-session-integration
  // .test.ts Scenario 4): PB 0.37.x stores datetimes in space-separated
  // format ("YYYY-MM-DD HH:MM:SS.mmmZ") and the filter parser does a
  // raw STRING comparison against the stored value. JS Date.toISOString()
  // emits T-separated ("YYYY-MM-DDTHH:MM:SS.mmmZ"), and since ' ' (0x20)
  // is less than 'T' (0x54) ANY stored datetime sorts lexicographically
  // before an ISO-T cutoff. Result: without this .replace('T', ' ') the
  // idle filter would match EVERY demo user on every sweep and nuke
  // brand-new sessions the moment they're created. Convert ISO to PB's
  // space-separated form before embedding in the filter.
  const idleCutoffIso = idleCutoff.toISOString().replace('T', ' ');
  const absoluteCutoffIso = absoluteCutoff.toISOString().replace('T', ' ');

  // Filter composition:
  //   is_demo = true AND (last_activity < idleCutoff OR created < absoluteCutoff)
  //
  // Empty last_activity (fresh session that never resumed): PB DateField
  // empty compares as the zero-date "0001-01-01", which is ALWAYS less
  // than idleCutoffIso. To avoid evicting brand-new sessions mid-seed,
  // we require last_activity to be non-empty OR the absolute cutoff to
  // fire. The `last_activity != ""` guard ensures sessions in the middle
  // of being created (is_demo=true, last_activity just set) don't get
  // nuked on the same-minute cron tick.
  //
  // Two passes (findRecordsByFilter) keep the filter expression within
  // PB's parser comfort zone — complex OR + AND chains occasionally
  // produce cryptic errors on 0.37.x.
  let expired = [];
  try {
    const idleMatches = $app.findRecordsByFilter(
      'users',
      `is_demo = true && last_activity != "" && last_activity < "${idleCutoffIso}"`,
    );
    const absoluteMatches = $app.findRecordsByFilter(
      'users',
      `is_demo = true && created < "${absoluteCutoffIso}"`,
    );
    // Merge unique by id.
    const seen = {};
    for (const r of idleMatches) {
      seen[r.id] = r;
    }
    for (const r of absoluteMatches) {
      seen[r.id] = r;
    }
    expired = Object.values(seen);
  } catch (err) {
    console.log('[demo-cleanup] filter query failed:', err);
    return;
  }

  if (expired.length === 0) {
    return;
  }

  let deletedUsers = 0;
  let deletedHomes = 0;
  for (const user of expired) {
    // Defence-in-depth safety gate (D-09) — even if the filter somehow
    // surfaces a real-user row (schema bug, future migration error, etc),
    // refuse to delete it. This is strictly redundant with the filter
    // above but trades a few nanoseconds for peace of mind.
    if (user.get('is_demo') !== true) {
      console.log(
        `[demo-cleanup] SAFETY GATE: refused to delete user ${user.id} (is_demo != true)`,
      );
      continue;
    }

    // Delete all homes owned by this user FIRST — the init-migration sets
    // homes.owner_id.cascadeDelete=false, so deleting the user directly
    // would leave orphan homes. tasks/areas/completions/members/overrides
    // cascade correctly from home.id (all set cascadeDelete=true in init).
    try {
      const homes = $app.findRecordsByFilter(
        'homes',
        `owner_id = "${user.id}"`,
      );
      for (const h of homes) {
        try {
          $app.delete(h);
          deletedHomes++;
        } catch (hErr) {
          console.log(
            `[demo-cleanup] failed to delete home ${h.id} for user ${user.id}:`,
            hErr,
          );
        }
      }
    } catch (hQueryErr) {
      console.log(
        `[demo-cleanup] homes query failed for user ${user.id}:`,
        hQueryErr,
      );
    }

    try {
      $app.delete(user);
      deletedUsers++;
    } catch (uErr) {
      console.log(
        `[demo-cleanup] failed to delete user ${user.id}:`,
        uErr,
      );
    }
  }

  console.log(
    `[demo-cleanup] swept ${deletedUsers} demo users (${deletedHomes} homes)`,
  );
});
