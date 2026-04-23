import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

/**
 * Manual scheduler trigger (06-02 Task 1, D-09 + T-06-02-05/06).
 *
 * Endpoint: `POST /api/admin/run-scheduler`
 *
 * Purpose:
 *   - E2E tests need a deterministic way to fire the scheduler without
 *     waiting for the hourly cron boundary.
 *   - Ops / manual debugging — "push me one overdue batch right now"
 *     without touching the container to restart.
 *
 * Auth model:
 *   - Pre-shared static token in `ADMIN_SCHEDULER_TOKEN` env var. Sent
 *     via the `x-admin-token` request header.
 *   - MUST be >= 32 chars (fail-closed if unset or shorter).
 *   - NEVER log the header or the env var — T-06-02-06.
 *   - Phase 23 SEC-03: the equality check uses `crypto.timingSafeEqual`
 *     on Buffer views of the two strings, with an explicit length-
 *     equality pre-check (timingSafeEqual throws on length mismatch).
 *     This removes the `!==` string-compare early-exit timing side
 *     channel that could otherwise leak the token byte-by-byte to a
 *     network attacker. A length mismatch short-circuits to `false`
 *     without running the compare — we do NOT leak via response (401
 *     either way) and the leaked bit (length) is already public-ish
 *     (ADMIN_SCHEDULER_TOKEN enforces >= 32 chars).
 *
 * Body (optional JSON): `{ "kind": "overdue" | "weekly" | "both" }`.
 * Defaults to "both".
 *
 * Runtime: explicit 'nodejs' so node-cron imports resolve correctly.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RunKind = 'overdue' | 'weekly' | 'both';

/**
 * Timing-safe string equality (SEC-03).
 *
 * timingSafeEqual requires equal-length inputs and throws otherwise.
 * We pre-check length and return false immediately on mismatch — no
 * compare runs, so attackers cannot probe for token length through
 * timing (the length is already bounded-public via the >=32 env gate).
 *
 * Buffer.byteLength is NOT used as the allocation size because
 * timingSafeEqual runs over raw bytes; both sides convert via
 * `Buffer.from(str)` using the default UTF-8 encoding. Tokens are
 * expected to be ASCII hex / base64, so byteLength === length.
 */
function tokenEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(req: Request): Promise<Response> {
  const token = process.env.ADMIN_SCHEDULER_TOKEN;
  if (!token || token.length < 32) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401 },
    );
  }

  const provided = req.headers.get('x-admin-token');
  if (!provided || !tokenEquals(provided, token)) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401 },
    );
  }

  let kind: RunKind = 'both';
  try {
    const body = (await req.json().catch(() => ({}))) as {
      kind?: string;
    };
    if (body.kind === 'overdue' || body.kind === 'weekly') {
      kind = body.kind;
    }
  } catch {
    /* default both */
  }

  try {
    const { runOnce } = await import('@/lib/scheduler');
    const result = await runOnce({ kind });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    // Never leak the underlying error to the network — log server-side.
    console.error('[admin/run-scheduler] runOnce failed', e);
    return NextResponse.json(
      { ok: false, error: 'internal' },
      { status: 500 },
    );
  }
}
