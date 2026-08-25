import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from './index';
import { HOURLY_UNSPLASH_BUDGET } from './background';
import { DEFAULT_POOL_KEY } from './tags';
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

let fetchMock: ReturnType<typeof vi.fn>;

const env = (kv: KVNamespace) => ({ UNSPLASH_CACHE: kv, UNSPLASH_ACCESS_KEY: 'test-key' });

const unsplashCalls = () =>
  fetchMock.mock.calls.filter(([input]) => String(input).startsWith('https://api.unsplash.com/photos/random'));

const downloadPings = () =>
  fetchMock.mock.calls.filter(([input]) => String(input).includes('/download'));

beforeEach(() => {
  fetchMock = vi.fn(async () => unsplashResponse());
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

/** Budget counter key for the current hour, mirroring the worker's own scheme. */
function budgetKey() {
  return `budget:${new Date().toISOString().slice(0, 13)}`;
}
