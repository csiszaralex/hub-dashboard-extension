import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import app from './index';
import { HOURLY_UNSPLASH_BUDGET, lowQuotaKey, UNSPLASH_RESERVE } from './background';
import { UPSTREAM_TIMEOUT_MS } from './fetchWithTimeout';
import { DEFAULT_POOL_KEY, LAST_GOOD_DEFAULT_POOL_KEY } from './tags';
import { hangingFetch } from './test/hangingFetch';
import { createKvStub } from './test/kvStub';

/** Workers hand the request an ExecutionContext; `waitUntil` keeps background work alive. */
const executionCtx = (): ExecutionContext =>
  ({ waitUntil: () => {}, passThroughOnException: () => {} }) as unknown as ExecutionContext;

const photo = (id: string) => ({
  id,
  urls: { raw: `https://images.unsplash.com/photo-${id}` },
  links: {
    html: `https://unsplash.com/photos/${id}`,
    download_location: `https://api.unsplash.com/photos/${id}/download`,
  },
  user: { name: `Photographer ${id}`, links: { html: `https://unsplash.com/@user-${id}` } },
  location: { name: 'Dolomites, Italy' },
});

const unsplashResponse = (count = 3) =>
  new Response(JSON.stringify(Array.from({ length: count }, (_, i) => photo(String(i)))), {
    headers: { 'Content-Type': 'application/json' },
  });

// Typed as `fetch`, so an async implementation is checked against what it
// stands in for instead of an untyped mock.
let fetchMock: Mock<typeof fetch>;

const env = (kv: KVNamespace) => ({ UNSPLASH_CACHE: kv, UNSPLASH_ACCESS_KEY: 'test-key' });

const unsplashCalls = () =>
  fetchMock.mock.calls.filter(([input]) => String(input).startsWith('https://api.unsplash.com/photos/random'));

const downloadPings = () =>
  fetchMock.mock.calls.filter(([input]) => String(input).includes('/download'));

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(async () => unsplashResponse());
  vi.stubGlobal('fetch', fetchMock);
});

