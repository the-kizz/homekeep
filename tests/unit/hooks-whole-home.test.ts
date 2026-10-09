// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-whole-home';
const HTTP = '127.0.0.1:18090';

let pbProcess: ChildProcess | undefined;

beforeAll(async () => {
  // Ensure a clean slate — PB will apply migrations fresh against an empty dir.
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // Create the superuser BEFORE starting `serve` so the SQLite DB is not
  // contended and the superuser row exists in _superusers when serve boots.
  // (Running `superuser create` against a live serve on the same --dir will
  // race the WAL lock and often land a row the server cannot see until its
  // next page-read cycle — authWithPassword then 400s with "Failed to
  // authenticate".)
  await new Promise<void>((resolve, reject) => {
    const p = spawn(PB_BIN, [
      'superuser',
      'create',
      'test@test.com',
      'testpass123',
      `--dir=${DATA_DIR}`,
    ]);
    let stderr = '';
    p.stderr?.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`superuser create failed (code ${code}): ${stderr}`))
    );
  });

  pbProcess = spawn(PB_BIN, [
    'serve',
    `--http=${HTTP}`,
    `--dir=${DATA_DIR}`,
    '--migrationsDir=./pocketbase/pb_migrations',
    '--hooksDir=./pocketbase/pb_hooks',
  ]);

  // Poll for PB readiness: 30 × 200ms = 6s ceiling
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://${HTTP}/api/health`);
      if (r.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error('PB did not start within 6s');
}, 15_000);

afterAll(() => {
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('Whole Home auto-create hook', () => {
  test('creates a Whole Home area when a home is inserted', async () => {
    const pb = new PocketBase(`http://${HTTP}`);

    // Authenticate as the superuser seeded in beforeAll — bypasses API rules
    // for fixture setup (PB 0.23+ renamed admins collection to _superusers).
    await pb
      .collection('_superusers')
      .authWithPassword('test@test.com', 'testpass123');

    // Create an end-user record in the built-in `users` auth collection.
    const user = await pb.collection('users').create({
      email: 'alice@test.com',
      password: 'alice123456',
      passwordConfirm: 'alice123456',
      name: 'Alice',
    });

    // Insert a home — the onRecordCreateExecute("homes") hook should fire
    // inside the same transaction and create the Whole Home area atomically.
    let home;
    try {
      home = await pb.collection('homes').create({
        name: 'Test Home',
        timezone: 'Australia/Perth',
        owner_id: user.id,
      });
    } catch (err: any) {
      // Surface PB's validation error detail for diagnosis (otherwise the
      // ClientResponseError toString is just "Failed to create record").
      throw new Error(
        `homes.create failed: ${err?.message} | ${JSON.stringify(err?.response)}`
      );
    }

    // Assert: exactly one area exists under the new home, and it's the
    // Whole Home system area with the correct flags.
    const areas = await pb.collection('areas').getFullList({
      filter: `home_id = "${home.id}"`,
    });

    expect(areas).toHaveLength(1);
    expect(areas[0].name).toBe('Whole Home');
    expect(areas[0].scope).toBe('whole_home');
    expect(areas[0].is_whole_home_system).toBe(true);
  }, 15_000);
});
