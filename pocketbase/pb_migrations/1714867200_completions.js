/// <reference path="../pb_data/types.d.ts" />

// 03-01 Plan — Pattern 1: completions collection with append-only
// enforcement (D-01, D-02, D-10, COMP-03).
//
// Rule semantics reminder (pocketbase.io/docs/api-rules-and-filters):
//   - `null` = locked, only superusers can perform the action.
//   - `""`   = permitted for ANYONE including guests — NEVER what we want here.
// We set updateRule AND deleteRule to `null` so regular API callers get
// 403 on PATCH / DELETE. Integration test
// tests/unit/hooks-completions-append-only.test.ts proves the contract.
//
// Security posture (threat_model T-03-01-01..04, T-03-01-07):
//   - Ownership double-hop filter `task_id.home_id.owner_id = @request.auth.id`
//     ensures a user can only CRUD completions for tasks in homes they own.
//   - Create rule additionally enforces
//     `@request.body.completed_by_id = @request.auth.id` so a user cannot
//     forge a completion attributed to another user (defense-in-depth for
//     Phase 4 multi-user — even today it neutralises the obvious body-
//     tampering path).
//
// Constructor-vs-post-construction: following 02-01's hard-won pattern
// (02-01-SUMMARY §Deviation 1) — fields and indexes are added AFTER
// `new Collection({...})` because PB 0.37 silently drops those options
// when passed through the init object.

migrate((app) => {
  const tasks = app.findCollectionByNameOrId("tasks");
  const users = app.findCollectionByNameOrId("users");

  const completions = new Collection({
    type: "base",
    name: "completions",
    // LIST/VIEW/CREATE: authenticated + ownership through the task's home.
    // PB supports the double-hop relation filter `task_id.home_id.owner_id`.
    listRule:   '@request.auth.id != "" && task_id.home_id.owner_id = @request.auth.id',
    viewRule:   '@request.auth.id != "" && task_id.home_id.owner_id = @request.auth.id',
    createRule: '@request.auth.id != "" && task_id.home_id.owner_id = @request.auth.id && @request.body.completed_by_id = @request.auth.id',
    // D-10: null locks to superusers. NOT "" (which allows everyone).
    updateRule: null,
    deleteRule: null,
  });

  completions.fields.add(new RelationField({
    name: "task_id",
    required: true,
    collectionId: tasks.id,
    // If a task is ever hard-deleted, its completions should go with it.
    // In practice tasks are archived, not deleted (02-05), so this cascade
    // rarely fires — included for data-integrity correctness.
    cascadeDelete: true,
    minSelect: 1,
    maxSelect: 1,
  }));
  completions.fields.add(new RelationField({
    name: "completed_by_id",
    required: true,
    collectionId: users.id,
    // Never delete a user while completions reference them — completions
    // are the audit trail. Phase 7 ops hardening can revisit if GDPR
    // erasure becomes a requirement.
    cascadeDelete: false,
    minSelect: 1,
    maxSelect: 1,
  }));
  completions.fields.add(new DateField({
    name: "completed_at",
    required: true,
  }));
  completions.fields.add(new TextField({ name: "notes", max: 2000 }));
  completions.fields.add(new SelectField({
    name: "via",
    required: true,
    values: ["tap", "manual-date"],
    maxSelect: 1,
  }));
  completions.fields.add(new AutodateField({ name: "created", onCreate: true }));

  completions.indexes = [
    // Pitfall 11: PB double-hop filter is slow without supporting index.
    // Critical access path 1: "latest completion per task" — the phase-3
    // BandView reduce consumes this.
    "CREATE INDEX idx_completions_task_completed ON completions (task_id, completed_at)",
    // Critical access path 2: "all completions in the last N months" — the
    // bounded 13-month fetch in lib/completions.ts.
    "CREATE INDEX idx_completions_completed_at ON completions (completed_at)",
  ];
  app.save(completions);
}, (app) => {
  // DOWN migration — idempotent.
  try {
    const c = app.findCollectionByNameOrId("completions");
    app.delete(c);
  } catch (_) {
    /* idempotent */
  }
});
