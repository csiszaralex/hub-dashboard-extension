import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import { hangingFetch } from '../test/hangingFetch';
import { IMAGE_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from './fetchWithTimeout';

const load = async () => await import('./prefetch');

const metadata = {
  url: 'https://images.unsplash.com/tomorrow',
  location: null,
  photographer: 'Tomorrow',
  photographerUrl: '',
};

const stubFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/api/background')
      ? new Response(JSON.stringify(metadata), { headers: { 'Content-Type': 'application/json' } })
      : new Response(new Blob(['bytes'], { type: 'image/jpeg' })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('prefetchBackground', () => {
  it('stores the metadata under the requested date', async () => {
    installChromeStub();
    stubFetch();
    const { prefetchBackground, readPrefetch } = await load();

    expect(await prefetchBackground('forest', '2026-08-01')).toBe(true);

    expect(await readPrefetch()).toEqual({
      date: '2026-08-01',
      query: 'forest',
      data: metadata,
    });
  });

  it('downloads the image so the page never waits on the network', async () => {
    installChromeStub();
    const fetchMock = stubFetch();
    const { prefetchBackground } = await load();

    await prefetchBackground('forest', '2026-08-01');

    expect(fetchMock.mock.calls.some(([i]) => String(i) === metadata.url)).toBe(true);
  });

  it('reports failure and stores nothing when the worker is unreachable', async () => {
    installChromeStub();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { prefetchBackground, readPrefetch } = await load();

    expect(await prefetchBackground('forest', '2026-08-01')).toBe(false);
    expect(await readPrefetch()).toBeNull();
  });

  it('leaves no pointer behind when the image itself cannot be cached', async () => {
    installChromeStub();
    // Metadata arrives, the image download fails. The service worker can be
    // killed at any moment, so the pointer must only ever appear once the bytes
    // are safely in the cache — a pointer to an image nobody has would make the
    // page skip its own fetch and render nothing while offline.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/api/background')
          ? new Response(JSON.stringify(metadata), {
              headers: { 'Content-Type': 'application/json' },
            })
          : new Response('nope', { status: 500 }),
      ),
    );
    const { prefetchBackground, readPrefetch } = await load();

    expect(await prefetchBackground('forest', '2026-08-01')).toBe(false);
    expect(await readPrefetch()).toBeNull();
  });

  it('gives up and stores nothing when the worker never answers', async () => {
    installChromeStub();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(hangingFetch));
    const { prefetchBackground, readPrefetch } = await load();
    vi.useFakeTimers();
    try {
      const result = prefetchBackground('forest', '2026-08-01');
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);

      expect(await result).toBe(false);
      expect(await readPrefetch()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no pointer behind when the image download never finishes', async () => {
    // The metadata arrives and the bytes do not. The pointer is the last step,
    // so a download that times out must leave nothing for the page to adopt.
    installChromeStub();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/api/background')
          ? Promise.resolve(
              new Response(JSON.stringify(metadata), {
                headers: { 'Content-Type': 'application/json' },
              }),
            )
          : hangingFetch(input, init),
      ),
    );
    const { prefetchBackground, readPrefetch } = await load();
    vi.useFakeTimers();
    try {
      const result = prefetchBackground('forest', '2026-08-01');
      await vi.advanceTimersByTimeAsync(IMAGE_TIMEOUT_MS);

      expect(await result).toBe(false);
      expect(await readPrefetch()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null when nothing has been prefetched', async () => {
    installChromeStub();
    const { readPrefetch } = await load();

    expect(await readPrefetch()).toBeNull();
  });

  it('clears a stored packet', async () => {
    installChromeStub();
    stubFetch();
    const { prefetchBackground, clearPrefetch, readPrefetch } = await load();
    await prefetchBackground('forest', '2026-08-01');

    await clearPrefetch();

    expect(await readPrefetch()).toBeNull();
  });
});
