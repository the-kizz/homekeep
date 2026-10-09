import { test, expect } from '@playwright/test';

test('/api/health returns JSON with nextjs field', async ({ request }) => {
  const res = await request.get('/api/health');
  // Against `next start` only (no PB running), status will be 503 with pocketbase:"unreachable".
  // Against a full container (E2E_BASE_URL set), status will be 200 with pocketbase:"ok".
  expect([200, 503]).toContain(res.status());
  const body = await res.json();
  expect(body.nextjs).toBe('ok');
  expect(['ok', 'unhealthy', 'unreachable']).toContain(body.pocketbase);
});
