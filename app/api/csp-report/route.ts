// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Phase 24 HDR-03 — CSP violation report sink.
 *
 * Browsers POST a violation body here whenever the Report-Only CSP catches
 * a source that would have been blocked in enforced mode. Purpose: collect
 * a 30-day violation corpus before flipping `Content-Security-Policy-Report-Only`
 * → `Content-Security-Policy` in Phase 28 (D-02).
 *
 * Contract (D-11, D-12):
 *   - POST returns 204 No Content, always. Never 500; never propagates a throw.
 *   - Body logged to stdout with `[CSP-REPORT]` prefix, capped at 4096 chars
 *     so a malicious oversized report cannot flood logs.
 *   - No DB write. No PII persisted. No downstream call.
 *   - No rate limit in-app; if abuse surfaces, Caddy can bucket `/api/csp-report`.
 *
 * Why text() instead of json(): CSP reports are sent with content-type
 * `application/csp-report` which is NOT `application/json`; Next's req.json()
 * would throw on parse. Raw text is also cheaper and we never introspect
 * the body — it just needs to land in the log stream.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.text();
    // Cap before logging — protects log infrastructure from oversized reports.
    console.log('[CSP-REPORT]', body.slice(0, 4096));
  } catch {
    // Swallow everything. This endpoint must NEVER 500, or browsers will
    // stop sending reports and we lose the violation telemetry.
  }
  return new Response(null, { status: 204 });
}
