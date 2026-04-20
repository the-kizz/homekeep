import { describe, it, expect, vi, afterEach } from 'vitest';

describe('lib/pocketbase createClient', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.resetModules();
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  });

  it('returns loopback PocketBase client when window is undefined (server context)', async () => {
    delete (globalThis as any).window;
    const { createClient } = await import('@/lib/pocketbase');
    const pb = createClient();
    expect((pb as any).baseURL ?? (pb as any).baseUrl).toBe('http://127.0.0.1:8090');
  });

  it('returns window.location.origin client when window exists (browser context)', async () => {
    (globalThis as any).window = { location: { origin: 'https://example.test' } } as any;
    const { createClient } = await import('@/lib/pocketbase');
    const pb = createClient();
    expect((pb as any).baseURL ?? (pb as any).baseUrl).toBe('https://example.test');
  });
});
