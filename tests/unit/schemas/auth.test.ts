import { describe, test, expect, afterEach, vi } from 'vitest';
import {
  loginSchema,
  signupSchema,
  resetRequestSchema,
  resetConfirmSchema,
} from '@/lib/schemas/auth';

/**
 * v1.2.1 PATCH2-05 — PASSWORD_POLICY env flag.
 *
 * Default policy is `simple` (8-char floor on signup/reset). Operators opt
 * into `strong` (12-char floor) by setting `NEXT_PUBLIC_PASSWORD_POLICY` or
 * `PASSWORD_POLICY`. Login schema always allows 8 for back-compat.
 *
 * Tests are split into default-simple and opt-in-strong blocks. `vi.stubEnv`
 * + `vi.unstubAllEnvs` in afterEach keeps the refined value per-test
 * deterministic without needing to reset modules (the schemas read
 * process.env at parse time, not at module load).
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loginSchema', () => {
  test('accepts a valid email + password', () => {
    const r = loginSchema.safeParse({ email: 'a@b.co', password: 'password123' });
    expect(r.success).toBe(true);
  });

  test('rejects invalid email with fieldErrors.email', () => {
    const r = loginSchema.safeParse({ email: 'not-an-email', password: 'password123' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.email?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test('rejects password shorter than 8 chars (login floor is always 8 for back-compat)', () => {
    const r = loginSchema.safeParse({ email: 'a@b.co', password: 'short' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test('login still allows 8-char under strong mode (pre-flip accounts keep access)', () => {
    vi.stubEnv('NEXT_PUBLIC_PASSWORD_POLICY', 'strong');
    const r = loginSchema.safeParse({ email: 'a@b.co', password: 'abcdefgh' });
    expect(r.success).toBe(true);
  });
});

describe('signupSchema (default: simple — 8-char floor)', () => {
  test('accepts a full valid shape (>= 8 char password under simple default)', () => {
    const r = signupSchema.safeParse({
      email: 'a@b.co',
      password: 'abcdefgh', // 8 chars — at the simple floor
      passwordConfirm: 'abcdefgh',
      name: 'Alice',
    });
    expect(r.success).toBe(true);
  });

  test('rejects 7-char password under simple mode', () => {
    const r = signupSchema.safeParse({
      email: 'a@b.co',
      password: 'abcdefg', // 7 chars
      passwordConfirm: 'abcdefg',
      name: 'Alice',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.password?.[0]).toMatch(/8/);
    }
  });

  test('rejects mismatched passwordConfirm under passwordConfirm path (Pitfall 12)', () => {
    const r = signupSchema.safeParse({
      email: 'a@b.co',
      password: 'abcdefgh', // 8 chars
      passwordConfirm: 'mnopqrst', // 8 chars, different
      name: 'Alice',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.passwordConfirm).toEqual(['Passwords do not match']);
    }
  });

  test('rejects missing name with fieldErrors.name', () => {
    const r = signupSchema.safeParse({
      email: 'a@b.co',
      password: 'abcdefgh',
      passwordConfirm: 'abcdefgh',
      name: '',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.name?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('signupSchema (strong mode — 12-char floor, Phase 23 SEC-06)', () => {
  test('rejects 8-char password', () => {
    vi.stubEnv('NEXT_PUBLIC_PASSWORD_POLICY', 'strong');
    const r = signupSchema.safeParse({
      email: 'a@b.co',
      password: 'abcdefgh', // 8 chars
      passwordConfirm: 'abcdefgh',
      name: 'Alice',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.password?.[0]).toMatch(/12/);
    }
  });

  test('rejects 11-char password (one short of the floor)', () => {
    vi.stubEnv('NEXT_PUBLIC_PASSWORD_POLICY', 'strong');
    const r = signupSchema.safeParse({
      email: 'a@b.co',
      password: 'elevenchars', // 11
      passwordConfirm: 'elevenchars',
      name: 'Alice',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.password?.[0]).toMatch(/12/);
    }
  });

  test('accepts exactly 12 chars (the strong-mode floor)', () => {
    vi.stubEnv('NEXT_PUBLIC_PASSWORD_POLICY', 'strong');
    const r = signupSchema.safeParse({
      email: 'a@b.co',
      password: 'twelvechars1', // 12
      passwordConfirm: 'twelvechars1',
      name: 'Alice',
    });
    expect(r.success).toBe(true);
  });

  test('server-only PASSWORD_POLICY (no NEXT_PUBLIC_ prefix) also activates strong mode', () => {
    vi.stubEnv('PASSWORD_POLICY', 'strong');
    const r = signupSchema.safeParse({
      email: 'a@b.co',
      password: 'abcdefgh', // 8 — would pass simple, fails strong
      passwordConfirm: 'abcdefgh',
      name: 'Alice',
    });
    expect(r.success).toBe(false);
  });
});

describe('resetRequestSchema', () => {
  test('accepts a valid email', () => {
    const r = resetRequestSchema.safeParse({ email: 'a@b.co' });
    expect(r.success).toBe(true);
  });

  test('rejects missing/empty email', () => {
    const r = resetRequestSchema.safeParse({ email: '' });
    expect(r.success).toBe(false);
  });
});

describe('resetConfirmSchema (default: simple — 8-char floor)', () => {
  test('accepts a valid token + matching 8-char passwords under simple default', () => {
    const r = resetConfirmSchema.safeParse({
      token: 'sometoken',
      password: 'abcdefgh', // 8 chars
      passwordConfirm: 'abcdefgh',
    });
    expect(r.success).toBe(true);
  });

  test('rejects 7-char password on reset-confirm under simple', () => {
    const r = resetConfirmSchema.safeParse({
      token: 'sometoken',
      password: 'abcdefg', // 7
      passwordConfirm: 'abcdefg',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.password?.[0]).toMatch(/8/);
    }
  });

  test('strong mode: rejects 8-char password on reset-confirm', () => {
    vi.stubEnv('NEXT_PUBLIC_PASSWORD_POLICY', 'strong');
    const r = resetConfirmSchema.safeParse({
      token: 'sometoken',
      password: 'abcdefgh', // 8
      passwordConfirm: 'abcdefgh',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.password?.[0]).toMatch(/12/);
    }
  });

  test('rejects mismatched passwords under passwordConfirm', () => {
    const r = resetConfirmSchema.safeParse({
      token: 'sometoken',
      password: 'abcdefgh', // 8
      passwordConfirm: 'ijklmnop', // 8, different
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.passwordConfirm).toEqual(['Passwords do not match']);
    }
  });

  test('rejects empty token', () => {
    const r = resetConfirmSchema.safeParse({
      token: '',
      password: 'abcdefgh',
      passwordConfirm: 'abcdefgh',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.token?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
