import { describe, test, expect } from 'vitest';
import {
  loginSchema,
  signupSchema,
  resetRequestSchema,
  resetConfirmSchema,
} from '@/lib/schemas/auth';

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

  test('rejects password shorter than 8 chars', () => {
    const r = loginSchema.safeParse({ email: 'a@b.co', password: 'short' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('signupSchema', () => {
  test('accepts a full valid shape', () => {
    const r = signupSchema.safeParse({
      email: 'a@b.co',
      password: 'password123',
      passwordConfirm: 'password123',
      name: 'Alice',
    });
    expect(r.success).toBe(true);
  });

  test('rejects mismatched passwordConfirm under passwordConfirm path (Pitfall 12)', () => {
    const r = signupSchema.safeParse({
      email: 'a@b.co',
      password: 'abcdefgh',
      passwordConfirm: 'wrongpass',
      name: 'Alice',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      // The refine path: ['passwordConfirm'] is REQUIRED for this to land
      // under the passwordConfirm field rather than a bare '' key.
      expect(r.error.flatten().fieldErrors.passwordConfirm).toEqual(['Passwords do not match']);
    }
  });

  test('rejects missing name with fieldErrors.name', () => {
    const r = signupSchema.safeParse({
      email: 'a@b.co',
      password: 'password123',
      passwordConfirm: 'password123',
      name: '',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.name?.length ?? 0).toBeGreaterThan(0);
    }
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

describe('resetConfirmSchema', () => {
  test('accepts a valid token + matching passwords', () => {
    const r = resetConfirmSchema.safeParse({
      token: 'sometoken',
      password: 'abcdefgh',
      passwordConfirm: 'abcdefgh',
    });
    expect(r.success).toBe(true);
  });

  test('rejects mismatched passwords under passwordConfirm', () => {
    const r = resetConfirmSchema.safeParse({
      token: 'sometoken',
      password: 'abcdefgh',
      passwordConfirm: 'different',
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
