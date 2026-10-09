import { describe, test, expect } from 'vitest';
import {
  createInviteSchema,
  acceptInviteSchema,
  revokeInviteSchema,
} from '@/lib/schemas/invite';

/**
 * 04-02 Task 1 — unit coverage for zod schemas used by invite server actions.
 *
 * createInviteSchema: minimal shape — just `{ homeId }` with non-empty string.
 * acceptInviteSchema: token regex `/^[A-Za-z0-9_-]{20,64}$/` (base64url
 *                     alphabet; 20 is the safety floor per migration
 *                     1714953601_invites.js; 64 is the upper bound for
 *                     future-proofing against longer tokens).
 * revokeInviteSchema: `{ inviteId }` non-empty string.
 */

describe('createInviteSchema', () => {
  test('accepts a valid homeId', () => {
    const r = createInviteSchema.safeParse({ homeId: 'validid' });
    expect(r.success).toBe(true);
  });

  test('rejects empty homeId', () => {
    const r = createInviteSchema.safeParse({ homeId: '' });
    expect(r.success).toBe(false);
  });

  test('rejects non-string homeId', () => {
    const r = createInviteSchema.safeParse({ homeId: 123 as unknown as string });
    expect(r.success).toBe(false);
  });
});

describe('acceptInviteSchema', () => {
  test('accepts a 32-char base64url token', () => {
    const r = acceptInviteSchema.safeParse({
      token: 'abc_DEF-ghi_JKL-mno_PQR-stu_VWXY', // 32 chars, base64url
    });
    expect(r.success).toBe(true);
  });

  test('accepts a 20-char token (floor)', () => {
    const r = acceptInviteSchema.safeParse({ token: 'a'.repeat(20) });
    expect(r.success).toBe(true);
  });

  test('rejects a 10-char token (too short)', () => {
    const r = acceptInviteSchema.safeParse({ token: 'a'.repeat(10) });
    expect(r.success).toBe(false);
  });

  test('rejects a 65-char token (too long)', () => {
    const r = acceptInviteSchema.safeParse({ token: 'a'.repeat(65) });
    expect(r.success).toBe(false);
  });

  test('rejects a token containing whitespace', () => {
    const r = acceptInviteSchema.safeParse({ token: 'abc def ghi jkl mno pq' });
    expect(r.success).toBe(false);
  });

  test('accepts a 64-char token (ceiling)', () => {
    const r = acceptInviteSchema.safeParse({ token: 'A'.repeat(64) });
    expect(r.success).toBe(true);
  });
});

describe('revokeInviteSchema', () => {
  test('accepts a valid inviteId', () => {
    const r = revokeInviteSchema.safeParse({ inviteId: 'rec123' });
    expect(r.success).toBe(true);
  });

  test('rejects empty inviteId', () => {
    const r = revokeInviteSchema.safeParse({ inviteId: '' });
    expect(r.success).toBe(false);
  });
});
