import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock next/headers BEFORE importing the module under test. The executor uses
// vi.mock hoisting so `mockGet` is re-used across test cases via the factory.
const mockGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockGet })),
}));

describe('createServerClient', () => {
  beforeEach(() => {
    mockGet.mockReset();
    // Ensure module cache is cleared so each test gets a fresh import with
    // the mock applied. createServerClient has no module-level state anyway
    // (assertion in test 4) but this keeps the tests independent.
    vi.resetModules();
    // PocketBase's default LocalAuthStore persists auth to localStorage
    // under the 'pocketbase_auth' key. In jsdom the localStorage survives
    // between tests, so test N+1 would see the auth that test N loaded.
    // Clear it explicitly to simulate a fresh browser context per test.
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.clear();
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('returns PB client pointed at 127.0.0.1:8090 (loopback)', async () => {
    mockGet.mockReturnValue(undefined);
    const { createServerClient } = await import('@/lib/pocketbase-server');
    const pb = await createServerClient();
    expect((pb as any).baseURL ?? (pb as any).baseUrl).toBe('http://127.0.0.1:8090');
  });

  test('PB_URL env overrides the base URL', async () => {
    vi.stubEnv('PB_URL', 'http://pb.test:1234');
    mockGet.mockReturnValue(undefined);
    const { createServerClient } = await import('@/lib/pocketbase-server');
    const pb = await createServerClient();
    expect((pb as any).baseURL ?? (pb as any).baseUrl).toBe('http://pb.test:1234');
  });

  test('PB_URL trailing slash is trimmed', async () => {
    vi.stubEnv('PB_URL', 'http://pb.test:1234/');
    const { PB_URL } = await import('@/lib/constants');
    expect(PB_URL).toBe('http://pb.test:1234');
  });

  test('hydrates authStore when pb_auth cookie is present', async () => {
    // PB's exportToCookie writes a URL-encoded JSON string of {token, model}.
    // Reproduce that shape so loadFromCookie repopulates token + record.
    const rawJson = '{"token":"testtoken","model":{"id":"u1","collectionName":"users"}}';
    const encoded = encodeURIComponent(rawJson);
    mockGet.mockReturnValue({ value: encoded, name: 'pb_auth' });

    const { createServerClient } = await import('@/lib/pocketbase-server');
    const pb = await createServerClient();
    expect(pb.authStore.token).toBe('testtoken');
    expect(pb.authStore.record?.id).toBe('u1');
  });

  test('authStore is empty when no cookie', async () => {
    mockGet.mockReturnValue(undefined);
    const { createServerClient } = await import('@/lib/pocketbase-server');
    const pb = await createServerClient();
    expect(pb.authStore.token).toBe('');
    expect(pb.authStore.record).toBeNull();
  });

  test('each call returns a fresh client (no cross-request auth leakage)', async () => {
    mockGet.mockReturnValue(undefined);
    const { createServerClient } = await import('@/lib/pocketbase-server');
    const a = await createServerClient();
    const b = await createServerClient();
    expect(a).not.toBe(b);
  });
});
