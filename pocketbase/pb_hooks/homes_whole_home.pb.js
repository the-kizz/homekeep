/// <reference path="../pb_data/types.d.ts" />

// DEVIATION from plan (Rule 1 — Bug): the verbatim-research hook calls
// e.app.save(area) BEFORE e.next(). In PB 0.37.1 onRecordCreateExecute,
// e.next() is what actually persists the home — so creating the area
// first fails with `validation_missing_rel_records` on the `home_id`
// relation (the home row does not yet exist to satisfy the FK).
// Correct order: persist the home via e.next(), THEN create the Whole
// Home area. Both operations run inside the same DB transaction
// (onRecordCreateExecute semantics) so atomicity is preserved — a
// throw from e.app.save(wholeHome) still rolls back the home insert.
onRecordCreateExecute((e) => {
  // Recursion guard — we only fire on homes; nothing here creates another home.
  // But be explicit for future readers.
  if (e.record.collection().name !== "homes") {
    e.next();
    return;
  }

  // Persist the home first so its ID becomes a valid relation target.
  e.next();

  const areas = e.app.findCollectionByNameOrId("areas");
  const wholeHome = new Record(areas, {
    home_id:              e.record.id,
    name:                 "Whole Home",
    scope:                "whole_home",
    sort_order:           0,
    is_whole_home_system: true,
    icon:                 "home",
    color:                "#D4A574",
  });

  // Still inside the transaction: if this throws, the home insert
  // rolls back, so we cannot leave an orphan home without a Whole Home.
  e.app.save(wholeHome);

  // ─── ADDED in Phase 4 (D-03) ──────────────────────────────────────
  // Auto-create the owner's home_members row in the same DB transaction.
  // Same atomicity guarantee as the Whole Home area insert above —
  // if this throws, the whole transaction rolls back and the client
  // sees an error rather than ending up with an orphan home (no
  // Whole Home) or a home its owner cannot read (no membership
  // row under the Phase 4 member-gated listRule on homes).
  //
  // Consolidated into this hook (rather than split into a separate
  // file) so "home creation = home + whole home area + owner
  // membership" stays obviously atomic; two onRecordCreateExecute
  // hooks on the same event each call e.next() independently, which
  // is a subtle pattern we avoid on purpose (Pattern 5 anti-pattern).
  const members = e.app.findCollectionByNameOrId("home_members");
  const ownerMember = new Record(members, {
    home_id: e.record.id,
    user_id: e.record.get("owner_id"),
    role:    "owner",
  });
  e.app.save(ownerMember);
  // ─── END ADDED ────────────────────────────────────────────────────
}, "homes");
