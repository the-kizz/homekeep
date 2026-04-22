/// <reference path="../pb_data/types.d.ts" />
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep

/**
 * 15-01 Plan Task 1 — additive SNZE-07 reschedule_marker DATE NULL.
 * Timestamp 1745280003 = +1 from Phase 12's 1745280002 (D-16).
 *
 * Set to `now` when the user picks "From now on" in RescheduleActionSheet
 * (D-07, D-08). Cleared to null on rebalance apply in Phase 17 REBAL
 * (REBAL-03 preservation + REBAL-04 re-placement path). Natural
 * completion does NOT clear this field (D-08 — user intent persists).
 *
 * No index (D-16): low cardinality per-home; Phase 17 scans all tasks anyway.
 *
 * Down: idempotent per Pitfall 10 — guard the reschedule_marker field
 * removal with getByName so `migrate down` twice is a no-op.
 */

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    tasks.fields.add(
      new DateField({ name: 'reschedule_marker', required: false }),
    );
    app.save(tasks);
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    const f = tasks.fields.getByName('reschedule_marker');
    if (f) tasks.fields.removeById(f.id);
    app.save(tasks);
  },
);
