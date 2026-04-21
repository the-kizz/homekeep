/// <reference path="../pb_data/types.d.ts" />

// 04-01 Plan — 1714953601_invites.js (D-02).
//
// Creates the `invites` collection — tokens for share-link onboarding.
// Acceptance happens via a Wave 2 server action running under the PB
// admin client context (Pattern 12) because the invitee is not yet a
// home member at the moment they PATCH `accepted_at` — so no member-
// gated rule can authorise that write. That is why `updateRule = null`
// here (superuser-only) rather than an explicit member rule.
//
// Constructor-vs-post-construction: following 02-01's hard-won pattern
// (02-01-SUMMARY §Deviation 1) — fields and indexes are added AFTER
// `new Collection({...})` because PB 0.37 silently drops those options
// when passed through the init object.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const homes = app.findCollectionByNameOrId("homes");

  const invites = new Collection({
    type: "base",
    name: "invites",
    // Only owner-of-home can list/view/create/delete invites. updateRule
    // is null (superuser only) — acceptance runs under the PB admin
    // client in the Wave 2 `acceptInvite` server action.
    listRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
    updateRule: null,
    deleteRule: '@request.auth.id != "" && home_id.owner_id = @request.auth.id',
  });

  invites.fields.add(new RelationField({
    name: "home_id",
    required: true,
    collectionId: homes.id,
    cascadeDelete: true,     // delete home → delete its invites
    minSelect: 1,
    maxSelect: 1,
  }));
  invites.fields.add(new TextField({
    name: "token",
    required: true,
    min: 20,                 // 32-char tokens expected; 20 is the safety floor
    max: 64,
    pattern: "^[A-Za-z0-9_-]+$",  // base64url alphabet (Pattern 6 generator)
  }));
  invites.fields.add(new DateField({ name: "expires_at", required: true }));
  invites.fields.add(new DateField({ name: "accepted_at" }));
  invites.fields.add(new RelationField({
    name: "created_by_id",
    required: true,
    collectionId: users.id,
    cascadeDelete: false,    // preserve audit trail even if user deleted
    minSelect: 1,
    maxSelect: 1,
  }));
  invites.fields.add(new RelationField({
    name: "accepted_by_id",
    collectionId: users.id,
    cascadeDelete: false,
    minSelect: 0,
    maxSelect: 1,
  }));
  invites.fields.add(new AutodateField({ name: "created", onCreate: true }));
  invites.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));

  invites.indexes = [
    // Collision safety: 192-bit tokens already make clashes astronomically
    // unlikely, but a unique index is belt-and-braces + doubles as the
    // lookup index for `acceptInvite(token)`.
    "CREATE UNIQUE INDEX idx_invites_token ON invites (token)",
    "CREATE INDEX idx_invites_home ON invites (home_id)",
  ];
  app.save(invites);
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("invites");
    app.delete(c);
  } catch (_) {
    /* idempotent */
  }
});
