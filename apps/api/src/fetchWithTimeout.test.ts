import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchTimeoutError, UPSTREAM_TIMEOUT_MS, fetchWithTimeout } from './fetchWithTimeout';
import { hangingFetch } from './test/hangingFetch';

const json = async (res: Response) => res.json();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchWithTimeout', () => {
  it('returns what the reader made of a response, and leaves no timer behind', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}')));

    await expect(fetchWithTimeout('https://upstream.example/a', json)).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with a timeout error once a request outlives its deadline', async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch));

    const result = fetchWithTimeout('https://upstream.example/a?j=secret', json);
    const settled = expect(result).rejects.toBeInstanceOf(FetchTimeoutError);
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS);

    await settled;
    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    // Logged as-is by the routes, so it must not carry a query-string credential.
    await expect(result).rejects.not.toThrow(/secret/);
  });

  it('holds the deadline while the body is still being read', async () => {
    // Headers arrive, then the body stalls: a deadline on the headers alone
    // would leave this waiting for as long as the platform lets it.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('')));
    const stalledRead = () => new Promise<never>(() => {});

    const result = fetchWithTimeout('https://upstream.example/a', stalledRead);
    const settled = expect(result).rejects.toBeInstanceOf(FetchTimeoutError);
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS);

    await settled;
  });

  it('does not give up early', async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch));
    let done = false;

    fetchWithTimeout('https://upstream.example/a', json).catch(() => (done = true));
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS - 1);

    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('honours a signal of the caller, with the caller\'s reason', async () => {
    const fetchMock = vi.fn(hangingFetch);
    vi.stubGlobal('fetch', fetchMock);
    const caller = new AbortController();

    const result = fetchWithTimeout('https://upstream.example/a', json, { signal: caller.signal });
    caller.abort(new Error('caller gave up'));

    await expect(result).rejects.toThrow('caller gave up');
    // The request itself was cancelled, not just abandoned.
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
