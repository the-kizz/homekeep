import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { sendNtfy } from '@/lib/ntfy';

/**
 * 06-01 Task 2 RED→GREEN: sendNtfy pure fetch wrapper (D-03, NOTF-02).
 *
 * Contract:
 *   - POST ${url}/${topic} with plain-text body = msg.body.
 *   - Headers: Title = msg.title, Priority = msg.priority ?? 3.
 *     Tags header omitted when tags array is empty or undefined.
 *   - 5-second timeout via AbortController.
 *   - NEVER throws — all errors collapse into {ok:false,error}.
 *   - Topic validated against /^[A-Za-z0-9_-]{4,64}$/ before fetch.
 *   - NEVER logs topic/title/body (T-06-01-04 info leakage) — only the
 *     raw error code on failure.
 */

const FIXED_URL = 'https://ntfy.sh';
const TOPIC = 'homekeep-alice';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('sendNtfy', () => {
  test('200 success → {ok: true}', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 200, statusText: 'OK' }),
    );
    const result = await sendNtfy(FIXED_URL, TOPIC, {
      title: 'Hello',
      body: 'World',
    });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('404 → {ok: false, error: "404"}', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const result = await sendNtfy(FIXED_URL, TOPIC, {
      title: 't',
      body: 'b',
    });
    expect(result).toEqual({ ok: false, error: '404' });
  });

  test('503 → {ok: false, error: "503"}', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const result = await sendNtfy(FIXED_URL, TOPIC, {
      title: 't',
      body: 'b',
    });
    expect(result).toEqual({ ok: false, error: '503' });
  });

  test('network throw → {ok: false, error: "network"}', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network failure'));
    const result = await sendNtfy(FIXED_URL, TOPIC, {
      title: 't',
      body: 'b',
    });
    expect(result).toEqual({ ok: false, error: 'network' });
  });

  test('5s timeout aborts → {ok: false, error: "network"}', async () => {
    vi.useFakeTimers();
    // Fetch that never resolves on its own but respects AbortSignal.
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const resultPromise = sendNtfy(FIXED_URL, TOPIC, {
      title: 't',
      body: 'b',
    });
    await vi.advanceTimersByTimeAsync(6000);
    const result = await resultPromise;
    expect(result).toEqual({ ok: false, error: 'network' });
  });

  test('invalid topic (3 chars) → {ok: false, error: "Invalid topic"}', async () => {
    const result = await sendNtfy(FIXED_URL, 'abc', { title: 't', body: 'b' });
    expect(result).toEqual({ ok: false, error: 'Invalid topic' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('invalid topic (contains slash) → rejected before fetch', async () => {
    const result = await sendNtfy(FIXED_URL, 'home/keep', {
      title: 't',
      body: 'b',
    });
    expect(result).toEqual({ ok: false, error: 'Invalid topic' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('invalid topic (65 chars) → rejected', async () => {
    const topic = 'a'.repeat(65);
    const result = await sendNtfy(FIXED_URL, topic, {
      title: 't',
      body: 'b',
    });
    expect(result).toEqual({ ok: false, error: 'Invalid topic' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('strips trailing slash on url — fetched URL is exactly ${url}/${topic}', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await sendNtfy('https://ntfy.sh/', TOPIC, {
      title: 't',
      body: 'b',
    });
    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://ntfy.sh/homekeep-alice');
  });

  test('omits Tags header when tags array is empty', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await sendNtfy(FIXED_URL, TOPIC, {
      title: 't',
      body: 'b',
      tags: [],
    });
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers.Tags).toBeUndefined();
  });

  test('sets Tags header when tags array is non-empty (comma-joined)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await sendNtfy(FIXED_URL, TOPIC, {
      title: 't',
      body: 'b',
      tags: ['clean', 'home'],
    });
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers.Tags).toBe('clean,home');
  });

  test('Priority defaults to 3 when omitted', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await sendNtfy(FIXED_URL, TOPIC, { title: 't', body: 'b' });
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers.Priority).toBe('3');
  });

  test('Title header carries msg.title', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await sendNtfy(FIXED_URL, TOPIC, {
      title: 'Kitchen ready',
      body: 'Wipe benches',
    });
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers.Title).toBe('Kitchen ready');
  });

  test('Body is msg.body as plain text', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await sendNtfy(FIXED_URL, TOPIC, {
      title: 't',
      body: 'Hello world',
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe('Hello world');
    expect(init.method).toBe('POST');
  });
});
