/// <reference path="../pb_data/types.d.ts" />

// 04-02 (Rule 3 — Blocking): PB 0.37 ships with batch API disabled by
// default (`settings.batch.enabled = false`). Two production code paths
// depend on batch atomicity:
//
//   1. lib/actions/areas.ts `reorderAreas` — drag-to-reorder via
//      pb.createBatch() (02-04 AREA-05, RESEARCH §Pattern Drag-to-Reorder).
//      Phase 2/3 tests never exercised the live batch call because they
//      were UI-only; 04-02 is the first to hit PB with a batch request.
//   2. lib/actions/invites.ts `acceptInvite` — atomic
//      home_members.create + invites.update (Pattern 8 + Pitfall 4
//      double-accept race mitigation).
//
// Without this bootstrap, both return HTTP 403 "Batch requests are
// not allowed." — which would surface to the invitee as a cryptic
// `{ok:false, reason:'error'}` and to a reorderAreas caller as a
// swallowed formError.
//
// Why enabled in bootstrap vs migration: PB settings are global, not
// per-migration, and migrations can't express "enable batch" cleanly
// (settings aren't a migratable collection). The hook idempotently
// flips the flag on every boot, matching the pattern established by
// bootstrap_ratelimits.pb.js and bootstrap_smtp.pb.js.
//
// Limits: maxRequests=50 is generous for both use cases (acceptInvite
// emits 2 ops per batch; reorderAreas emits 1 per area — with 50 areas
// per home being a practical ceiling). maxBodySize uses PB's default
// by leaving it at 0 (the validator interprets 0 as "no explicit
// cap, use global body-size limit").

onBootstrap((e) => {
  e.next();

  const settings = $app.settings();
  settings.batch.enabled = true;
  settings.batch.maxRequests = 50;
  // Leave settings.batch.timeout + maxBodySize at their Go defaults.

  $app.save(settings);
  console.log("[batch] enabled: maxRequests=50");
});