describe('GET /api/background', () => {
  it('treats differently written but equivalent tag lists as one cache entry', async () => {
    const { kv, keys } = createKvStub();

    await app.request('/api/background?tags=Forest%20,%20MOUNTAIN', {}, env(kv), executionCtx());
    await app.request('/api/background?tags=mountain,forest', {}, env(kv), executionCtx());

    expect(unsplashCalls()).toHaveLength(1);
    expect(keys().filter((k) => k.startsWith('pool:'))).toHaveLength(1);
  });

  it('caps the number of tags so the cache key space stays bounded', async () => {
    const { kv, keys } = createKvStub();

    await app.request('/api/background?tags=a,b,c,d,e,f,g,h,i,j,k,l', {}, env(kv), executionCtx());

    const poolKey = keys().find((k) => k.startsWith('pool:'))!;
    expect(poolKey.replace('pool:', '').split(',')).toHaveLength(5);
  });

  it('drops characters that cannot appear in a search term', async () => {
    const { kv, keys } = createKvStub();

    await app.request('/api/background?tags=for%C3%A9st%3Cscript%3E,%20mount%40in', {}, env(kv), executionCtx());

    const poolKey = keys().find((k) => k.startsWith('pool:'))!;
    expect(poolKey).not.toContain('<');
    expect(poolKey).not.toContain('@');
  });

  it('reuses the default pool when the given tags normalise to nothing', async () => {
    const { kv, keys } = createKvStub();

    await app.request('/api/background?tags=%40%40%40', {}, env(kv), executionCtx());

    expect(keys().filter((k) => k.startsWith('pool:'))).toEqual([DEFAULT_POOL_KEY]);
  });

  it('stops calling Unsplash once the hourly budget is spent', async () => {
    const { kv, seed } = createKvStub();
    seed(DEFAULT_POOL_KEY, [
      {
        url: 'https://images.unsplash.com/cached',
        location: null,
        photographer: 'Cached',
        photographerUrl: 'https://unsplash.com/@cached',
      },
    ]);
    seed(budgetKey(), '9999');

    const res = await app.request('/api/background?tags=unseen-tag', {}, env(kv), executionCtx());

    expect(unsplashCalls()).toHaveLength(0);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ photographer: 'Cached' });
  });

  it('allows the last call inside the budget and refuses the one after it', async () => {
    // Pins the boundary rather than the number, so raising the budget stays a
    // one-line change. The `>=` is the whole guard: as `>` the counter would
    // permit one call past the cap every hour, which is invisible until an
    // account near its limit starts getting rejected by Unsplash instead.
    const lastAllowed = createKvStub();
    lastAllowed.seed(budgetKey(), String(HOURLY_UNSPLASH_BUDGET - 1));

    await app.request('/api/background?tags=one', {}, env(lastAllowed.kv), executionCtx());
    expect(unsplashCalls()).toHaveLength(1);

    const spent = createKvStub();
    spent.seed(budgetKey(), String(HOURLY_UNSPLASH_BUDGET));
    spent.seed(DEFAULT_POOL_KEY, [
      {
        url: 'https://images.unsplash.com/cached',
        location: null,
        photographer: 'Cached',
        photographerUrl: 'https://unsplash.com/@cached',
      },
    ]);

    await app.request('/api/background?tags=two', {}, env(spent.kv), executionCtx());
    expect(unsplashCalls()).toHaveLength(1);
  });

  it('links the photographer profile with Unsplash referral parameters', async () => {
    const { kv } = createKvStub();

    const res = await app.request('/api/background?tags=forest', {}, env(kv), executionCtx());
    const body = (await res.json()) as { photographerUrl: string };

    expect(body.photographerUrl).toContain('/@user-');
    expect(body.photographerUrl).toContain('utm_source=hub');
    expect(body.photographerUrl).toContain('utm_medium=referral');
  });

  it('reports the download to Unsplash when a photo is handed out', async () => {
    const { kv } = createKvStub();

    await app.request('/api/background?tags=forest', {}, env(kv), executionCtx());

    expect(downloadPings()).toHaveLength(1);
  });

  describe('the account quota the download pings spend', () => {
    /** Keeps what `waitUntil` was handed, so a test can wait for the ping. */
    const trackingCtx = () => {
      const pending: Promise<unknown>[] = [];
      const ctx = {
        waitUntil: (p: Promise<unknown>) => void pending.push(p),
        passThroughOnException: () => {},
      } as unknown as ExecutionContext;
      return { ctx, drain: () => Promise.all(pending) };
    };

    /** Unsplash's answers, each carrying the account's remaining calls. */
    const answerWithRemaining = (remaining: number) =>
      fetchMock.mockImplementation(async (input) => {
        const headers = { 'X-Ratelimit-Remaining': String(remaining) };
        return String(input).includes('/download')
          ? new Response('{}', { headers })
          : new Response(await unsplashResponse().text(), { headers });
      });

    const cachedDefault = [
      {
        url: 'https://images.unsplash.com/cached',
        location: null,
        photographer: 'Cached',
        photographerUrl: 'https://unsplash.com/@cached',
        downloadLocation: 'https://api.unsplash.com/photos/cached/download',
      },
    ];

    it('stops fetching pools once a ping reports the hour nearly spent', async () => {
      const { kv, seed } = createKvStub();
      seed(DEFAULT_POOL_KEY, cachedDefault);
      answerWithRemaining(UNSPLASH_RESERVE - 1);
      const first = trackingCtx();

      await app.request('/api/background', {}, env(kv), first.ctx);
      await first.drain();
      const before = unsplashCalls().length;
      const res = await app.request('/api/background?tags=unseen', {}, env(kv), executionCtx());

      expect(unsplashCalls()).toHaveLength(before);
      await expect(res.json()).resolves.toMatchObject({ photographer: 'Cached' });
      // The ping itself is never held back: the guidelines require one per photo.
      expect(downloadPings()).toHaveLength(2);
    });

    it('keeps fetching while the reported remainder is at the reserve', async () => {
      // Pins the boundary: `<` is the whole guard.
      const { kv, seed } = createKvStub();
      seed(DEFAULT_POOL_KEY, cachedDefault);
      answerWithRemaining(UNSPLASH_RESERVE);
      const first = trackingCtx();

      await app.request('/api/background', {}, env(kv), first.ctx);
      await first.drain();
      const before = unsplashCalls().length;
      await app.request('/api/background?tags=unseen', {}, env(kv), executionCtx());

      expect(unsplashCalls()).toHaveLength(before + 1);
    });

    it('takes the remainder from a pool fetch as well', async () => {
      const { kv } = createKvStub();
      answerWithRemaining(UNSPLASH_RESERVE - 1);

      await app.request('/api/background?tags=one', {}, env(kv), executionCtx());
      await app.request('/api/background?tags=two', {}, env(kv), executionCtx());

      expect(unsplashCalls()).toHaveLength(1);
    });

    it('writes nothing to KV for a response with room to spare', async () => {
      // A write per photo handed out is what the header approach avoids.
      const { kv, seed, keys } = createKvStub();
      seed(DEFAULT_POOL_KEY, cachedDefault);
      answerWithRemaining(900);
      const first = trackingCtx();

      await app.request('/api/background', {}, env(kv), first.ctx);
      await first.drain();

      expect(keys().filter((k) => k === lowQuotaKey())).toEqual([]);
    });
  });

  it('serves the default pool when Unsplash accepts the request and never answers', async () => {
    // No error ever arrives from a hung upstream, so without a deadline the
    // fallback below the fetch is unreachable and the new tab just waits.
    vi.useFakeTimers();
    try {
      const { kv, seed } = createKvStub();
      seed(DEFAULT_POOL_KEY, [
        {
          url: 'https://images.unsplash.com/cached',
          location: null,
          photographer: 'Cached',
          photographerUrl: 'https://unsplash.com/@cached',
        },
      ]);
      fetchMock.mockImplementation(hangingFetch);

      const pending = app.request('/api/background?tags=unseen-tag', {}, env(kv), executionCtx());
      await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS);
      const res = await pending;

      expect(unsplashCalls()).toHaveLength(1);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ photographer: 'Cached' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never leaks internal pool fields to the client', async () => {
    const { kv } = createKvStub();

    const res = await app.request('/api/background?tags=forest', {}, env(kv), executionCtx());

    expect(Object.keys((await res.json()) as object).sort()).toEqual([
      'location',
      'photographer',
      'photographerUrl',
      'url',
    ]);
  });
});

