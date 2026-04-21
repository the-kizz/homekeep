/// <reference path="../pb_data/types.d.ts" />

// 04-01 Plan — 1714953600_home_members.js (D-01 + D-03 backfill).
//
// Creates the `home_members` collection — the DB-level gate that Phase 4
// rule-swap migration (1714953602) uses for multi-user read access.
//
// CRITICAL ORDERING: this migration's backfill loop (at the bottom of the
// UP callback) MUST run BEFORE 1714953602_update_rules_multi_member.js
// swaps rules from owner-only to membership-based. Otherwise owners of
// Phase 2 / 2.1 deployed homes would lose read access to their own homes
// on the next request (Pitfall 1 — "forgetting to backfill existing homes
// before rule-update migration"). PocketBase applies migrations in
// filename-order, so the timestamp prefix (..00 < ..02) guarantees this.
//
// Constructor-vs-post-construction: following 02-01's hard-won pattern
// (02-01-SUMMARY §Deviation 1) — fields and indexes are added AFTER
// `new Collection({...})` because PB 0.37 silently drops those options
// when passed through the init object.
//
// Role default note (D-01): the plan specifies `role` defaults to 'member',
// but PB 0.37 `SelectField` does not expose a default-value option; every
// insert path (this backfill, the Whole Home hook, the Wave 2 acceptInvite
// server action) specifies `role` explicitly. The "default = member" in
// D-01 is informational for readers — the server always sets the role.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const homes = app.findCollectionByNameOrId("homes");

  const members = new Collection({
    type: "base",
    name: "home_members",
    // READ: any member of this home can see the full member list.
    // Uses the PB 0.22+ `_via_` back-relation with `?=` (any-match).
    listRule: '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= home_id',
    viewRule: '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= home_id',
    // CREATE: only owner-of-home can add a member directly. The Wave 2
    // acceptInvite path uses PB admin client so it bypasses this rule for
    // invitee inserts (T-04-01-01).
    createRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    // UPDATE: owner-of-home (role changes — not wired in Phase 4 UI).
    updateRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    // DELETE: owner-of-home OR the target member themselves (self-leave).
    deleteRule: '@request.auth.id != "" && (home_id.owner_id = @request.auth.id || user_id = @request.auth.id)',
  });

  members.fields.add(new RelationField({
    name: "home_id",
    required: true,
    collectionId: homes.id,
    cascadeDelete: true,       // delete home → delete all member rows
    minSelect: 1,
    maxSelect: 1,
  }));
  members.fields.add(new RelationField({
    name: "user_id",
    required: true,
    collectionId: users.id,
    cascadeDelete: true,       // delete user → delete their memberships
    minSelect: 1,
    maxSelect: 1,
  }));
  members.fields.add(new SelectField({
    name: "role",
    required: true,
    values: ["owner", "member"],
    maxSelect: 1,
  }));
  members.fields.add(new AutodateField({ name: "joined_at", onCreate: true }));
  members.fields.add(new AutodateField({ name: "created", onCreate: true }));
  members.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));

  members.indexes = [
    // Prevents duplicate memberships for the same (home, user) pair.
    "CREATE UNIQUE INDEX idx_home_members_home_user ON home_members (home_id, user_id)",
    // Back-relation lookup accelerant (Pitfall 7: `_via_` rules need the FK
    // index to keep per-request rule evaluation fast on SQLite).
    "CREATE INDEX idx_home_members_user ON home_members (user_id)",
  ];
  app.save(members);

  // ─── Backfill existing homes with their owners as home_members ────────
  // Every Phase 2 / 2.1 deployed home row exists without a membership row.
  // We insert one owner-role row per home so the subsequent rule-swap
  // migration (1714953602) does not lock owners out of their own homes.
  //
  // Uses `app.findRecordsByFilter("homes", "", "", 0, 0)` — empty filter,
  // empty sort, offset 0, limit 0 (PB convention for "all rows").
  //
  // Idempotent: if re-applied (e.g., manual migrate up --force on dev),
  // the existence-check skips already-populated rows. Filter uses PB's
  // parameterised binding `{:name}` (T-04-01-08 — no string concatenation).
  const homesRows = app.findRecordsByFilter("homes", "", "", 0, 0);
  for (const home of homesRows) {
    let existing = null;
    try {
      existing = app.findFirstRecordByFilter(
        "home_members",
        "home_id = {:hid} && user_id = {:uid}",
        { hid: home.id, uid: home.get("owner_id") },
      );
    } catch (_) {
      // PB throws when no match — that is the expected path for backfill.
      existing = null;
    }
    if (existing) continue;

    const row = new Record(members, {
      home_id: home.id,
      user_id: home.get("owner_id"),
      role:    "owner",
    });
    app.save(row);
  }
}, (app) => {
  // DOWN — idempotent: drop the collection if it exists.
  try {
    const c = app.findCollectionByNameOrId("home_members");
    app.delete(c);
  } catch (_) {
    /* idempotent */
  }
});
