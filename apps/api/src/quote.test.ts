import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from './index';
import { quoteCacheKey } from './quote';
import { createKvStub } from './test/kvStub';

const upstream = (text: string, author: string) =>
  new Response(JSON.stringify({ data: { quote: text, author } }), {
    headers: { 'Content-Type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

const env = (kv: KVNamespace) => ({ UNSPLASH_CACHE: kv, UNSPLASH_ACCESS_KEY: 'test-key' });

/**
 * `createKvStub` has no way to simulate a KV outage — its `get`/`put` never
 * reject. These wrap a working stub so one method throws, which is the only
 * way to exercise the route's own KV-failure handling rather than KV's.
 */
const withFailingGet = (kv: KVNamespace): KVNamespace =>
  ({
    ...kv,
    get: vi.fn(async () => {
      throw new Error('KV unavailable');
    }),
  }) as unknown as KVNamespace;

const withFailingPut = (kv: KVNamespace): KVNamespace =>
  ({
    ...kv,
    put: vi.fn(async () => {
      throw new Error('KV unavailable');
    }),
  }) as unknown as KVNamespace;

beforeEach(() => {
  fetchMock = vi.fn(async () => upstream('Waste no more time arguing.', 'Marcus Aurelius'));
  vi.stubGlobal('fetch', fetchMock);
});

describe('GET /api/quote', () => {
  it('returns the upstream quote', async () => {
    const { kv } = createKvStub();

    const res = await app.request('/api/quote', {}, env(kv));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      text: 'Waste no more time arguing.',
      author: 'Marcus Aurelius',
    });
  });

  it('does not re-hit the upstream for sequential callers once the day cache is populated', async () => {
    // Sequential, not concurrent: each `await` lets the previous call finish
    // writing the day-cache entry before the next one reads it. This proves
    // reuse across separate requests, not coalescing of simultaneous ones —
    // see the concurrency test below for what actually happens when callers
    // overlap.
    const { kv } = createKvStub();

    await app.request('/api/quote', {}, env(kv));
    await app.request('/api/quote', {}, env(kv));
    await app.request('/api/quote', {}, env(kv));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('has no request coalescing: concurrent callers before the day cache is populated each hit the upstream independently', async () => {
    // This pins the check-then-act race documented at the read site in
    // quote.ts, rather than a guarantee — it demonstrates the actual,
    // observed behaviour of the stub under concurrency, not a claim that
    // Cloudflare KV would interleave identically. Three callers fire before
    // any of them has written the day-cache key, so all three read a miss
    // and all three call upstream.
    const { kv } = createKvStub();

    await Promise.all([
      app.request('/api/quote', {}, env(kv)),
      app.request('/api/quote', {}, env(kv)),
      app.request('/api/quote', {}, env(kv)),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keys the day cache by date', () => {
    expect(quoteCacheKey('2026-07-30')).toBe('quote:2026-07-30');
  });

  it('serves the last good quote when the upstream is down', async () => {
    const { kv, seed } = createKvStub();
    seed('quote:latest', { text: 'Old but present.', author: 'Seneca' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const res = await app.request('/api/quote', {}, env(kv));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ text: 'Old but present.', author: 'Seneca' });
  });

  it('reports unavailable when the upstream is down and nothing is cached', async () => {
    const { kv } = createKvStub();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect((await app.request('/api/quote', {}, env(kv))).status).toBe(503);
  });

  it('rejects an upstream response that is missing the quote text', async () => {
    const { kv } = createKvStub();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: {} }), { headers: { 'Content-Type': 'application/json' } })),
    );

    expect((await app.request('/api/quote', {}, env(kv))).status).toBe(503);
  });

  it('falls back to the last good quote when the upstream returns a non-200 status', async () => {
    const { kv, seed } = createKvStub();
    seed('quote:latest', { text: 'Old but present.', author: 'Seneca' });
    // The body is well-formed and would parse fine — only the status is bad —
    // so this fails only if the route stops checking `res.ok`.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { quote: 'Should be ignored', author: 'Nobody' } }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    const res = await app.request('/api/quote', {}, env(kv));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ text: 'Old but present.', author: 'Seneca' });
  });

  it('falls back to the last good quote when the upstream body is not valid JSON', async () => {
    const { kv, seed } = createKvStub();
    seed('quote:latest', { text: 'Old but present.', author: 'Seneca' });
    // A real Response whose .json() rejects, rather than a mocked resolution,
    // so the route's own try/catch — not a stubbed method — is what's under test.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { headers: { 'Content-Type': 'application/json' } })),
    );

    const res = await app.request('/api/quote', {}, env(kv));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ text: 'Old but present.', author: 'Seneca' });
  });

  it('still fetches from upstream on the first request of a new day even when a stale quote:latest exists', async () => {
    const { kv, seed } = createKvStub();
    seed('quote:latest', { text: 'Yesterday.', author: 'Someone' });

    const res = await app.request('/api/quote', {}, env(kv));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({
      text: 'Waste no more time arguing.',
      author: 'Marcus Aurelius',
    });
  });

  it('falls through to upstream — not a 500 — when the day-cache read itself fails', async () => {
    const { kv } = createKvStub();

    const res = await app.request('/api/quote', {}, env(withFailingGet(kv)));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      text: 'Waste no more time arguing.',
      author: 'Marcus Aurelius',
    });
  });

  it('reports unavailable — not a 500 — when the upstream is down and the quote:latest read also fails', async () => {
    const { kv } = createKvStub();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const res = await app.request('/api/quote', {}, env(withFailingGet(kv)));

    expect(res.status).toBe(503);
  });

  it('returns the freshly fetched quote even when caching it fails, rather than degrading to stale or 503', async () => {
    const { kv, seed } = createKvStub();
    // Seeded so that a bug which routes a put failure into the stale-fallback
    // path would return this instead of the fresh quote — a silent downgrade
    // this test is specifically shaped to catch.
    seed('quote:latest', { text: 'Old but present.', author: 'Seneca' });

    const res = await app.request('/api/quote', {}, env(withFailingPut(kv)));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      text: 'Waste no more time arguing.',
      author: 'Marcus Aurelius',
    });
  });
});
