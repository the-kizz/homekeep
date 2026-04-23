/// <reference path="../pb_data/types.d.ts" />
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep

/**
 * Phase 26 DEMO-02/03 — additive users fields for demo-session tracking.
 *
 * Timestamp 1745280006 = +2 from Phase 24's 1745280004 (last allocated
 * v1.1/v1.2 prefix per D-16 convention). Slot 1745280005 is intentionally
 * unused — earlier planning considered splitting this migration into two
 * (is_demo + last_activity) before consolidation. Leaving the gap avoids
 * churn if the split is ever re-introduced.
 *
 * Adds two nullable fields to the `users` collection:
 *
 *   1. `is_demo` BOOL — set to `true` ONLY by lib/demo-session.ts
 *      when it spawns a throwaway user on first visit. All real
 *      signups + all pre-existing rows remain `false` (BoolField
 *      unset-semantics). Cleanup cron (pocketbase/pb_hooks/
 *      demo_cleanup.pb.js) uses this as the SAFETY GATE so it
 *      cannot accidentally nuke real users (D-09).
 *
 *   2. `last_activity` DATETIME — updated on every demo-session
 *      resume hit (ensureDemoSession). Cleanup cron compares
 *      against `now - 2h` to evict idle sessions (D-06).
 *
 * Both fields default to their zero values (false / empty datetime)
 * for pre-existing rows — PB BoolField/DateField `required=false`
 * semantics. No backfill needed; cleanup only acts on rows where
 * is_demo=true, so pre-existing real users are never touched.
 *
 * Rule surface unchanged: listRule / viewRule / createRule / updateRule
 * stay identical. These are auxiliary fields consumed ONLY by server-
 * side helpers (lib/demo-session.ts + the cleanup hook) — the PB
 * collection API-rule expressions never reference them.
 *
 * DOWN: remove both fields. Guarded with getByName so re-running is
 * idempotent (Pitfall 10).
 */

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    // is_demo — the "kill me on cleanup sweep" marker. BoolField
    // unset-default is false, matching D-08: real users are never
    // marked demo by accident.
    users.fields.add(new BoolField({ name: 'is_demo' }));

    // last_activity — touched by ensureDemoSession on every resume.
    // DateField unset-default is empty (null-ish at read time). Cleanup
    // treats empty as "now" to avoid evicting brand-new sessions that
    // haven't had a chance to touch this yet.
    users.fields.add(new DateField({ name: 'last_activity', required: false }));

    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const names = ['is_demo', 'last_activity'];
    for (const n of names) {
      const f = users.fields.getByName(n);
      if (f) users.fields.removeById(f.id);
    }
    app.save(users);
  },
);