describe('GET /api/background fallback layers', () => {
  const lastGoodPhoto = {
    url: 'https://images.unsplash.com/last-good',
    location: null,
    photographer: 'Last good',
    photographerUrl: 'https://unsplash.com/@last-good',
  };

  const bundledPhoto = {
    url: 'https://images.unsplash.com/bundled',
    location: null,
    photographer: 'Bundled',
    photographerUrl: 'https://unsplash.com/@bundled',
  };

  const unsplashDown = () => new Response('unavailable', { status: 503 });

  /**
   * `BUNDLED_POOL` ships empty until real attribution data is supplied, so the
   * tests that need that layer give it one entry through a module mock.
   */
  const appWithBundledPool = async (pool: unknown[]) => {
    vi.resetModules();
    vi.doMock('./bundledPool', () => ({ BUNDLED_POOL: pool }));
    try {
      return (await import('./index')).default;
    } finally {
      vi.doUnmock('./bundledPool');
    }
  };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('serves the bundled pool instead of a 500 when every KV read fails', async () => {
    const { kv, failGets } = createKvStub();
    failGets();
    const withBundle = await appWithBundledPool([bundledPhoto]);

    const res = await withBundle.request('/api/background?tags=forest', {}, env(kv), executionCtx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ photographer: 'Bundled' });
  });

  it('does not call Unsplash when the budget counter cannot be read', async () => {
    const { kv, seed, failGets } = createKvStub();
    seed(LAST_GOOD_DEFAULT_POOL_KEY, [lastGoodPhoto]);
    failGets((key) => key.startsWith('budget:'));

    const res = await app.request('/api/background?tags=forest', {}, env(kv), executionCtx());

    expect(unsplashCalls()).toHaveLength(0);
    expect(res.status).toBe(200);
  });

  it('does not call Unsplash when the budget counter cannot be written', async () => {
    // Real KV allows one write per key per second and answers a second with a
    // 429, so a burst on the hour's counter is a realistic way to get here.
    const { kv, seed, failPuts } = createKvStub();
    seed(LAST_GOOD_DEFAULT_POOL_KEY, [lastGoodPhoto]);
    failPuts((key) => key.startsWith('budget:'));

    await app.request('/api/background?tags=forest', {}, env(kv), executionCtx());

    expect(unsplashCalls()).toHaveLength(0);
  });

  it('still serves a freshly fetched pool when caching it fails', async () => {
    const { kv, failPuts } = createKvStub();
    failPuts((key) => key.startsWith('pool:'));

    const res = await app.request('/api/background?tags=forest', {}, env(kv), executionCtx());

    expect(unsplashCalls()).toHaveLength(1);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ photographer: expect.stringMatching(/^Photographer /) });
  });

  it('keeps a copy of the default pool that does not expire', async () => {
    const { kv, read, ttlOf } = createKvStub();

    await app.request('/api/background', {}, env(kv), executionCtx());

    expect(read(LAST_GOOD_DEFAULT_POOL_KEY)).toBe(read(DEFAULT_POOL_KEY));
    expect(ttlOf(LAST_GOOD_DEFAULT_POOL_KEY)).toBeUndefined();
    expect(ttlOf(DEFAULT_POOL_KEY)).toBeGreaterThan(0);
  });

  it('does not copy a pool for other tags into the last good default', async () => {
    const { kv, read } = createKvStub();

    await app.request('/api/background?tags=forest', {}, env(kv), executionCtx());

    expect(read(LAST_GOOD_DEFAULT_POOL_KEY)).toBeUndefined();
  });

  it('serves the last good default pool when the default pool expired and Unsplash is down', async () => {
    const { kv, seed } = createKvStub();
    seed(LAST_GOOD_DEFAULT_POOL_KEY, [lastGoodPhoto]);
    fetchMock.mockImplementation(async () => unsplashDown());

    const res = await app.request('/api/background', {}, env(kv), executionCtx());

    expect(unsplashCalls()).toHaveLength(1);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ photographer: 'Last good' });
  });

  it('prefers the default pool over the last good copy', async () => {
    const { kv, seed } = createKvStub();
    seed(DEFAULT_POOL_KEY, [
      { url: 'https://images.unsplash.com/cached', location: null, photographer: 'Cached', photographerUrl: 'https://unsplash.com/@cached' },
    ]);
    seed(LAST_GOOD_DEFAULT_POOL_KEY, [lastGoodPhoto]);
    fetchMock.mockImplementation(async () => unsplashDown());

    const res = await app.request('/api/background?tags=unseen', {}, env(kv), executionCtx());

    await expect(res.json()).resolves.toMatchObject({ photographer: 'Cached' });
  });

  it('serves the bundled pool when both default layers are missing and Unsplash is down', async () => {
    const { kv } = createKvStub();
    fetchMock.mockImplementation(async () => unsplashDown());
    const withBundle = await appWithBundledPool([bundledPhoto]);

    const res = await withBundle.request('/api/background', {}, env(kv), executionCtx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ photographer: 'Bundled' });
  });

  it('answers 503 when every layer is empty', async () => {
    const { kv } = createKvStub();
    fetchMock.mockImplementation(async () => unsplashDown());
    const withoutBundle = await appWithBundledPool([]);

    const res = await withoutBundle.request('/api/background', {}, env(kv), executionCtx());
    const health = await withoutBundle.request('/api/health', {}, env(kv));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'No background available' });
    expect(health.status).toBe(503);
  });

  it('logs a KV failure without the request tags', async () => {
    const { kv, failGets } = createKvStub();
    failGets();

    await app.request('/api/background?tags=private-tag', {}, env(kv), executionCtx());

    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('KV unavailable');
    expect(logged).not.toContain('private-tag');
  });

  it.each([
    ['an object instead of a list', { errors: ['Rate Limit Exceeded'] }],
    ['an empty list', []],
    ['photos without an https image URL', [{ ...photo('1'), urls: { raw: 'http://images.unsplash.com/x' } }, { ...photo('2'), urls: {} }]],
    ['photos without a photographer', [{ ...photo('1'), user: { links: { html: 'https://unsplash.com/@x' } } }]],
    ['photos without a profile link', [{ ...photo('1'), user: { name: 'Someone', links: {} }, links: {} }]],
  ])('does not cache a 200 from Unsplash carrying %s', async (_label, body) => {
    const { kv, keys, seed } = createKvStub();
    seed(LAST_GOOD_DEFAULT_POOL_KEY, [lastGoodPhoto]);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(body)));

    const res = await app.request('/api/background?tags=forest', {}, env(kv), executionCtx());

    expect(keys().filter((k) => k.startsWith('pool:'))).toEqual([]);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ photographer: 'Last good' });
  });

  it('drops only the unusable photos from an otherwise good response', async () => {
    const { kv, read } = createKvStub();
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify([photo('good'), { ...photo('bad'), urls: { raw: 'javascript:alert(1)' } }])),
    );

    await app.request('/api/background?tags=forest', {}, env(kv), executionCtx());

    const cached = JSON.parse(read('pool:forest')!) as { url: string }[];
    expect(cached.map((p) => p.url)).toEqual([expect.stringContaining('photo-good')]);
  });
});

/** Budget counter key for the current hour, mirroring the worker's own scheme. */
function budgetKey() {
  return `budget:${new Date().toISOString().slice(0, 13)}`;
}
