import { describe, it, expect, vi, afterEach } from 'vitest';

describe('/api/health GET', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('probes the default loopback PocketBase when PB_URL is unset', async () => {
    vi.stubEnv('PB_URL', '');
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as any;
    const { GET } = await import('@/app/api/health/route');
    await GET();
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8090/api/health');
  });

  it('probes PB_URL when set', async () => {
    vi.stubEnv('PB_URL', 'http://pb.test:1234');
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as any;
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('http://pb.test:1234/api/health');
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
