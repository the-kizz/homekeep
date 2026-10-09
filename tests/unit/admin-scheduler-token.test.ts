// @vitest-environment node
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Phase 23 SEC-03 — timing-safe scheduler token compare.
 *
 * The `app/api/admin/run-scheduler/route.ts` POST handler previously
 * used `provided !== token` which is a character-by-character string
 * compare subject to an early-exit timing side channel. SEC-03 swaps
 * this for `crypto.timingSafeEqual` with a length-equality pre-check.
 *
 * This test drives the route's POST handler end-to-end (we can't
 * export `tokenEquals` from a Next.js route segment — Next restricts
 * route file exports to HTTP methods + segment config). The
 * correctness contract we verify:
 *
 *   1. Correct token -> 200 OK path (we mock `@/lib/scheduler` so
 *      runOnce returns a trivial result without booting cron).
 *   2. Wrong-length token -> 401 (length mismatch short-circuits
 *      before timingSafeEqual runs).
 *   3. Wrong-value same-length token -> 401 (timingSafeEqual rejects).
 *   4. Missing header -> 401.
 *
 * We can't directly observe timing in a unit test (environmental
 * jitter swamps the nanosecond-scale signal), but the code-level
 * contract we're asserting is: the wrong-value branch goes through
 * timingSafeEqual (which is constant-time by construction), not the
 * early-exit string `!==`. The behavioral invariants above cover
 * every branch the new code introduces.
 */

const TOKEN = 'a'.repeat(32); // valid 32-char token
const WRONG_SAME_LEN = 'b'.repeat(32);
const WRONG_SHORT = 'a'.repeat(10);
const WRONG_LONG = 'a'.repeat(64);

// Mock lib/scheduler so POST's dynamic import doesn't boot node-cron.
vi.mock('@/lib/scheduler', () => ({
  runOnce: async () => ({ overdueSent: 0, weeklySent: 0 }),
}));

describe('POST /api/admin/run-scheduler — timing-safe token compare (SEC-03)', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.ADMIN_SCHEDULER_TOKEN;
    process.env.ADMIN_SCHEDULER_TOKEN = TOKEN;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ADMIN_SCHEDULER_TOKEN;
    } else {
      process.env.ADMIN_SCHEDULER_TOKEN = originalEnv;
    }
  });

  test('correct token -> 200 with runOnce result', async () => {
    const { POST } = await import('@/app/api/admin/run-scheduler/route');
    const req = new Request('http://test.local/api/admin/run-scheduler', {
      method: 'POST',
      headers: { 'x-admin-token': TOKEN },
      body: JSON.stringify({ kind: 'both' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test('wrong-length (short) token -> 401 (length mismatch short-circuits)', async () => {
    const { POST } = await import('@/app/api/admin/run-scheduler/route');
    const req = new Request('http://test.local/api/admin/run-scheduler', {
      method: 'POST',
      headers: { 'x-admin-token': WRONG_SHORT },
      body: '{}',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('wrong-length (long) token -> 401', async () => {
    const { POST } = await import('@/app/api/admin/run-scheduler/route');
    const req = new Request('http://test.local/api/admin/run-scheduler', {
      method: 'POST',
      headers: { 'x-admin-token': WRONG_LONG },
      body: '{}',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('wrong-value same-length token -> 401 (timingSafeEqual rejects)', async () => {
    const { POST } = await import('@/app/api/admin/run-scheduler/route');
    const req = new Request('http://test.local/api/admin/run-scheduler', {
      method: 'POST',
      headers: { 'x-admin-token': WRONG_SAME_LEN },
      body: '{}',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('missing header -> 401', async () => {
    const { POST } = await import('@/app/api/admin/run-scheduler/route');
    const req = new Request('http://test.local/api/admin/run-scheduler', {
      method: 'POST',
      body: '{}',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('env token too short -> 401 regardless of header', async () => {
    process.env.ADMIN_SCHEDULER_TOKEN = 'tooshort';
    const { POST } = await import('@/app/api/admin/run-scheduler/route');
    const req = new Request('http://test.local/api/admin/run-scheduler', {
      method: 'POST',
      headers: { 'x-admin-token': 'tooshort' },
      body: '{}',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
