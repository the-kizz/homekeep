import { describe, it, expect, vi, afterEach } from 'vitest';

describe('/api/health GET', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns 200 with pocketbase:"ok" when PB responds 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', nextjs: 'ok', pocketbase: 'ok', pbCode: 200 });
  });

  it('returns 503 with pocketbase:"unhealthy" when PB responds 500', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'degraded', nextjs: 'ok', pocketbase: 'unhealthy', pbCode: 500 });
  });

  it('returns 503 with pocketbase:"unreachable" when fetch rejects', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'degraded', nextjs: 'ok', pocketbase: 'unreachable', pbCode: null });
  });
});
