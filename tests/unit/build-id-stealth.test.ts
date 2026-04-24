// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Phase 24 HDR-04 — HK_BUILD_STEALTH contract tests.
 *
 * Covers:
 *   1. getBuildIdPublic() returns `hk-hidden` when HK_BUILD_STEALTH=true.
 *   2. getBuildIdPublic() returns the real HOMEKEEP_BUILD when flag is unset.
 *   3. Any other value ("false", "yes", empty) falls back to real build id.
 *   4. HK_BUILD_STEALTH is evaluated PER CALL, not frozen at module load —
 *      lets operators flip the flag via compose env without rebuilding.
 */
describe('HDR-04 — HK_BUILD_STEALTH gate on build id', () => {
  const originalStealth = process.env.HK_BUILD_STEALTH;

  beforeEach(() => {
    delete process.env.HK_BUILD_STEALTH;
  });

  afterEach(() => {
    if (originalStealth === undefined) {
      delete process.env.HK_BUILD_STEALTH;
    } else {
      process.env.HK_BUILD_STEALTH = originalStealth;
    }
  });

  it('returns "hk-hidden" when HK_BUILD_STEALTH=true', async () => {
    process.env.HK_BUILD_STEALTH = 'true';
    const { getBuildIdPublic } = await import('@/lib/constants');
    expect(getBuildIdPublic()).toBe('hk-hidden');
  });

  it('returns the real HOMEKEEP_BUILD when HK_BUILD_STEALTH is unset', async () => {
    const { getBuildIdPublic, HOMEKEEP_BUILD } = await import('@/lib/constants');
    expect(getBuildIdPublic()).toBe(HOMEKEEP_BUILD);
  });

  it('returns the real build id for any non-"true" value', async () => {
    const { getBuildIdPublic, HOMEKEEP_BUILD } = await import('@/lib/constants');
    for (const v of ['false', 'yes', '1', 'TRUE', '']) {
      process.env.HK_BUILD_STEALTH = v;
      expect(getBuildIdPublic()).toBe(HOMEKEEP_BUILD);
    }
  });

  it('re-reads process.env on each call (not frozen at import time)', async () => {
    const { getBuildIdPublic, HOMEKEEP_BUILD } = await import('@/lib/constants');
    // Baseline — unset → real id.
    expect(getBuildIdPublic()).toBe(HOMEKEEP_BUILD);
    // Flip on → stealth.
    process.env.HK_BUILD_STEALTH = 'true';
    expect(getBuildIdPublic()).toBe('hk-hidden');
    // Flip off → real id again.
    delete process.env.HK_BUILD_STEALTH;
    expect(getBuildIdPublic()).toBe(HOMEKEEP_BUILD);
  });
});
