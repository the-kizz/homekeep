import { describe, test, expect } from 'vitest';
import {
  SEED_LIBRARY,
  type SeedTask,
  type SeedAreaSuggestion,
  seasonWindow,
  hemisphereFromTimezone,
} from '@/lib/seed-library';

/**
 * 05-01 Task 2 RED→GREEN: SEED_LIBRARY static manifest (D-12 + ONBD-04).
 *
 * The seed library is pure static data consumed by the onboarding wizard
 * (05-03). Tests lock down the invariants future wizard code relies on:
 *
 *  - Stable slug ids for React keys + E2E selectors
 *  - Positive integer frequency_days (matches tasks.frequency_days schema
 *    constraint from 1714780800_init_homekeep.js: `min:1,max:365`)
 *  - Every suggested_area is in the enum (so onboarding can batch by area)
 *  - Coverage: at least one seed per area (ONBD-04 contract)
 *  - Size: 25–40 entries (context spec "~30"). Below 25 would underserve
 *    the wizard's coverage aim; above 40 would overwhelm first-run users.
 */

const ALL_AREAS: ReadonlyArray<SeedAreaSuggestion> = [
  'kitchen',
  'bathroom',
  'living',
  'yard',
  'whole_home',
];

describe('SEED_LIBRARY', () => {
  test('is exported as a non-empty readonly array', () => {
    expect(Array.isArray(SEED_LIBRARY)).toBe(true);
    expect(SEED_LIBRARY.length).toBeGreaterThan(0);
  });

  test('contains 25–40 entries (~30 per CONTEXT D-12)', () => {
    expect(SEED_LIBRARY.length).toBeGreaterThanOrEqual(25);
    expect(SEED_LIBRARY.length).toBeLessThanOrEqual(40);
  });

  test('every entry has a stable, unique, non-empty slug id', () => {
    const seen = new Set<string>();
    for (const seed of SEED_LIBRARY) {
      expect(typeof seed.id).toBe('string');
      expect(seed.id.length).toBeGreaterThan(0);
      // Stable slugs are lowercase kebab (React keys + E2E selectors).
      expect(seed.id).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(seed.id)).toBe(false);
      seen.add(seed.id);
    }
  });

  test('every frequency_days is a positive integer within PB range [1, 365]', () => {
    for (const seed of SEED_LIBRARY) {
      expect(Number.isInteger(seed.frequency_days)).toBe(true);
      expect(seed.frequency_days).toBeGreaterThanOrEqual(1);
      // Matches tasks.frequency_days NumberField(min:1, max:365) schema.
      expect(seed.frequency_days).toBeLessThanOrEqual(365);
    }
  });

  test('every suggested_area is a valid SeedAreaSuggestion enum value', () => {
    for (const seed of SEED_LIBRARY) {
      expect(ALL_AREAS).toContain(seed.suggested_area);
    }
  });

  test('every icon is a non-empty kebab-case Lucide name', () => {
    for (const seed of SEED_LIBRARY) {
      expect(typeof seed.icon).toBe('string');
      expect(seed.icon.length).toBeGreaterThan(0);
      expect(seed.icon).toMatch(/^[a-z0-9-]+$/);
    }
  });

  test('every name is ≤60 characters (PB tasks.name max enforced at schema)', () => {
    for (const seed of SEED_LIBRARY) {
      expect(typeof seed.name).toBe('string');
      expect(seed.name.length).toBeGreaterThan(0);
      expect(seed.name.length).toBeLessThanOrEqual(60);
    }
  });

  test('every description is a non-empty plain-English string', () => {
    for (const seed of SEED_LIBRARY) {
      expect(typeof seed.description).toBe('string');
      expect(seed.description.length).toBeGreaterThan(0);
    }
  });

  test('covers every SeedAreaSuggestion (kitchen / bathroom / living / yard / whole_home)', () => {
    for (const area of ALL_AREAS) {
      const any = SEED_LIBRARY.some((s) => s.suggested_area === area);
      expect(any, `no seeds for area '${area}'`).toBe(true);
    }
  });

  test('SEED_LIBRARY type is SeedTask[] (compile-time check via narrow assignment)', () => {
    // If the export drifts off SeedTask, this assignment fails typecheck.
    const list: ReadonlyArray<SeedTask> = SEED_LIBRARY;
    expect(list.length).toBe(SEED_LIBRARY.length);
  });
});

describe('seasonal seeds resolve by hemisphere', () => {
  const seasonal = SEED_LIBRARY.filter((s) => s.season !== undefined);
  const byId = (id: string) => SEED_LIBRARY.find((s) => s.id === id);

  test('exactly 4 seeds carry a season tag', () => {
    expect(seasonal).toHaveLength(4);
  });

  test('no seasonal seed hard-codes months', () => {
    for (const s of seasonal) {
      expect(s.active_from_month).toBeUndefined();
      expect(s.active_to_month).toBeUndefined();
    }
  });

  test('the two mow-lawn seeds have opposite seasons', () => {
    expect(byId('seed-mow-lawn-warm')?.season).toBe('warm');
    expect(byId('seed-mow-lawn-cool')?.season).toBe('cool');
  });

  test('air conditioner is warm, heater is cool', () => {
    expect(byId('seed-service-ac')?.season).toBe('warm');
    expect(byId('seed-service-heater')?.season).toBe('cool');
  });

  test('frequencies are unchanged (mow warm 14, mow cool 30, services 365)', () => {
    expect(byId('seed-mow-lawn-warm')?.frequency_days).toBe(14);
    expect(byId('seed-mow-lawn-cool')?.frequency_days).toBe(30);
    expect(byId('seed-service-ac')?.frequency_days).toBe(365);
    expect(byId('seed-service-heater')?.frequency_days).toBe(365);
  });

  test('SEED_LIBRARY has exactly 34 entries', () => {
    expect(SEED_LIBRARY.length).toBe(34);
  });
});

describe('seasonWindow', () => {
  test('north: warm = Apr–Sep, cool = Oct–Mar', () => {
    expect(seasonWindow('warm', 'north')).toEqual({ active_from_month: 4, active_to_month: 9 });
    expect(seasonWindow('cool', 'north')).toEqual({ active_from_month: 10, active_to_month: 3 });
  });

  test('south: warm = Oct–Mar, cool = Apr–Sep', () => {
    expect(seasonWindow('warm', 'south')).toEqual({ active_from_month: 10, active_to_month: 3 });
    expect(seasonWindow('cool', 'south')).toEqual({ active_from_month: 4, active_to_month: 9 });
  });
});

describe('hemisphereFromTimezone', () => {
  test.each([
    ['Australia/Perth', 'south'],
    ['Australia/Sydney', 'south'],
    ['Pacific/Auckland', 'south'],
    ['America/Sao_Paulo', 'south'],
    ['America/Argentina/Buenos_Aires', 'south'],
    ['Africa/Johannesburg', 'south'],
    ['Europe/London', 'north'],
    ['America/New_York', 'north'],
    ['Asia/Tokyo', 'north'],
    ['UTC', 'north'],
    ['', 'north'],
  ] as const)('%s → %s', (tz, expected) => {
    expect(hemisphereFromTimezone(tz)).toBe(expected);
  });
});
