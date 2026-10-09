import { describe, test, expect } from 'vitest';
import {
  seedSelectionSchema,
  batchCreateSeedsSchema,
} from '@/lib/schemas/seed';

/**
 * Unit coverage for the zod schemas behind `batchCreateSeedTasks`.
 *
 * seedSelectionSchema:
 *   - seed_id         non-empty (library membership is checked in the action)
 *   - name            optional override, 1..100 chars
 *   - frequency_days  optional override, integer in [1, 365]
 *   - area            discriminated union: { kind: 'existing', id (15) } |
 *                     { kind: 'suggested', key: kitchen|bathroom|living|yard|whole_home }
 *
 * batchCreateSeedsSchema:
 *   - home_id     exactly 15 chars
 *   - selections  1..50 items (PB batch maxRequests = 50)
 */

const validHomeId = 'abc123def456xyz'; // 15 chars
const validAreaId = 'def456abc123xyz'; // 15 chars

const validSelection = {
  seed_id: 'seed-wipe-benches',
  name: 'Wipe benches',
  frequency_days: 3,
  area: { kind: 'existing' as const, id: validAreaId },
};

describe('seedSelectionSchema', () => {
  test('accepts a valid selection (happy path)', () => {
    const r = seedSelectionSchema.safeParse(validSelection);
    expect(r.success).toBe(true);
  });

  test('rejects empty seed_id', () => {
    const r = seedSelectionSchema.safeParse({ ...validSelection, seed_id: '' });
    expect(r.success).toBe(false);
  });

  test('rejects empty name', () => {
    const r = seedSelectionSchema.safeParse({ ...validSelection, name: '' });
    expect(r.success).toBe(false);
  });

  test('rejects name > 100 chars', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      name: 'a'.repeat(101),
    });
    expect(r.success).toBe(false);
  });

  test('accepts name at exactly 100 chars (ceiling)', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      name: 'a'.repeat(100),
    });
    expect(r.success).toBe(true);
  });

  test('rejects frequency_days = 0', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      frequency_days: 0,
    });
    expect(r.success).toBe(false);
  });

  test('rejects frequency_days = 366', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      frequency_days: 366,
    });
    expect(r.success).toBe(false);
  });

  test('accepts frequency_days = 1 (floor)', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      frequency_days: 1,
    });
    expect(r.success).toBe(true);
  });

  test('accepts frequency_days = 365 (ceiling)', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      frequency_days: 365,
    });
    expect(r.success).toBe(true);
  });

  test('rejects non-integer frequency_days', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      frequency_days: 3.5,
    });
    expect(r.success).toBe(false);
  });

  test('accepts a bare { seed_id, area: suggested kitchen } (overrides optional)', () => {
    const r = seedSelectionSchema.safeParse({
      seed_id: 'seed-wipe-benches',
      area: { kind: 'suggested', key: 'kitchen' },
    });
    expect(r.success).toBe(true);
  });

  test('accepts every suggested key', () => {
    for (const key of ['kitchen', 'bathroom', 'living', 'yard', 'whole_home']) {
      const r = seedSelectionSchema.safeParse({
        seed_id: 'seed-wipe-benches',
        area: { kind: 'suggested', key },
      });
      expect(r.success, key).toBe(true);
    }
  });

  test('rejects an unknown suggested key', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      area: { kind: 'suggested', key: 'garage' },
    });
    expect(r.success).toBe(false);
  });

  test('rejects an unknown area.kind', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      area: { kind: 'new', name: 'Garage' },
    });
    expect(r.success).toBe(false);
  });

  test('rejects a missing area', () => {
    const r = seedSelectionSchema.safeParse({
      seed_id: 'seed-wipe-benches',
    });
    expect(r.success).toBe(false);
  });

  test('rejects existing area id with wrong length', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      area: { kind: 'existing', id: 'tooshort' },
    });
    expect(r.success).toBe(false);
  });

  test('rejects whitespace-only name override', () => {
    const r = seedSelectionSchema.safeParse({ ...validSelection, name: '   ' });
    expect(r.success).toBe(false);
  });

  test('strips client-supplied seasonal months (server derives them)', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      active_from_month: 4,
      active_to_month: 9,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty('active_from_month');
      expect(r.data).not.toHaveProperty('active_to_month');
    }
  });
});

describe('batchCreateSeedsSchema', () => {
  test('accepts happy path (1 selection)', () => {
    const r = batchCreateSeedsSchema.safeParse({
      home_id: validHomeId,
      selections: [validSelection],
    });
    expect(r.success).toBe(true);
  });

  test('accepts 50 selections (ceiling)', () => {
    const selections = Array.from({ length: 50 }, (_, i) => ({
      ...validSelection,
      seed_id: `seed-${i}`,
    }));
    const r = batchCreateSeedsSchema.safeParse({
      home_id: validHomeId,
      selections,
    });
    expect(r.success).toBe(true);
  });

  test('rejects 51 selections (over ceiling — T-05-03-06 DoS)', () => {
    const selections = Array.from({ length: 51 }, (_, i) => ({
      ...validSelection,
      seed_id: `seed-${i}`,
    }));
    const r = batchCreateSeedsSchema.safeParse({
      home_id: validHomeId,
      selections,
    });
    expect(r.success).toBe(false);
  });

  test('rejects 0 selections (min 1 — skip-all uses skipOnboarding instead)', () => {
    const r = batchCreateSeedsSchema.safeParse({
      home_id: validHomeId,
      selections: [],
    });
    expect(r.success).toBe(false);
  });

  test('rejects home_id with wrong length', () => {
    const r = batchCreateSeedsSchema.safeParse({
      home_id: 'tooshort',
      selections: [validSelection],
    });
    expect(r.success).toBe(false);
  });
});
