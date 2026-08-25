import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from './index';
import { quoteCacheKey, quoteLatestKey } from './quote';
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
    expect(quoteCacheKey('stoic', 'en', '2026-07-30')).toBe('quote:stoic:en:2026-07-30');
  });

  it('serves the last good quote when the upstream is down', async () => {
    const { kv, seed } = createKvStub();
    seed(quoteLatestKey('stoic', 'en'), { text: 'Old but present.', author: 'Seneca' });
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
    seed(quoteLatestKey('stoic', 'en'), { text: 'Old but present.', author: 'Seneca' });
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
    seed(quoteLatestKey('stoic', 'en'), { text: 'Old but present.', author: 'Seneca' });
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

  it('still fetches from upstream on the first request of a new day even when a stale per-source stale quote exists', async () => {
    const { kv, seed } = createKvStub();
    seed(quoteLatestKey('stoic', 'en'), { text: 'Yesterday.', author: 'Someone' });

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

  it('reports unavailable — not a 500 — when the upstream is down and the stale-quote read also fails', async () => {
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
    seed(quoteLatestKey('stoic', 'en'), { text: 'Old but present.', author: 'Seneca' });

    const res = await app.request('/api/quote', {}, env(withFailingPut(kv)));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      text: 'Waste no more time arguing.',
      author: 'Marcus Aurelius',
    });
  });
});

describe('quote sources', () => {
  it('serves the stoic source when none is asked for', async () => {
    // Backwards compatibility: extensions in the wild send no `source` at all.
    const { kv } = createKvStub();

    const res = await app.request('/api/quote', {}, env(kv));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({ author: 'Marcus Aurelius' });
  });

  it('falls back to the default source rather than inventing a cache key', async () => {
    // The endpoint is public and unauthenticated. If the source reached the KV
    // key unchecked, `?source=<anything>` would be a way to grow the key space
    // without bound — the same hole `tags.ts` closes for backgrounds.
    const { kv, keys } = createKvStub();

    await app.request('/api/quote?source=not-a-source', {}, env(kv));

    expect(keys().some((k) => k.includes('not-a-source'))).toBe(false);
  });

  it('keeps each source and language in its own cache entry', async () => {
    // Without this two sources would hand each other's quote to users for the
    // rest of the day, whichever one happened to be asked for first.
    const { kv, keys } = createKvStub();

    await app.request('/api/quote', {}, env(kv));
    await app.request('/api/quote?source=programming&lang=en', {}, env(kv));

    const dayKeys = keys().filter((k) => k.startsWith('quote:') && !k.endsWith(':latest'));
    expect(new Set(dayKeys).size).toBe(2);
  });

  it('serves a built-in source without going upstream at all', async () => {
    const { kv } = createKvStub();

    const res = await app.request('/api/quote?source=programming&lang=en', {}, env(kv));

    expect(fetchMock).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ text: expect.any(String) });
  });

  it('lists the sources and the languages each one can actually serve', async () => {
    const res = await app.request('/api/quote/sources', {}, env(createKvStub().kv));

    const body = (await res.json()) as { id: string; languages: string[] }[];
    expect(body.map((s) => s.id)).toContain('stoic');
    expect(body.find((s) => s.id === 'stoic')?.languages).toEqual(['en']);
    // A source must not advertise a language it has no quotes for — the popup
    // builds its dropdown from this and would offer an empty option.
    for (const source of body) expect(source.languages.length).toBeGreaterThan(0);
  });

  it('gives a built-in source in the language asked for', async () => {
    const { kv } = createKvStub();

    const en = await app.request('/api/quote?source=programming&lang=en', {}, env(kv));
    const hu = await app.request('/api/quote?source=programming&lang=hu', {}, env(kv));

    const [a, b] = [await en.json(), await hu.json()];
    expect((a as { text: string }).text).not.toBe((b as { text: string }).text);
  });
});

const withCitatum = (kv: KVNamespace) => ({
  ...env(kv),
  CITATUM_USER: 'tesztfelhasznalo',
  CITATUM_KEY: 'tesztkod',
});

const citatumXml = (text: string, author: string, url = 'https://www.citatum.hu/idezet/1') =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><idezetek><idezet><idezetszoveg>${text}</idezetszoveg><szerzo>${author}</szerzo><url>${url}</url></idezet></idezetek>`,
  );

describe('citatum source', () => {
  it('is not offered when the deployment has no credentials for it', async () => {
    // Better than advertising it and failing every request: the popup builds
    // its picker from this list, so an unconfigured worker offers one fewer
    // option rather than one that never works.
    const res = await app.request('/api/quote/sources', {}, env(createKvStub().kv));

    const body = (await res.json()) as { id: string }[];
    expect(body.map((s) => s.id)).not.toContain('citatum');
  });

  it('is offered once the credentials are present', async () => {
    const res = await app.request('/api/quote/sources', {}, withCitatum(createKvStub().kv));

    const body = (await res.json()) as { id: string; languages: string[] }[];
    expect(body.find((s) => s.id === 'citatum')?.languages).toEqual(['hu']);
  });

  it('falls back to the default source when asked for without credentials', async () => {
    const { kv, keys } = createKvStub();

    await app.request('/api/quote?source=citatum&lang=hu', {}, env(kv));

    expect(keys().some((k) => k.includes('citatum'))).toBe(false);
  });

  it('sends the normalised category upstream and returns the quote with its link', async () => {
    const { kv } = createKvStub();
    fetchMock.mockImplementation(async () => citatumXml('Üres fejjel nem megy.', 'Móra Ferenc'));

    const res = await app.request('/api/quote?source=citatum&q=P%C3%A9nz', {}, withCitatum(kv));

    // `Pénz` reaches Citatum as `penz` — accepted by them, and one cache entry
    // rather than one per spelling.
    expect(String(fetchMock.mock.calls[0][0])).toContain('kat=penz');
    await expect(res.json()).resolves.toMatchObject({
      author: 'Móra Ferenc',
      sourceUrl: 'https://www.citatum.hu/idezet/1',
    });
  });

  it('keeps two categories in separate cache entries', async () => {
    const { kv, keys } = createKvStub();
    fetchMock.mockImplementation(async () => citatumXml('Egy.', 'Valaki'));

    await app.request('/api/quote?source=citatum&q=penz', {}, withCitatum(kv));
    await app.request('/api/quote?source=citatum&q=humor', {}, withCitatum(kv));

    const dayKeys = keys().filter((k) => k.startsWith('quote:citatum') && !k.endsWith(':latest'));
    expect(new Set(dayKeys).size).toBe(2);
  });

  it('serves the stale quote instead of spending a used-up daily allowance', async () => {
    const { kv, seed } = createKvStub();
    seed(`citatum:budget:${new Date().toISOString().split('T')[0]}`, '99999');
    seed(quoteLatestKey('citatum', 'hu'), { text: 'Tegnapi.', author: 'Valaki' });
    fetchMock.mockImplementation(async () => citatumXml('Friss.', 'Más'));

    const res = await app.request('/api/quote?source=citatum', {}, withCitatum(kv));

    expect(fetchMock).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ text: 'Tegnapi.' });
  });
});
