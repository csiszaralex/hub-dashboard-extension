import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hangingFetch } from '../test/hangingFetch';
import { FetchTimeoutError, REQUEST_TIMEOUT_MS, fetchWithTimeout } from './fetchWithTimeout';

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

    await expect(fetchWithTimeout('https://api.example/a', json)).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with a timeout error once a request outlives its deadline', async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch));

    const result = fetchWithTimeout('https://api.example/calendars/someone%40example.com', json);
    const settled = expect(result).rejects.toBeInstanceOf(FetchTimeoutError);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    await settled;
    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    // Logged as-is by the call sites, so it names the host and nothing more.
    await expect(result).rejects.not.toThrow(/someone/);
  });

  it('holds the deadline while the body is still being read', async () => {
    // Headers arrive, then the body stalls: a deadline on the headers alone
    // would leave this waiting for as long as the browser lets it.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('')));
    const stalledRead = () => new Promise<never>(() => {});

    const result = fetchWithTimeout('https://api.example/a', stalledRead);
    const settled = expect(result).rejects.toBeInstanceOf(FetchTimeoutError);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

    await settled;
  });

  it('waits for the duration it is given, not the default', async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch));
    let done = false;

    fetchWithTimeout('https://api.example/a', json, { timeoutMs: REQUEST_TIMEOUT_MS * 2 }).catch(
      () => (done = true),
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 2 - 1);

    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('honours a signal of the caller, with the caller\'s reason', async () => {
    const fetchMock = vi.fn(hangingFetch);
    vi.stubGlobal('fetch', fetchMock);
    const caller = new AbortController();

    const result = fetchWithTimeout('https://api.example/a', json, { signal: caller.signal });
    caller.abort(new Error('caller gave up'));

    await expect(result).rejects.toThrow('caller gave up');
    // The request itself was cancelled, not just abandoned.
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
