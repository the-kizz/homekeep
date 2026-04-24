/// <reference path="../pb_data/types.d.ts" />
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * 11-01 Plan Task 1 — additive task-model extensions (OOFT-01, OOFT-03,
 * PREF-01, SEAS-01). Timestamp 1745280001 = +1 from Phase 10's
 * 1745280000_schedule_overrides.js (D-23).
 *
 * Four new nullable fields on `tasks`:
 *   - due_date          DATE NULL (D-03 OOFT explicit "do by" date)
 *   - preferred_days    TEXT NULL enum any/weekend/weekday (D-07)
 *   - active_from_month INT? 1..12 (D-11 seasonal window)
 *   - active_to_month   INT? 1..12 (D-11 seasonal window)
 *
 * Plus one mutation on existing field:
 *   - frequency_days    required: true → false (D-02 OOFT-01)
 *
 * Zero backfill (D-24) — existing rows keep their frequency_days and
 * read null for the 4 new fields. Byte-identical v1.0 read behavior.
 *
 * A1 path (Wave 0 smoke 2026-04-22 — A1-SMOKE-OK): direct
 * `field.required = false` on the existing NumberField followed by
 * app.save(collection) persists the change in PB 0.37.1. No remove
 * + re-add fallback needed.
 *
 * Down: idempotent per Pitfall 10 — guard each field removal with
 * getByName lookup. Also flip frequency_days back to required: true.
 *
 * Defense-in-depth (T-11-02): seasonal months constrained at storage
 * layer via NumberField min:1 max:12 onlyInt:true — schema bypass via
 * admin-UI direct writes still rejected at PB validation layer.
 */

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId('tasks');

    // 1. Flip frequency_days nullable (OOFT-01, D-02). Direct-mutation
    //    path confirmed by Wave 0 A1 smoke.
    const freq = tasks.fields.getByName('frequency_days');
    if (freq) {
      freq.required = false;
    }

    // 2. Add 4 new nullable fields (alphabetical for diff clarity).
    tasks.fields.add(
      new NumberField({
        name: 'active_from_month',
        min: 1,
        max: 12,
        onlyInt: true,
        required: false,
      }),
    );
    tasks.fields.add(
      new NumberField({
        name: 'active_to_month',
        min: 1,
        max: 12,
        onlyInt: true,
        required: false,
      }),
    );
    tasks.fields.add(
      new DateField({ name: 'due_date', required: false }),
    );
    tasks.fields.add(
      new SelectField({
        name: 'preferred_days',
        values: ['any', 'weekend', 'weekday'],
        maxSelect: 1,
        required: false,
      }),
    );

    app.save(tasks);
  },
  (app) => {
    // DOWN — idempotent per Pitfall 10.
    const tasks = app.findCollectionByNameOrId('tasks');
    const names = [
      'active_from_month',
      'active_to_month',
      'due_date',
      'preferred_days',
    ];
    for (const n of names) {
      const f = tasks.fields.getByName(n);
      if (f) tasks.fields.removeById(f.id);
    }
    // Flip frequency_days back to required.
    const freq = tasks.fields.getByName('frequency_days');
    if (freq) {
      freq.required = true;
    }
    app.save(tasks);
  },
);
