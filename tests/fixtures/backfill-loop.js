// Mirrors the backfill body of pocketbase/pb_migrations/1714953600_home_members.js.
//
// This fixture exists because the migration file is JSVM-targeted (runs
// inside PocketBase's embedded goja runtime, uses `new Record(...)`, `app.save`,
// and `app.findRecordsByFilter` globals) — it cannot be imported and exercised
// directly from Node. To keep the test faithful to the migration, the body of
// the backfill loop is reproduced verbatim here against an interface-compatible
// mock app. Any drift between the migration and this fixture is a bug — keep
// them in lockstep.
//
// Interface the mock app must provide:
//   - findRecordsByFilter(collectionName, filter, sort, offset, limit) → array of records.
//     Each record has `.id` and `.get(fieldName)`.
//   - findFirstRecordByFilter(collectionName, filterTemplate, params) → record or throws.
//   - save(recordLike) → void (records the call). `recordLike` is the literal
//     payload `{ home_id, user_id, role }` passed by the backfill.
//
// Usage:
//   import { runBackfill } from 'tests/fixtures/backfill-loop.js';
//   runBackfill(mockApp);
//
// The fixture intentionally does NOT construct PB `Record` instances — the
// mock's `save` receives a plain object so tests can assert on the payload
// directly without depending on the PB SDK.

export function runBackfill(app) {
  const homesRows = app.findRecordsByFilter('homes', '', '', 0, 0);
  for (const home of homesRows) {
    let existing = null;
    try {
      existing = app.findFirstRecordByFilter(
        'home_members',
        'home_id = {:hid} && user_id = {:uid}',
        { hid: home.id, uid: home.get('owner_id') },
      );
    } catch (_err) {
      existing = null;
    }
    if (existing) continue;

    app.save({
      home_id: home.id,
      user_id: home.get('owner_id'),
      role: 'owner',
    });
  }
}
