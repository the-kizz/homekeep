/// <reference path="../pb_data/types.d.ts" />

/**
 * 10-01 Plan Task 1 — schedule_overrides collection (SNZE-04).
 *
 * Creates the per-task snooze/override primitive that Phase 10's Wave 2
 * (`computeNextDue` branch) and Wave 3 (`completeTaskAction` atomic
 * consumption) build on. Row shape per D-01:
 *   (id, task_id, snooze_until, consumed_at, created_by_id, created)
 *
 * Rule posture (D-03 / D-04 / D-05):
 *   All five rules (list/view/create/update/delete) use the SAME member
 *   string — any authenticated member of the home owning the task can
 *   CRUD overrides. updateRule is member-allowed so `consumed_at` writes
 *   from `completeTaskAction` succeed without admin escalation (D-05);
 *   deleteRule is member-allowed to support the Phase 15 "undo snooze"
 *   affordance. createRule omits any `@request.body.created_by_id =
 *   @request.auth.id` body-check per D-04 — `task_id` membership is
 *   sufficient and keeps Phase 15 UX flexible (members can inspect +
 *   modify each other's snoozes).
 *
 * Double-hop with `?=` (Pitfall 2 / D-03): the multi-value back-relation
 * `@request.auth.home_members_via_user_id.home_id` MUST use `?=` (any-
 * match) not `=` (all-match). Mirrors the operator in
 * `1714953602_update_rules_multi_member.js:14-17`.
 *
 * Constructor-vs-post-construction (D-15 / Pitfall 1): PB 0.37.1 silently
 * drops `fields` and `indexes` passed through the Collection init object;
 * always construct with type/name/*Rule only, then add fields post hoc.
 * Mirrors `1714867200_completions.js` rule shape with member-writeable
 * ruleset per D-05; PB 0.37.1 silent-drop workaround per 02-01 deviation.
 *
 * Indexes:
 *   - (task_id, consumed_at) for `getActiveOverride` per-task active lookup.
 *   - (created) for newest-wins tie-breaker used by
 *     `getActiveOverridesForHome` batch reducer.
 *
 * Down migration: idempotent per Pitfall 10 — wrap `app.delete(c)` in
 * try/catch so `migrate down` twice is a no-op.
 *
 * Timestamp 1745280000 = 2025-04-21T20:40:00Z Unix seconds — numerically
 * AFTER 1714953606 (the last allocated prefix). Numeric ordering is what
 * PB's migration runner cares about; the prefix is otherwise opaque.
 */

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    const users = app.findCollectionByNameOrId('users');

    // D-03: double-hop member rule via task_id.home_id. D-04: no
    // body-check on created_by_id — task_id membership gates creation.
    // D-05: member-allowed on update + delete for consumption + undo.
    const memberRule =
      '@request.auth.id != "" && @request.auth.home_members_via_user_id.home_id ?= task_id.home_id';

    const overrides = new Collection({
      type: 'base',
      name: 'schedule_overrides',
      listRule: memberRule,
      viewRule: memberRule,
      createRule: memberRule, // D-04: NO body-check
      updateRule: memberRule, // D-05: members write consumed_at
      deleteRule: memberRule, // D-05: members can undo
    });

    overrides.fields.add(
      new RelationField({
        name: 'task_id',
        required: true,
        collectionId: tasks.id,
        // If a task is hard-deleted (rare — tasks are normally archived)
        // its overrides go with it — they reference nothing meaningful.
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
    );
    overrides.fields.add(
      new DateField({
        name: 'snooze_until',
        required: true,
      }),
    );
    overrides.fields.add(
      new DateField({
        name: 'consumed_at',
        required: false, // NULL/empty = active; set-to-now on completion
      }),
    );
    // Audit trail — mirrors completions pattern. Optional at the rule
    // layer (D-04), but set by callers for debugability.
    overrides.fields.add(
      new RelationField({
        name: 'created_by_id',
        required: false,
        collectionId: users.id,
        // Preserve audit trail even if the user is deleted.
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1,
      }),
    );
    overrides.fields.add(
      new AutodateField({ name: 'created', onCreate: true }),
    );

    overrides.indexes = [
      // Per-task active-override lookup — powers `getActiveOverride`
      // single-task fetch. (task_id, consumed_at) composite so PB can
      // partial-scan the null rows for a given task without a full
      // collection scan.
      'CREATE INDEX idx_schedule_overrides_task_consumed ON schedule_overrides (task_id, consumed_at)',
      // Creation-ordered lookup for "latest active" tie-breaker in the
      // batch Map reducer (newest-wins when D-02 is violated by a race).
      'CREATE INDEX idx_schedule_overrides_created ON schedule_overrides (created)',
    ];

    app.save(overrides);
  },
  (app) => {
    // DOWN — idempotent per Pitfall 10.
    try {
      const c = app.findCollectionByNameOrId('schedule_overrides');
      app.delete(c);
    } catch (_) {
      /* idempotent */
    }
  },
);
