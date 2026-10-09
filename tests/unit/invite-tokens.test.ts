import { describe, test, expect } from 'vitest';
import { generateInviteToken } from '@/lib/invite-tokens';

/**
 * 04-02 Task 1 — unit coverage for Pattern 6 (invite token generation).
 *
 * Assertions per plan `<behavior>`:
 *   (a) length === 32 (randomBytes(24) → base64url → 32 chars exactly)
 *   (b) matches base64url alphabet /^[A-Za-z0-9_-]+$/
 *   (c) 1000 calls produce 1000 unique tokens (entropy/uniqueness sanity)
 *   (d) returns a string (type guard — belt-and-braces under `unknown` shapes)
 */

describe('generateInviteToken', () => {
  test('returns a 32-char base64url string', () => {
    const t = generateInviteToken();
    expect(typeof t).toBe('string');
    expect(t).toHaveLength(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('produces 1000 unique tokens (uniqueness/entropy)', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) tokens.add(generateInviteToken());
    expect(tokens.size).toBe(1000);
  });

  test('returns a string (type guard)', () => {
    const t: unknown = generateInviteToken();
    expect(typeof t).toBe('string');
  });
});
