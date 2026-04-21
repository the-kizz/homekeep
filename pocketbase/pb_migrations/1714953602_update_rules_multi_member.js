/// <reference path="../pb_data/types.d.ts" />

// 04-01 Plan — 1714953602_update_rules_multi_member.js (D-11).
//
// REQUIRES 1714953600 ran first — that migration backfills an owner
// home_members row for every Phase 2 / 2.1 deployed home. Without the
// backfill, this rule swap locks owners out of their own homes (Pitfall
// 1). Timestamp prefix (..02 > ..00) guarantees ordering.
//
// Switches homes / areas / tasks / completions from owner-only read to
// "any home member" read. Owner-only stays for mutations that change
// structure (home update/delete, which also flow through settings UI).
//
// Filter form (Pattern 1 primary): `@request.auth.home_members_via_user_id.home_id ?= <target>`.
// The `?=` operator is "any-match" on the set of home_members rows for
// the authed user — plain `=` would require ALL rows to match, which
// only works if the user is in exactly one home (Pitfall 2).

migrate((app) => {
  const homes       = app.findCollectionByNameOrId("homes");
  const areas       = app.findCollectionByNameOrId("areas");
  const tasks       = app.findCollectionByNameOrId("tasks");
  const completions = app.findCollectionByNameOrId("completions");

  // ─── homes ─────────────────────────────────────────────────────────────
  // READ = any member of the home. WRITE (update/delete) = owner only
  // (settings changes, danger-zone delete). createRule remains owner-only
  // because the creator *becomes* the owner in the same insert.
  homes.listRule   = '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= id';
  homes.viewRule   = '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= id';
  homes.createRule = '@request.auth.id != "" && owner_id = @request.auth.id';
  homes.updateRule = '@request.auth.id != "" && owner_id = @request.auth.id';
  homes.deleteRule = '@request.auth.id != "" && owner_id = @request.auth.id';
  app.save(homes);

  // ─── areas ─────────────────────────────────────────────────────────────
  // READ + WRITE = any member of the home. Whole Home deletion stays
  // blocked by the schema flag `is_whole_home_system = false`.
  const memberRule = '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= home_id';
  areas.listRule   = memberRule;
  areas.viewRule   = memberRule;
  areas.createRule = memberRule;
  areas.updateRule = memberRule;
  areas.deleteRule = memberRule + ' && is_whole_home_system = false';
  app.save(areas);

  // ─── tasks ─────────────────────────────────────────────────────────────
  // Members can create, edit, archive (via updateRule), or hard-delete
  // tasks in homes they belong to. Archive flow uses updateRule; hard
  // delete is rare (admin cleanup).
  tasks.listRule   = memberRule;
  tasks.viewRule   = memberRule;
  tasks.createRule = memberRule;
  tasks.updateRule = memberRule;
  tasks.deleteRule = memberRule;
  app.save(tasks);

  // ─── completions (double-hop via task_id.home_id) ─────────────────────
  // The completion's home is reached through task_id.home_id — PB supports
  // the multi-hop relation chain in rule filters (03-01 already uses the
  // owner-only double-hop form). createRule keeps the body-check from
  // 03-01 so a user cannot forge completions attributed to another member
  // (T-04-01 cross-user-forgery mitigation, T-03-01-02 preserved).
  // updateRule / deleteRule remain null (superuser only) per 03-01 D-10.
  const memberRuleViaTask = '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= task_id.home_id';
  completions.listRule   = memberRuleViaTask;
  completions.viewRule   = memberRuleViaTask;
  completions.createRule = memberRuleViaTask + ' && @request.body.completed_by_id = @request.auth.id';
  // updateRule / deleteRule intentionally not touched — remain null.
  app.save(completions);
}, (app) => {
  // DOWN — restore Phase 2 / 3 owner-only rules verbatim.
  const homes       = app.findCollectionByNameOrId("homes");
  const areas       = app.findCollectionByNameOrId("areas");
  const tasks       = app.findCollectionByNameOrId("tasks");
  const completions = app.findCollectionByNameOrId("completions");

  const ownerHomes = '@request.auth.id != "" && owner_id = @request.auth.id';
  homes.listRule   = ownerHomes;
  homes.viewRule   = ownerHomes;
  homes.createRule = ownerHomes;
  homes.updateRule = ownerHomes;
  homes.deleteRule = ownerHomes;
  app.save(homes);

  const ownerChild = '@request.auth.id != "" && home_id.owner_id = @request.auth.id';
  areas.listRule   = ownerChild;
  areas.viewRule   = ownerChild;
  areas.createRule = ownerChild;
  areas.updateRule = ownerChild;
  areas.deleteRule = ownerChild + ' && is_whole_home_system = false';
  app.save(areas);

  tasks.listRule   = ownerChild;
  tasks.viewRule   = ownerChild;
  tasks.createRule = ownerChild;
  tasks.updateRule = ownerChild;
  tasks.deleteRule = ownerChild;
  app.save(tasks);

  const ownerCompletion = '@request.auth.id != "" && task_id.home_id.owner_id = @request.auth.id';
  completions.listRule   = ownerCompletion;
  completions.viewRule   = ownerCompletion;
  completions.createRule = ownerCompletion + ' && @request.body.completed_by_id = @request.auth.id';
  app.save(completions);
});
