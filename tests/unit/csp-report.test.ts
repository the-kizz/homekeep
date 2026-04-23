// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/**
 * Phase 24 HDR-03 — CSP violation report endpoint tests.
 *
 * Contract checks:
 *   1. POST always returns 204 (even on malformed body / text() throw).
 *   2. Body is logged via console.log with the [CSP-REPORT] prefix.
 *   3. Oversized bodies (>4096 chars) are truncated in the log.
 *   4. Non-POST methods are not served (route exports only POST).
 */
describe('/api/csp-report POST', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('returns 204 No Content for a valid CSP report body', async () => {
    const { POST } = await import('@/app/api/csp-report/route');
    const body = JSON.stringify({
      'csp-report': {
        'violated-directive': 'script-src',
        'blocked-uri': 'https://evil.example.com/x.js',
      },
    });
    const req = new Request('http://localhost/api/csp-report', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/csp-report' },
    });
    const res = await POST(req);
    expect(res.status).toBe(204);
  });

  it('logs the body with [CSP-REPORT] prefix', async () => {
    const { POST } = await import('@/app/api/csp-report/route');
    const body = '{"csp-report":{"violated-directive":"test"}}';
    const req = new Request('http://localhost/api/csp-report', {
      method: 'POST',
      body,
    });
    await POST(req);
    expect(logSpy).toHaveBeenCalledWith('[CSP-REPORT]', body);
  });

  it('truncates bodies larger than 4096 chars in the log', async () => {
    const { POST } = await import('@/app/api/csp-report/route');
    const huge = 'x'.repeat(5000);
    const req = new Request('http://localhost/api/csp-report', {
      method: 'POST',
      body: huge,
    });
    const res = await POST(req);
    expect(res.status).toBe(204);
    expect(logSpy).toHaveBeenCalledWith('[CSP-REPORT]', 'x'.repeat(4096));
  });

  it('never throws — swallows req.text() rejection and still returns 204', async () => {
    const { POST } = await import('@/app/api/csp-report/route');
    // Fake Request whose text() rejects. The handler must swallow and 204.
    const brokenReq = {
      text: () => Promise.reject(new Error('stream broken')),
    } as unknown as Request;
    const res = await POST(brokenReq);
    expect(res.status).toBe(204);
    // No log line — the throw happens before body is read.
    expect(logSpy).not.toHaveBeenCalled();
  });
});
