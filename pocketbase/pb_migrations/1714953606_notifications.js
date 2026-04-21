/// <reference path="../pb_data/types.d.ts" />

/**
 * 06-01 Task 1 — notifications collection with (user_id, ref_cycle) unique
 * index (D-05, NOTF-03/04/05/06; threat_model T-06-01-01..03).
 *
 * This is the scheduler's idempotency store. Every ntfy send goes
 * through `recordNotification()` (lib/notifications.ts) which inserts a
 * row keyed by `ref_cycle` — a deterministic string derived from the
 * thing being notified (e.g. `task:{taskId}:overdue:{nextDueIso}`,
 * `user:{userId}:weekly:{weekStartIso}`). Before sending, the scheduler
 * calls `hasNotified()` to pre-check; if the row already exists, skip.
 *
 * Two-layer dedupe contract (D-05):
 *   Layer 1: `hasNotified()` app-side read — catches the common case.
 *   Layer 2: UNIQUE INDEX idx_notifications_user_ref_cycle — catches
 *            the race where two scheduler ticks pre-check simultaneously
 *            and both think they're first. Second INSERT errors with
 *            400 (SQLite UNIQUE violation) and `recordNotification`
 *            swallows it returning null (best-effort semantics —
 *            ntfy has already fired in one of the two processes).
 *
 * Rules posture (threat_model T-06-01-01/02):
 *   listRule/viewRule = `@request.auth.id != "" && user_id = @request.auth.id`
 *     → users see only their OWN notification history. If Wave 3 surfaces
 *       a per-user feed, this rule carries it safely.
 *   createRule / updateRule / deleteRule = null
 *     → writes are superuser-only. The Wave 2 scheduler uses
 *       `createAdminClient()` (04-02 pattern) to insert rows; there is
 *       no user-facing write path.
 *
 * Task-id is nullable: weekly_summary kind has no task scope, so
 * maxSelect=1 + minSelect=0 keeps the relation optional. The other
 * kinds (overdue, assigned, partner_completed) always carry a task id,
 * but the schema doesn't enforce that partition — it's a caller
 * invariant.
 *
 * Constructor-vs-post-construction: fields + indexes added AFTER
 * `new Collection({...})` per 02-01 deviation (PB 0.37 silently drops
 * init-object fields).
 */

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const homes = app.findCollectionByNameOrId('homes');
    const tasks = app.findCollectionByNameOrId('tasks');

    const notifications = new Collection({
      type: 'base',
      name: 'notifications',
      // User sees only their own rows if ever surfaced. superuser scheduler
      // writes bypass rules.
      listRule: '@request.auth.id != "" && user_id = @request.auth.id',
      viewRule: '@request.auth.id != "" && user_id = @request.auth.id',
      // Scheduler uses superuser client; no user-facing write path.
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });

    notifications.fields.add(
      new RelationField({
        name: 'user_id',
        required: true,
        collectionId: users.id,
        cascadeDelete: true, // user delete cascades their notification trail
        minSelect: 1,
        maxSelect: 1,
      }),
    );
    notifications.fields.add(
      new RelationField({
        name: 'home_id',
        required: true,
        collectionId: homes.id,
        cascadeDelete: true,
        minSelect: 1,
        maxSelect: 1,
      }),
    );
    notifications.fields.add(
      new RelationField({
        name: 'task_id',
        required: false,
        collectionId: tasks.id,
        cascadeDelete: true,
        minSelect: 0,
        maxSelect: 1,
      }),
    );
    notifications.fields.add(
      new SelectField({
        name: 'kind',
        required: true,
        values: ['overdue', 'assigned', 'partner_completed', 'weekly_summary'],
        maxSelect: 1,
      }),
    );
    notifications.fields.add(new DateField({ name: 'sent_at', required: true }));
    notifications.fields.add(
      new TextField({ name: 'ref_cycle', required: true, max: 200 }),
    );
    notifications.fields.add(
      new AutodateField({ name: 'created', onCreate: true }),
    );

    notifications.indexes = [
      // Idempotency safety net (D-05). Per-user, not global — same
      // ref_cycle across different users must co-exist (two members of
      // the same household both get a weekly summary with the same
      // week-start key).
      'CREATE UNIQUE INDEX idx_notifications_user_ref_cycle ON notifications (user_id, ref_cycle)',
      // Access path: "recent notifications for user X" — Wave 3's
      // optional history surface.
      'CREATE INDEX idx_notifications_user_sent ON notifications (user_id, sent_at)',
    ];

    app.save(notifications);
  },
  (app) => {
    try {
      const c = app.findCollectionByNameOrId('notifications');
      app.delete(c);
    } catch (_) {
      /* idempotent */
    }
  },
);
