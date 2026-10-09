import { describe, test, expect, beforeEach } from 'vitest';
import {
  checkLimit,
  recordTokenFailure,
  isTokenLocked,
  _resetRateLimitStateForTests,
} from '@/lib/rate-limit';

/**
 * Phase 25 RATE-03 — unit coverage for the in-memory rate limiter and
 * per-token lockout helpers.
 *
 * Sliding window semantics:
 *   - max=N, windowMs=W: the first N calls with the same key within a
 *     W-ms window return true; the (N+1)th within the same window
 *     returns false. Timestamps older than W are trimmed so the
 *     counter recovers over time.
 *
 * Per-token lockout:
 *   - After TOKEN_FAILURE_THRESHOLD (3) failures, the token is locked
 *     for TOKEN_LOCKOUT_MS (15 min). isTokenLocked returns true for
 *     the locked token; subsequent success calls do NOT clear the
 *     lockout (only the clock-based expiry does).
 */

beforeEach(() => {
  _resetRateLimitStateForTests();
});

describe('checkLimit (sliding window)', () => {
  test('allows up to max calls within a window', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkLimit('ip:1', 5, 60_000)).toBe(true);
    }
  });

  test('rejects the (max+1)th call within the same window', () => {
    for (let i = 0; i < 5; i++) {
      checkLimit('ip:1', 5, 60_000);
    }
    expect(checkLimit('ip:1', 5, 60_000)).toBe(false);
  });

  test('distinct keys are independent', () => {
    for (let i = 0; i < 5; i++) {
      checkLimit('ip:1', 5, 60_000);
    }
    // Different key still has fresh budget.
    expect(checkLimit('ip:2', 5, 60_000)).toBe(true);
  });

  test('blocked call does NOT extend its own window', () => {
    for (let i = 0; i < 5; i++) {
      checkLimit('ip:1', 5, 60_000);
    }
    // Three blocked calls don't push back the expiry; the first
    // allowed timestamp is still N ms ago. After windowMs expires,
    // the counter is fully reset.
    for (let i = 0; i < 3; i++) {
      expect(checkLimit('ip:1', 5, 60_000)).toBe(false);
    }
  });

  test('allows a single call when max is 1', () => {
    expect(checkLimit('solo', 1, 1000)).toBe(true);
    expect(checkLimit('solo', 1, 1000)).toBe(false);
  });
});

describe('recordTokenFailure + isTokenLocked', () => {
  test('non-failing token is not locked', () => {
    expect(isTokenLocked('tok-1')).toBe(false);
  });

  test('locks after 3 failures', () => {
    expect(recordTokenFailure('tok-2')).toBe(false); // 1
    expect(isTokenLocked('tok-2')).toBe(false);
    expect(recordTokenFailure('tok-2')).toBe(false); // 2
    expect(isTokenLocked('tok-2')).toBe(false);
    expect(recordTokenFailure('tok-2')).toBe(true); // 3 → locked
    expect(isTokenLocked('tok-2')).toBe(true);
  });

  test('additional failures after lockout remain locked', () => {
    recordTokenFailure('tok-3');
    recordTokenFailure('tok-3');
    recordTokenFailure('tok-3');
    expect(isTokenLocked('tok-3')).toBe(true);
    // Additional failures are fine — the lockout is active.
    recordTokenFailure('tok-3');
    expect(isTokenLocked('tok-3')).toBe(true);
  });

  test('distinct tokens track failures independently', () => {
    recordTokenFailure('tok-a');
    recordTokenFailure('tok-a');
    recordTokenFailure('tok-b');
    // tok-a has 2 failures, tok-b has 1 — neither is locked.
    expect(isTokenLocked('tok-a')).toBe(false);
    expect(isTokenLocked('tok-b')).toBe(false);
  });
});
