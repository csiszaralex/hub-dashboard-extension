import {
  isBackgroundData,
  isErrorBody,
  isHealthReport,
  isQuoteData,
  isQuoteSourceList,
  SUPPORTED_LANGUAGES,
} from '@hub/shared';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import app from './index';
import { describeSources } from './quoteSources';
import { createKvStub } from './test/kvStub';

/**
 * Every response the worker gives, run through the guards the extension reads
 * it with. Installed extensions lag behind the worker by days to weeks, so a
 * shape change that fails here would break users who have not updated yet.
 * The behaviour of each route is tested in its own file; this checks only the
 * shape.
 */

const executionCtx = (): ExecutionContext =>
  ({ waitUntil: () => {}, passThroughOnException: () => {} }) as unknown as ExecutionContext;

/** Citatum's credentials too, so every source the registry has is served. */
const env = (kv: KVNamespace) => ({
  UNSPLASH_CACHE: kv,
  UNSPLASH_ACCESS_KEY: 'test-key',
  CITATUM_USER: 'tesztfelhasznalo',
  CITATUM_KEY: 'tesztkod',
});

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

/** Answers each upstream the worker calls in the shape that upstream sends. */
const upstreams = async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  if (url.startsWith('https://api.unsplash.com/photos/random')) {
    return Response.json([photo('1'), photo('2')]);
  }
  if (url.includes('/download')) return new Response(null, { status: 200 });
  if (url.startsWith('https://stoic.tekloon.net/')) {
    return Response.json({ data: { quote: 'Waste no more time.', author: 'Marcus Aurelius' } });
  }
  if (url.startsWith('https://api.citatum.hu/')) {
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><idezetek><idezet><idezetszoveg>Egy.</idezetszoveg><szerzo>Valaki</szerzo><url>https://www.citatum.hu/idezet/1</url></idezet></idezetek>',
    );
  }
  throw new Error(`Unexpected upstream: ${url}`);
};

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(upstreams);
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const failUpstreams = () =>
  fetchMock.mockImplementation(async () => {
    throw new Error('Upstream down');
  });

const request = async (path: string, kv = createKvStub().kv) => {
  const res = await app.request(path, {}, env(kv), executionCtx());
  return { status: res.status, body: (await res.json()) as unknown };
};

describe('API contract', () => {
  it('GET /api/background answers BackgroundData', async () => {
    const { status, body } = await request('/api/background?tags=mountain');
    expect(status).toBe(200);
    expect(isBackgroundData(body)).toBe(true);
  });

  it('GET /api/background answers ErrorBody when nothing can be served', async () => {
    failUpstreams();
    const { status, body } = await request('/api/background');
    expect(status).toBe(503);
    expect(isErrorBody(body)).toBe(true);
  });

  it('GET /api/quote/sources answers QuoteSourceList', async () => {
    const { status, body } = await request('/api/quote/sources');
    expect(status).toBe(200);
    expect(isQuoteSourceList(body)).toBe(true);
  });

  // Every source in every language, because each source builds its answer its
  // own way: an upstream proxy, an XML parse, a bundled list.
  const cases = describeSources(env(createKvStub().kv)).flatMap(({ id }) =>
    SUPPORTED_LANGUAGES.map((lang) => [id, lang] as const),
  );

  it.each(cases)('GET /api/quote?source=%s&lang=%s answers QuoteData', async (source, lang) => {
    const { status, body } = await request(`/api/quote?source=${source}&lang=${lang}&q=humor`);
    expect(status).toBe(200);
    expect(isQuoteData(body)).toBe(true);
  });

  it('GET /api/quote answers ErrorBody when nothing can be served', async () => {
    failUpstreams();
    const { status, body } = await request('/api/quote?source=stoic');
    expect(status).toBe(503);
    expect(isErrorBody(body)).toBe(true);
  });

  it('GET /api/health answers HealthReport when healthy and when not', async () => {
    const { kv } = createKvStub();
    const unhealthy = await request('/api/health', kv);
    expect(unhealthy.status).toBe(503);
    expect(isHealthReport(unhealthy.body)).toBe(true);

    // A request for the default tags fills the default pool.
    await request('/api/background', kv);
    const healthy = await request('/api/health', kv);
    expect(healthy.status).toBe(200);
    expect(isHealthReport(healthy.body)).toBe(true);
  });

  it('an unknown path answers ErrorBody', async () => {
    const { status, body } = await request('/api/nope');
    expect(status).toBe(404);
    expect(isErrorBody(body)).toBe(true);
  });
});

/** So a guard that accepts anything cannot make the contract above pass. */
describe('the contract guards', () => {
  it('reject a body missing a field a reader relies on', () => {
    expect(isBackgroundData({ url: 'https://x', location: null, photographer: 'P' })).toBe(false);
    expect(isQuoteData({ text: 'T' })).toBe(false);
    expect(isQuoteSourceList([{ id: 'x', languages: 'en', acceptsQuery: false }])).toBe(false);
    expect(isQuoteSourceList({ id: 'x' })).toBe(false);
    expect(isHealthReport({ ok: true })).toBe(false);
    expect(isErrorBody('Not found')).toBe(false);
    expect(isErrorBody(null)).toBe(false);
  });

  it('accept fields they do not know, since responses may gain optional ones', () => {
    expect(isQuoteData({ text: 'T', author: 'A', mood: 'calm' })).toBe(true);
    expect(isQuoteSourceList([{ id: 'x', languages: ['de'], acceptsQuery: true, beta: true }])).toBe(true);
  });
});
