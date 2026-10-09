import { describe, test, expect } from 'vitest';
import { removeMemberSchema, leaveHomeSchema } from '@/lib/schemas/member';

/**
 * 04-02 Task 1 — unit coverage for zod schemas used by member server
 * actions. These are deliberately thin — the action-layer guards
 * (authId === memberUserId short-circuit, role === 'owner' short-circuit)
 * are tested in the integration suite, not here.
 */

describe('removeMemberSchema', () => {
  test('accepts valid homeId + memberUserId', () => {
    const r = removeMemberSchema.safeParse({
      homeId: 'home123',
      memberUserId: 'user456',
    });
    expect(r.success).toBe(true);
  });

  test('rejects empty homeId', () => {
    const r = removeMemberSchema.safeParse({
      homeId: '',
      memberUserId: 'user456',
    });
    expect(r.success).toBe(false);
  });

  test('rejects empty memberUserId', () => {
    const r = removeMemberSchema.safeParse({
      homeId: 'home123',
      memberUserId: '',
    });
    expect(r.success).toBe(false);
  });

  test('rejects missing fields', () => {
    const r = removeMemberSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('leaveHomeSchema', () => {
  test('accepts a valid homeId', () => {
    const r = leaveHomeSchema.safeParse({ homeId: 'home123' });
    expect(r.success).toBe(true);
  });

  test('rejects empty homeId', () => {
    const r = leaveHomeSchema.safeParse({ homeId: '' });
    expect(r.success).toBe(false);
  });
});
