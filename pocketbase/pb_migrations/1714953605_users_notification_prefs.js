/// <reference path="../pb_data/types.d.ts" />

/**
 * 06-01 Task 1 — users collection extension for per-user notification prefs
 * (D-02, NOTF-01..06).
 *
 * Adds six fields to the baseline users collection:
 *   - ntfy_topic             (text,   optional, 4-64 URL-safe chars enforced
 *                             at app-layer + lib/ntfy.ts topic validator)
 *   - notify_overdue         (bool, backfill true)
 *   - notify_assigned        (bool, backfill true)
 *   - notify_partner_completed (bool, backfill false)
 *   - notify_weekly_summary  (bool, backfill false)
 *   - weekly_summary_day     (select: sunday|monday, backfill sunday)
 *
 * Why app-layer topic validation:
 *   PB 0.37.1 TextField `pattern` matches the ENTIRE stored string but
 *   empty-string values (the default for pre-existing rows) would still
 *   need to satisfy the regex. Rather than fight that, `lib/ntfy.ts`
 *   validates topic format at send-time (returning {ok:false,error:'Invalid
 *   topic'} on a miss). The migration sets `max: 64` as the storage hard
 *   cap; topic-presence (non-empty) is enforced in the Person-view form
 *   (Wave 3 plan 06-03).
 *
 * Backfill posture (D-02):
 *   Existing Phase 1..5 users are transitioned into the new schema with
 *   the product-chosen defaults: overdue ON, assigned ON, partner OFF,
 *   weekly-summary OFF, weekly day = sunday, ntfy_topic = ''. This mirrors
 *   1714953604_homes_onboarded.js silent-backfill pattern.
 *
 * Pattern: extend-existing-collection — reuse the post-construction
 * `coll.fields.add(...)` idiom; PB 0.37 silently drops init-object fields
 * if you try to embed them in `new Collection({fields: [...]})` (02-01
 * deviation 1). findCollectionByNameOrId('users') returns the existing
 * collection; fields.add is additive.
 *
 * DOWN: remove each added field by name and save. Guarded with lookup
 * checks so re-running the down is idempotent.
 */

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    users.fields.add(new TextField({ name: 'ntfy_topic', max: 64 }));
    users.fields.add(new BoolField({ name: 'notify_overdue' }));
    users.fields.add(new BoolField({ name: 'notify_assigned' }));
    users.fields.add(new BoolField({ name: 'notify_partner_completed' }));
    users.fields.add(new BoolField({ name: 'notify_weekly_summary' }));
    users.fields.add(
      new SelectField({
        name: 'weekly_summary_day',
        values: ['sunday', 'monday'],
        maxSelect: 1,
        required: false,
      }),
    );

    app.save(users);

    // Backfill defaults for pre-existing users. Empty-filter matches every
    // row per PB JSVM docs. Idempotent: re-setting the same values on a
    // subsequent up-migration is a no-op.
    const rows = app.findRecordsByFilter('users', '');
    for (const r of rows) {
      r.set('notify_overdue', true);
      r.set('notify_assigned', true);
      r.set('notify_partner_completed', false);
      r.set('notify_weekly_summary', false);
      r.set('weekly_summary_day', 'sunday');
      r.set('ntfy_topic', '');
      app.save(r);
    }
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const names = [
      'ntfy_topic',
      'notify_overdue',
      'notify_assigned',
      'notify_partner_completed',
      'notify_weekly_summary',
      'weekly_summary_day',
    ];
    for (const n of names) {
      const f = users.fields.getByName(n);
      if (f) users.fields.removeById(f.id);
    }
    app.save(users);
  },
);
