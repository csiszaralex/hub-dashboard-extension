import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from './index';
import { DEFAULT_POOL_KEY } from './tags';
import { createKvStub } from './test/kvStub';

let fetchMock: ReturnType<typeof vi.fn>;

const env = (kv: KVNamespace) => ({ UNSPLASH_CACHE: kv, UNSPLASH_ACCESS_KEY: 'test-key' });

/** A KV whose reads fail, as during an outage; the kvStub itself never rejects. */
const failingKv = (): KVNamespace =>
  ({
    get: vi.fn(async () => {
      throw new Error('KV unavailable');
    }),
    put: vi.fn(async () => {
      throw new Error('KV unavailable');
    }),
  }) as unknown as KVNamespace;

const cachedPhoto = {
  url: 'https://images.unsplash.com/cached',
  location: null,
  photographer: 'Cached',
  photographerUrl: 'https://unsplash.com/@cached',
};

/** The extension reads these bodies cross-origin, so every answer needs CORS. */
const fromExtension = { headers: { Origin: 'chrome-extension://abcdefghijklmnop' } };

beforeEach(() => {
  fetchMock = vi.fn(async () => {
    throw new Error('No upstream should be called');
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/health', () => {
  it('is healthy while the default pool is warm', async () => {
    const { kv, seed } = createKvStub();
    seed(DEFAULT_POOL_KEY, [cachedPhoto]);

    const res = await app.request('/api/health', fromExtension, env(kv));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, backgrounds: true });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is unhealthy with an empty KV', async () => {
    const { kv } = createKvStub();

    const res = await app.request('/api/health', {}, env(kv));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false, backgrounds: false });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is unhealthy when the default pool is an empty list', async () => {
    const { kv, seed } = createKvStub();
    seed(DEFAULT_POOL_KEY, []);

    const res = await app.request('/api/health', {}, env(kv));

    expect(res.status).toBe(503);
  });

  it('reports a KV outage as unhealthy instead of throwing', async () => {
    const res = await app.request('/api/health', {}, env(failingKv()));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false, backgrounds: false });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('error responses', () => {
  it('answers an unknown path with a JSON 404 that still carries CORS', async () => {
    const { kv } = createKvStub();

    const res = await app.request('/api/nope', fromExtension, env(kv));

    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({ error: 'Not found' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('answers an unhandled exception with a JSON 500 that still carries CORS', async () => {
    // The background route has no guard around its first KV read, so an outage
    // there is a real way to reach `onError`.
    const res = await app.request('/api/background', fromExtension, env(failingKv()), {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext);

    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({ error: 'Internal error' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('logs the error without the request URL', async () => {
    const res = await app.request(
      '/api/background?tags=private-tag',
      {},
      env(failingKv()),
      { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(500);
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('KV unavailable');
    expect(logged).not.toContain('private-tag');
  });
});
