import { describe, test, expect } from 'vitest';
import {
  seedSelectionSchema,
  batchCreateSeedsSchema,
} from '@/lib/schemas/seed';

/**
 * 05-03 Task 1 — unit coverage for zod schemas used by the onboarding
 * wizard's batch-create server action (`batchCreateSeedTasks`).
 *
 * seedSelectionSchema:
 *   - seed_id  non-empty string (client must reference a real SEED_LIBRARY
 *              entry; belt-and-braces membership check runs in the action
 *              itself, T-05-03-01)
 *   - name     1..100 chars (matches taskSchema.name max=120 but wizard
 *              enforces tighter 100 to match the name field label width)
 *   - frequency_days  integer in [1, 365] (matches taskSchema contract,
 *              T-05-03-03 DoS threat model)
 *   - area_id  exactly 15 chars (PB record-id length; guards against
 *              malformed client payloads pre-PB call)
 *
 * batchCreateSeedsSchema:
 *   - home_id  exactly 15 chars (same PB id contract)
 *   - selections  1..50 items (min 1: skip-all uses skipOnboarding instead;
 *                 max 50: T-05-03-06 DoS + matches PB batch maxRequests=50
 *                 from bootstrap_batch.pb.js)
 */

const validHomeId = 'abc123def456xyz'; // 15 chars
const validAreaId = 'def456abc123xyz'; // 15 chars

const validSelection = {
  seed_id: 'seed-wipe-benches',
  name: 'Wipe benches',
  frequency_days: 3,
  area_id: validAreaId,
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

  test('rejects area_id with wrong length', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      area_id: 'tooshort',
    });
    expect(r.success).toBe(false);
  });

  test('SEAS-09: accepts active_from_month + active_to_month as paired optional numbers', () => {
    const r = seedSelectionSchema.safeParse({
      ...validSelection,
      active_from_month: 4,
      active_to_month: 9,
    });
    expect(r.success).toBe(true);
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
