// @vitest-environment node
import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import PocketBase from 'pocketbase';

/**
 * Phase 25 RATE-03 — invite-accept rate limit + per-token lockout.
 *
 * Exercises the guards added to lib/actions/invites.ts:
 *   - Per-IP 5/60s limit on acceptInvite calls (returns rate-limited).
 *   - Per-token 3-failure → 15-min lockout (returns locked).
 *
 * Port 18108 — next free after 18107 (hooks-rate-limits).
 */

const PB_BIN = './.pb/pocketbase';
const DATA_DIR = './.pb/test-pb-data-invite-rate-limit';
const HTTP = '127.0.0.1:18108';
const ADMIN_EMAIL = 'test@test.com';
const ADMIN_PASS = 'testpass123';

let pbProcess: ChildProcess | undefined;
let adminClient: PocketBase;
let currentAuthed: PocketBase;

vi.mock('@/lib/pocketbase-server', () => ({
  createServerClient: async () => currentAuthed,
}));

vi.mock('@/lib/pocketbase-admin', () => ({
  createAdminClient: async () => adminClient,
  resetAdminClientCache: () => {},
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    const err = new Error(`NEXT_REDIRECT:${target}`);
    (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${target}`;
    throw err;
  },
}));

// Mock next/headers so headers() returns a deterministic IP. This is
// the pivot point for isolating per-IP buckets between scenarios —
// each test clears the limiter state and sets its own IP.
const mockedHeaders = vi.hoisted(() => ({ clientIp: 'ip-unset' }));

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => {
      if (name === 'x-forwarded-for') return mockedHeaders.clientIp;
      if (name === 'x-real-ip') return mockedHeaders.clientIp;
      return null;
    },
  }),
}));

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const p = spawn(PB_BIN, [
      'superuser',
      'create',
      ADMIN_EMAIL,
      ADMIN_PASS,
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
      const r = await fetch(`http://${HTTP}/api/health`);
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

  adminClient = new PocketBase(`http://${HTTP}`);
  await adminClient
    .collection('_superusers')
    .authWithPassword(ADMIN_EMAIL, ADMIN_PASS);
}, 30_000);

afterAll(() => {
  adminClient?.authStore.clear();
  pbProcess?.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  // Clear limiter state between scenarios so per-IP / per-token
  // counters don't leak.
  const { _resetRateLimitStateForTests } = await import('@/lib/rate-limit');
  _resetRateLimitStateForTests();
});

describe('RATE-03 invite-accept rate-limit + lockout (port 18108)', () => {
  test('Scenario A — 5 accepts/60s per-IP, 6th returns rate-limited', async () => {
    mockedHeaders.clientIp = '10.0.0.1';

    // Seed a user (Bob) and auth as him so the action's "isAuthed"
    // check passes.
    const bob = await adminClient.collection('users').create({
      email: 'bob-a@test.com',
      password: 'bob1234567890',
      passwordConfirm: 'bob1234567890',
      name: 'Bob',
    });
    const bobClient = new PocketBase(`http://${HTTP}`);
    await bobClient
      .collection('users')
      .authWithPassword('bob-a@test.com', 'bob1234567890');
    currentAuthed = bobClient;
    // avoid unused warning
    void bob;

    const { acceptInvite } = await import('@/lib/actions/invites');

    // Fire 6 accept attempts with fake (invalid) tokens — the limiter
    // only cares about call frequency, not token validity. Each fake
    // token is DIFFERENT so we don't trip the per-token lockout
    // (which would mask the per-IP limit).
    const results: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await acceptInvite(`fake-invalid-token-${i}aaaaaaaaaaa`);
      if (r.ok) {
        results.push('ok');
      } else {
        results.push(r.reason);
      }
    }

    // First 5 are allowed by the IP bucket (they return 'invalid' for
    // non-existent token lookups). The 6th is rate-limited.
    const firstFive = results.slice(0, 5);
    const sixth = results[5];
    expect(firstFive.every((r) => r === 'invalid')).toBe(true);
    expect(sixth).toBe('rate-limited');
  }, 60_000);

  test('Scenario B — 3 failures on the SAME token → 4th returns locked', async () => {
    mockedHeaders.clientIp = '10.0.0.2';

    const charlie = await adminClient.collection('users').create({
      email: 'charlie-b@test.com',
      password: 'charlie1234567',
      passwordConfirm: 'charlie1234567',
      name: 'Charlie',
    });
    const charlieClient = new PocketBase(`http://${HTTP}`);
    await charlieClient
      .collection('users')
      .authWithPassword('charlie-b@test.com', 'charlie1234567');
    currentAuthed = charlieClient;
    void charlie;

    const { acceptInvite } = await import('@/lib/actions/invites');

    // Fire 4 attempts with the SAME fake token. Each of the first 3
    // records a failure; the 3rd triggers the lockout.
    const fakeToken = 'same-fake-token-000000000000000000';
    const results: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await acceptInvite(fakeToken);
      results.push(r.ok ? 'ok' : r.reason);
    }

    // Attempt 1: invalid (1 failure)
    // Attempt 2: invalid (2 failures)
    // Attempt 3: LOCKED (3rd failure → lockout fires as part of this
    //            response; recordTokenFailure returns true on the 3rd
    //            increment)
    // Attempt 4: locked (isTokenLocked short-circuits before lookup)
    expect(results[0]).toBe('invalid');
    expect(results[1]).toBe('invalid');
    expect(results[2]).toBe('locked');
    expect(results[3]).toBe('locked');
  }, 60_000);
});
