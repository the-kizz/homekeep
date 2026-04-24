/// <reference path="../pb_data/types.d.ts" />
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * 12-01 Plan Task 1 — additive LOAD-01 next_due_smoothed DATE NULL.
 * Timestamp 1745280002 = +1 from Phase 11's 1745280001 (D-19). Single
 * additive field; no backfill; v1.0 rows fall through to natural via
 * D-02.
 *
 * The LOAD smoother (Phase 12 Wave 2 `computeNextDue` smoothed branch +
 * Wave 3 `completeTaskAction` batch extension + Wave 4 integration)
 * writes this field at completion time. A null value is the v1.0-
 * holdover / post-migration-before-first-completion state and reads
 * through to the natural cycle branch by D-02 — byte-identical v1.0
 * behavior preserved (T-12-03 mitigation).
 *
 * No index (D-01): per-home task counts are low-cardinality (<200 rows
 * typical); scans are bounded.
 *
 * Down: idempotent per Pitfall 10 — guard field removal with getByName
 * lookup so `migrate down` twice is a no-op.
 */

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');
    tasks.fields.add(
      new DateField({ name: 'next_due_smoothed', required: false }),
    );
    app.save(tasks);
  },
  (app) => {
    // DOWN — idempotent per Pitfall 10.
    const tasks = app.findCollectionByNameOrId('tasks');
    const f = tasks.fields.getByName('next_due_smoothed');
    if (f) tasks.fields.removeById(f.id);
    app.save(tasks);
  },
);
