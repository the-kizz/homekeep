import { describe, test, expect } from 'vitest';
import { areaSchema } from '@/lib/schemas/area';
import { AREA_COLORS, AREA_ICONS } from '@/lib/area-palette';

/**
 * 02-04 Task 1 RED → GREEN: areaSchema validation (D-10 + D-19).
 *
 * The zod enum over AREA_COLORS enforces the fixed palette end-to-end — a
 * client bypass trying to POST a rogue hex still fails at the server
 * re-parse, feeding the T-02-04-01 mitigation.
 */

describe('areaSchema', () => {
  test('accepts full valid area', () => {
    const r = areaSchema.safeParse({
      home_id: 'abc',
      name: 'Kitchen',
      icon: AREA_ICONS[0],
      color: AREA_COLORS[0],
      sort_order: 1,
      scope: 'location',
    });
    expect(r.success).toBe(true);
  });

  test('accepts whole_home scope', () => {
    const r = areaSchema.safeParse({
      home_id: 'abc',
      name: 'Whole Home',
      icon: AREA_ICONS[0],
      color: AREA_COLORS[0],
      sort_order: 0,
      scope: 'whole_home',
    });
    expect(r.success).toBe(true);
  });

  test('accepts optional default_assignee_id as string', () => {
    const r = areaSchema.safeParse({
      home_id: 'abc',
      name: 'Kitchen',
      icon: AREA_ICONS[0],
      color: AREA_COLORS[0],
      sort_order: 0,
      scope: 'location',
      default_assignee_id: 'user123',
    });
    expect(r.success).toBe(true);
  });

  test('rejects color outside palette', () => {
    const r = areaSchema.safeParse({
      home_id: 'abc',
      name: 'K',
      icon: AREA_ICONS[0],
      color: '#FF00FF',
      sort_order: 0,
      scope: 'location',
    });
    expect(r.success).toBe(false);
  });

  test('rejects icon outside AREA_ICONS', () => {
    const r = areaSchema.safeParse({
      home_id: 'abc',
      name: 'K',
      icon: 'not-a-real-icon',
      color: AREA_COLORS[0],
      sort_order: 0,
      scope: 'location',
    });
    expect(r.success).toBe(false);
  });

  test('rejects empty name', () => {
    const r = areaSchema.safeParse({
      home_id: 'a',
      name: '',
      icon: AREA_ICONS[0],
      color: AREA_COLORS[0],
      sort_order: 0,
      scope: 'location',
    });
    expect(r.success).toBe(false);
  });

  test('rejects name over 60 chars', () => {
    const r = areaSchema.safeParse({
      home_id: 'a',
      name: 'x'.repeat(61),
      icon: AREA_ICONS[0],
      color: AREA_COLORS[0],
      sort_order: 0,
      scope: 'location',
    });
    expect(r.success).toBe(false);
  });

  test('rejects non-integer sort_order', () => {
    const r = areaSchema.safeParse({
      home_id: 'a',
      name: 'k',
      icon: AREA_ICONS[0],
      color: AREA_COLORS[0],
      sort_order: 1.5,
      scope: 'location',
    });
    expect(r.success).toBe(false);
  });

  test('rejects negative sort_order', () => {
    const r = areaSchema.safeParse({
      home_id: 'a',
      name: 'k',
      icon: AREA_ICONS[0],
      color: AREA_COLORS[0],
      sort_order: -1,
      scope: 'location',
    });
    expect(r.success).toBe(false);
  });

  test('rejects unknown scope', () => {
    const r = areaSchema.safeParse({
      home_id: 'a',
      name: 'k',
      icon: AREA_ICONS[0],
      color: AREA_COLORS[0],
      sort_order: 0,
      scope: 'bogus',
    });
    expect(r.success).toBe(false);
  });

  test('rejects empty home_id', () => {
    const r = areaSchema.safeParse({
      home_id: '',
      name: 'k',
      icon: AREA_ICONS[0],
      color: AREA_COLORS[0],
      sort_order: 0,
      scope: 'location',
    });
    expect(r.success).toBe(false);
  });
});

describe('AREA palette', () => {
  test('has exactly 8 colors', () => {
    expect(AREA_COLORS.length).toBe(8);
  });

  test('all colors are #RRGGBB hex', () => {
    for (const c of AREA_COLORS) {
      expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  test('primary accent #D4A574 (D-18 anchor) is first', () => {
    expect(AREA_COLORS[0]).toBe('#D4A574');
  });

  test('has at least 24 icons', () => {
    expect(AREA_ICONS.length).toBeGreaterThanOrEqual(24);
  });
});
