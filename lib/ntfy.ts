// SPDX-License-Identifier: MIT
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep
/**
 * ntfy HTTP client — pure fetch wrapper (06-01 Task 2, D-03, NOTF-02).
 *
 * PURE module: no process.env reads, no module-level side effects. The
 * `url` is passed in by the caller (Wave 2's scheduler sources it from
 * `process.env.NTFY_URL` and pins the default to `https://ntfy.sh` at
 * that layer — this function itself is environment-agnostic and easy
 * to unit-test with `vi.stubGlobal('fetch', ...)`).
 *
 * Contract summary:
 *   - POST `${url}/${topic}` with plain-text body = msg.body.
 *   - Headers: Title (from msg.title), Priority (msg.priority ?? 3),
 *     Tags (msg.tags?.join(',') — OMITTED when empty/undefined).
 *   - 5s timeout via AbortController; any throw collapses to
 *     `{ok:false, error:'network'}`.
 *   - Non-2xx HTTP → `{ok:false, error:String(status)}`.
 *   - 2xx → `{ok:true}`.
 *   - Topic validated `^[A-Za-z0-9_-]{4,64}$` BEFORE fetch; invalid
 *     topic returns `{ok:false, error:'Invalid topic'}` without any
 *     network call.
 *   - NEVER propagates an exception. `console.warn` on failure with
 *     the error code ONLY — topic/title/body are NEVER logged
 *     (T-06-01-04 mitigation: ntfy_topic is a per-user secret and
 *     message bodies may contain task names / household PII).
 *
 * Why the topic regex is stricter than ntfy.sh accepts in practice:
 *   ntfy.sh accepts up to ~64 chars of URL-safe text. We enforce
 *   [A-Za-z0-9_-] only (no dots, no percent-encoded anything) as a
 *   defensive measure against topic-as-URL-injection (T-06-01-04).
 *   Future users wanting a topic like `alice.home` can switch to
 *   `alice-home` at no loss.
 */

export type NtfyPriority = 1 | 2 | 3 | 4 | 5;

export type NtfyMessage = {
  title: string;
  body: string;
  priority?: NtfyPriority;
  tags?: string[];
};

export type NtfyResult = { ok: true } | { ok: false; error: string };

const TOPIC_RE = /^[A-Za-z0-9_-]{4,64}$/;
const TIMEOUT_MS = 5000;

export async function sendNtfy(
  url: string,
  topic: string,
  msg: NtfyMessage,
): Promise<NtfyResult> {
  if (!TOPIC_RE.test(topic)) {
    return { ok: false, error: 'Invalid topic' };
  }

  const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  const targetUrl = `${cleanUrl}/${topic}`;

  const headers: Record<string, string> = {
    Title: msg.title,
    Priority: String(msg.priority ?? 3),
  };
  if (msg.tags && msg.tags.length > 0) {
    headers.Tags = msg.tags.join(',');
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: msg.body,
      signal: ac.signal,
    });
    if (res.ok) {
      return { ok: true };
    }
    const errCode = String(res.status);
    console.warn('[ntfy] send failed:', errCode);
    return { ok: false, error: errCode };
  } catch {
    // Network failure OR abort (timeout) — never propagate.
    // NOTE: do NOT log the topic, title, or body (T-06-01-04).
    console.warn('[ntfy] send failed:', 'network');
    return { ok: false, error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
