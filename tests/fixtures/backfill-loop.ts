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
// The fixture intentionally does NOT construct PB `Record` instances — the
// mock's `save` receives a plain object so tests can assert on the payload
// directly without depending on the PB SDK.

export interface BackfillRecordLike {
  id: string;
  get: (field: string) => unknown;
}

export interface BackfillExistingRow {
  home_id: string;
  user_id: string;
}

export interface BackfillMockApp {
  findRecordsByFilter: (
    collection: string,
    filter: string,
    sort: string,
    offset: number,
    limit: number,
  ) => BackfillRecordLike[];
  findFirstRecordByFilter: (
    collection: string,
    filterTemplate: string,
    params: { hid: string; uid: string },
  ) => BackfillExistingRow;
  save: (row: { home_id: string; user_id: string; role: string }) => void;
}

export function runBackfill(app: BackfillMockApp): void {
  const homesRows = app.findRecordsByFilter('homes', '', '', 0, 0);
  for (const home of homesRows) {
    let existing: BackfillExistingRow | null = null;
    try {
      existing = app.findFirstRecordByFilter(
        'home_members',
        'home_id = {:hid} && user_id = {:uid}',
        { hid: home.id, uid: home.get('owner_id') as string },
      );
    } catch {
      existing = null;
    }
    if (existing) continue;

    app.save({
      home_id: home.id,
      user_id: home.get('owner_id') as string,
      role: 'owner',
    });
  }
}
