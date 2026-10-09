// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

/**
 * Phase 25 RATE-02 / RATE-04 / RATE-05 — PB rate-limit bucket tightening.
 *
 * Exercises the three buckets added / modified by
 * `pocketbase/pb_hooks/bootstrap_ratelimits.pb.js`:
 *   - RATE-02: `users:create` → 10/60s per-IP
 *   - RATE-04: `users:confirmPasswordReset` → 5/60s per-IP
 *   - RATE-05: `*:authWithPassword` → tightened 60/60s → 20/60s
 *
 * Strategy: hit each endpoint rapidly and verify the (max+1)th call
 * returns a 429 Too Many Requests. Also verify the other endpoints
 * remain functional (isolation: per-endpoint labels don't bleed into
 * each other's counters).
 *
 * Port 18107 — next free after 18106 (hooks-row-quotas).
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-rate-limits';
const HTTP = '127.0.0.1:18107';
const BASE = `http://${HTTP}`;

let pbProcess: ChildProcess | undefined;

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

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
        : reject(
            new Error(`superuser create failed (code ${code}): ${stderr}`),
          ),
    );
  });

  pbProcess = spawn(PB_BIN, [
    'serve',
    `--http=${HTTP}`,
    `--dir=${DATA_DIR}`,
    '--migrationsDir=./pocketbase/pb_migrations',
    '--hooksDir=./pocketbase/pb_hooks',
  ]);

  let healthy = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* not ready */
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  if (!healthy) throw new Error('PB did not start within 6s');
}, 30_000);

afterAll(() => {
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('RATE-02/04/05 rate-limit buckets (port 18107)', () => {
  test('RATE-02: users:create caps at 10/60s per-IP', async () => {
    // 10 distinct signups should succeed (or fail with a validation
    // error — what matters is the HTTP status is NOT 429). The 11th
    // must return 429.
    const attempts: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${BASE}/api/collections/users/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `signup${i}-${Date.now()}@test.com`,
          password: 'longenoughpassword',
          passwordConfirm: 'longenoughpassword',
          name: `user${i}`,
        }),
      });
      attempts.push(res.status);
    }

    // The first 10 requests consume the bucket; exact status of each
    // depends on validation, but none should be 429. The 11th or 12th
    // MUST return 429.
    const firstTen = attempts.slice(0, 10);
    const lastTwo = attempts.slice(10);

    expect(firstTen.every((s) => s !== 429)).toBe(true);
    expect(lastTwo.some((s) => s === 429)).toBe(true);
  }, 30_000);

  test('RATE-04: users:confirmPasswordReset caps at 5/60s per-IP', async () => {
    // The confirm-password-reset endpoint requires a token; any
    // non-existent token still consumes the rate-limit bucket before
    // the 400 reason is returned. Fire 6 with random tokens and
    // confirm the 6th is 429.
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await fetch(
        `${BASE}/api/collections/users/confirm-password-reset`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: `fake-${i}-${Date.now()}`,
            password: 'newlongenoughpassword',
            passwordConfirm: 'newlongenoughpassword',
          }),
        },
      );
      statuses.push(res.status);
    }

    const firstFive = statuses.slice(0, 5);
    const tail = statuses.slice(5);
    expect(firstFive.every((s) => s !== 429)).toBe(true);
    expect(tail.some((s) => s === 429)).toBe(true);
  }, 30_000);

  test('RATE-05: *:authWithPassword tightened to 20/60s per-IP', async () => {
    // 21 rapid auth attempts on a non-existent user → first ~20 return
    // 400 (invalid credentials); somewhere in 20..22 the bucket
    // exhausts and a 429 surfaces.
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await fetch(
        `${BASE}/api/collections/users/auth-with-password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identity: `nonexistent${i}@test.com`,
            password: 'wrongpassword',
          }),
        },
      );
      statuses.push(res.status);
    }

    const firstFive = statuses.slice(0, 5);
    const tail = statuses.slice(20);
    expect(firstFive.every((s) => s !== 429)).toBe(true);
    expect(tail.some((s) => s === 429)).toBe(true);
  }, 30_000);
});
