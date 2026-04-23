/**
 * Phase 25 RATE-03 — in-memory rate limiter + per-token lockout for
 * invite-accept flow (and other app-layer server actions).
 *
 * Why app-layer (D-07): invite-accept is a Next.js server action, not
 * a PB REST endpoint, so PB's rate-limit buckets (bootstrap_ratelimits)
 * do not cover it. The generic /api/ 300/60s ceiling DOES cover the
 * downstream PB writes, but only after the server action has already
 * executed its admin-client lookup — far too loose to stop token-guess
 * brute force (the read is via admin credentials and is not rate-
 * limited by any bucket).
 *
 * Limiter shape (D-08, D-09):
 *   - Sliding window implemented as a Map<string, number[]> where each
 *     entry holds timestamps of hits within the current window.
 *     Expired timestamps are trimmed on every check.
 *   - Per-token failure counter tracks invalid / expired / already-
 *     accepted attempts; at 3 failures the token is locked for 15 min,
 *     regardless of its natural TTL.
 *   - State is module-level and lives in Node's memory — cleared on
 *     server restart. For a self-hosted deployment this is an
 *     acceptable trade-off (invites are low-frequency, restarts are
 *     rare, and the PB-layer /api/ ceiling remains the outer cap).
 *
 * Public API:
 *   - checkLimit(key, max, windowMs) → true if request is allowed,
 *     false if rate-limit breached.
 *   - recordTokenFailure(token) → increments failure counter; at 3
 *     failures locks the token for 15 minutes.
 *   - isTokenLocked(token) → true if token is in lockout window.
 */

const hits: Map<string, number[]> = new Map();
const tokenFailures: Map<string, number> = new Map();
const tokenLockouts: Map<string, number> = new Map(); // token → unix ms when lock expires

const TOKEN_FAILURE_THRESHOLD = 3;
const TOKEN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check whether a request with the given rate-limit `key` (typically a
 * client IP) is allowed under a sliding window of `max` requests per
 * `windowMs` milliseconds. Records the hit if allowed.
 *
 * Returns true if the request is allowed, false if rate-limited.
 */
export function checkLimit(
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const windowStart = now - windowMs;
  const existing = hits.get(key) ?? [];
  // Trim expired timestamps.
  const recent = existing.filter((t) => t > windowStart);

  if (recent.length >= max) {
    // Rate-limited — do NOT add this hit to the window (otherwise a
    // blocked caller would indefinitely extend its own lockout).
    // Still persist the trimmed slice so memory reclaims over time.
    hits.set(key, recent);
    return false;
  }

  recent.push(now);
  hits.set(key, recent);
  return true;
}

/**
 * Record a token-level failure (invalid token, expired, already-
 * accepted, etc). At TOKEN_FAILURE_THRESHOLD failures the token is
 * locked for TOKEN_LOCKOUT_MS.
 *
 * Returns true if the token is now locked (i.e. this failure pushed
 * it over the threshold).
 */
export function recordTokenFailure(token: string): boolean {
  const prev = tokenFailures.get(token) ?? 0;
  const next = prev + 1;
  tokenFailures.set(token, next);

  if (next >= TOKEN_FAILURE_THRESHOLD) {
    tokenLockouts.set(token, Date.now() + TOKEN_LOCKOUT_MS);
    return true;
  }
  return false;
}

/**
 * Check whether a token is currently locked out. Expired lockouts are
 * cleaned up lazily on access.
 */
export function isTokenLocked(token: string): boolean {
  const expiresAt = tokenLockouts.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    tokenLockouts.delete(token);
    tokenFailures.delete(token);
    return false;
  }
  return true;
}

/**
 * Reset all limiter state. TEST-ONLY — exposed so integration tests
 * can run each scenario in a clean slate without waiting for the real
 * window to expire.
 */
export function _resetRateLimitStateForTests(): void {
  hits.clear();
  tokenFailures.clear();
  tokenLockouts.clear();
}
