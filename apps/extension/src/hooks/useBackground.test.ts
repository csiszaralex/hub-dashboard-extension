import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';

const CACHE_KEY = 'daily_bg_data';

// Imported per test: the settings store is module-level, so each test needs the
// same clean slate a fresh page load would give it.
const loadUseBackground = async () => (await import('./useBackground')).useBackground;

const today = () => new Date().toISOString().split('T')[0];

const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
};

const seedCache = (query: string, url = 'https://images.unsplash.com/cached') => {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      date: today(),
      query,
      data: { url, location: null, photographer: 'Cached', photographerUrl: '' },
    }),
  );
};

/** Stubs `fetch` so the hook never touches the network, and counts the calls. */
const stubFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/background')) {
      return new Response(
        JSON.stringify({
          url: 'https://images.unsplash.com/fresh',
          location: null,
          photographer: 'Fresh',
          photographerUrl: '',
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(new Blob(['image-bytes'], { type: 'image/jpeg' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/** Like `stubFetch`, but returns a different photo on every `/api/background` call. */
const stubRotatingFetch = () => {
  let call = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/background')) {
      call += 1;
      return new Response(
        JSON.stringify({
          url: `https://images.unsplash.com/rotation-${call}`,
          location: null,
          photographer: `Fresh ${call}`,
          photographerUrl: '',
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(new Blob(['image-bytes'], { type: 'image/jpeg' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const stubOfflineFetch = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );

/**
 * Puts a prefetched image's bytes into the cache, the way the service worker
 * does before it writes the pointer. A packet without them is not adoptable.
 */
const seedPrefetchedBytes = async (url = 'https://images.unsplash.com/prefetched') => {
  const { IMAGE_CACHE_NAME } = await import('../utils/imageCache');
  const cache = await caches.open(IMAGE_CACHE_NAME);
  await cache.put(url, new Response(new Blob(['image-bytes'], { type: 'image/jpeg' })));
  return cache;
};

const backgroundRequests = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/background'));

describe('useBackground', () => {
  it('serves the cached image without a network request when the saved query matches the cache', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'city,night' });
    seedCache('city,night');
    const fetchMock = stubFetch();
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.isSettingsLoaded).toBe(true));
    // Let any effect scheduled by the settings update flush.
    await Promise.resolve();

    expect(backgroundRequests(fetchMock)).toHaveLength(0);
    expect(result.current.bgData.photographer).toBe('Cached');
  });

  it('keeps the image bytes out of localStorage', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'desert,dunes' });
    stubFetch();
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh'));
    await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).toBeTruthy());

    const packet = localStorage.getItem(CACHE_KEY)!;
    expect(packet).not.toContain('data:image');
    // Metadata only — a packet carrying pixels would be orders of magnitude larger.
    expect(packet.length).toBeLessThan(1000);
  });

  it('serves the background from the local image cache on a later load', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'desert,dunes' });
    stubFetch();
    const useBackground = await loadUseBackground();

    const first = renderHook(() => useBackground());
    await waitFor(() => expect(first.result.current.bgData.photographer).toBe('Fresh'));
    await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).toBeTruthy());
    first.unmount();

    // Next new tab, but offline: the image must still come from the cache.
    stubOfflineFetch();
    const { result } = renderHook(() => useBackground());

    // The remote URL is truthy from the start, so wait for the local copy itself.
    await waitFor(() => expect(result.current.imageSrc).not.toContain('unsplash.com'));
    expect(result.current.imageSrc).toBeTruthy();
  });

  it('fetches a new image when the saved query no longer matches the cache', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'desert,dunes' });
    seedCache('city,night');
    const fetchMock = stubFetch();
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh'));
    expect(backgroundRequests(fetchMock)).toHaveLength(1);
  });

  it('serves the custom image and makes no request when that source is selected', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ backgroundSource: 'custom' });
    const fetchMock = stubFetch();
    const { putCustomImage } = await import('../utils/imageCache');
    await putCustomImage(new Blob(['own-bytes'], { type: 'image/png' }));
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.imageSrc).toBeTruthy());
    expect(backgroundRequests(fetchMock)).toHaveLength(0);
    expect(result.current.imageSrc).not.toContain('unsplash.com');
  });

  it('refuses to fetch a real photo when refreshBackground is invoked while the custom source is active', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ backgroundSource: 'custom' });
    const fetchMock = stubFetch();
    const { putCustomImage } = await import('../utils/imageCache');
    await putCustomImage(new Blob(['own-bytes'], { type: 'image/png' }));
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());
    await waitFor(() => expect(result.current.imageSrc).toBeTruthy());
    const customSrc = result.current.imageSrc;

    // The refresh button is hidden in the UI for a custom background, but the hook
    // must refuse the fetch on its own — nothing should reach the network, and the
    // custom image already on screen must survive the call untouched.
    await act(async () => {
      await result.current.refreshBackground();
    });

    expect(backgroundRequests(fetchMock)).toHaveLength(0);
    expect(result.current.imageSrc).toBe(customSrc);
    expect(result.current.bgData.photographer).toBe('');
  });

  it('drops the previous image instead of leaving it on screen when the source becomes custom with nothing uploaded', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'desert,dunes' });
    stubFetch();
    const useBackground = await loadUseBackground();
    const { saveSettings } = await import('./useSettings');

    const { result } = renderHook(() => useBackground());
    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh'));
    await waitFor(() => expect(result.current.imageSrc).not.toContain('unsplash.com'));
    expect(result.current.imageSrc).toBeTruthy();

    // Switch to custom without ever calling putCustomImage — the popup is supposed
    // to block this, but the hook must not depend on that: a stale key resolving to
    // nothing must clear whatever the previous key left behind.
    await act(async () => {
      saveSettings({ backgroundSource: 'custom' });
      await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    });

    await waitFor(() => expect(result.current.imageSrc).toBe(''));
    expect(result.current.bgData.photographer).toBe('');
  });

  it('keeps the outgoing image on screen while an ordinary rotation is still resolving, instead of blanking out', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'desert,dunes' });
    stubRotatingFetch();
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());
    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh 1'));
    await waitFor(() => expect(result.current.imageSrc).not.toContain('unsplash.com'));
    const firstSrc = result.current.imageSrc;
    expect(firstSrc).toBeTruthy();

    // Hold the underlying cache lookup open so the "key already changed but not
    // yet resolved" window can be asserted on directly, rather than guessing how
    // many microtask ticks land in the right place. This patches the same
    // in-memory Cache instance the hook itself reads through — no module mocking
    // involved, just the existing cache stub's own object.
    const { IMAGE_CACHE_NAME } = await import('../utils/imageCache');
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const originalMatch = cache.match.bind(cache);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    cache.match = (async (request: Parameters<Cache['match']>[0]) => {
      await gate;
      return originalMatch(request);
    }) as Cache['match'];

    act(() => {
      result.current.refreshBackground();
    });

    // bgData has moved on to the new photo, so the cache key has already
    // changed and the (gated) lookup for it has already been kicked off.
    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh 2'));

    // This is the exact regression: an unconditional pre-emptive clear would
    // have already nulled `imageSrc` out at this point. The outgoing photo was
    // legitimate and correctly credited, so it must still be what's rendering
    // while the new one is still being looked up.
    expect(result.current.imageSrc).toBe(firstSrc);

    await act(async () => {
      release();
      await gate;
    });

    await waitFor(() => expect(result.current.imageSrc).not.toBe(firstSrc));
    expect(result.current.imageSrc).toBeTruthy();
  });

  it('adopts a prefetched image instead of making a request', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'forest' });
    chromeStub.seedLocal({
      prefetched_bg: {
        date: today(),
        query: 'forest',
        data: {
          url: 'https://images.unsplash.com/prefetched',
          location: null,
          photographer: 'Prefetched',
          photographerUrl: '',
        },
      },
    });
    await seedPrefetchedBytes();
    const fetchMock = stubFetch();
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Prefetched'));
    expect(backgroundRequests(fetchMock)).toHaveLength(0);
  });

  it('ignores a prefetched image built for a different query', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'desert' });
    chromeStub.seedLocal({
      prefetched_bg: {
        date: today(),
        query: 'forest',
        data: {
          url: 'https://images.unsplash.com/prefetched',
          location: null,
          photographer: 'Prefetched',
          photographerUrl: '',
        },
      },
    });
    const fetchMock = stubFetch();
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh'));
    expect(backgroundRequests(fetchMock)).toHaveLength(1);
  });

  it('consumes the prefetch slot so the next day cannot adopt a stale image', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'forest' });
    chromeStub.seedLocal({
      prefetched_bg: {
        date: today(),
        query: 'forest',
        data: {
          url: 'https://images.unsplash.com/prefetched',
          location: null,
          photographer: 'Prefetched',
          photographerUrl: '',
        },
      },
    });
    await seedPrefetchedBytes();
    stubFetch();
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Prefetched'));
    await waitFor(() => expect(chromeStub.readLocal('prefetched_bg')).toBeUndefined());
    // The metadata moved into the page's own daily cache on the way through.
    expect(localStorage.getItem(CACHE_KEY)).toContain('Prefetched');
  });

  it('drops the previous image from the cache when it adopts a prefetch', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'forest' });
    chromeStub.seedLocal({
      prefetched_bg: {
        date: today(),
        query: 'forest',
        data: {
          url: 'https://images.unsplash.com/prefetched',
          location: null,
          photographer: 'Prefetched',
          photographerUrl: '',
        },
      },
    });
    stubFetch();
    const cache = await seedPrefetchedBytes();
    // Yesterday's photo, still in the cache. Only the on-demand fetch used to
    // prune, so an uninterrupted prefetch-and-adopt cycle would otherwise pile
    // up a multi-megabyte image per day forever.
    await cache.put('https://images.unsplash.com/yesterday', new Response(new Blob(['old'])));
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Prefetched'));
    await waitFor(async () =>
      expect(await cache.match('https://images.unsplash.com/yesterday')).toBeUndefined(),
    );
  });

  it('fetches normally when the prefetched image is no longer in the cache', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'forest' });
    chromeStub.seedLocal({
      prefetched_bg: {
        date: today(),
        query: 'forest',
        data: {
          url: 'https://images.unsplash.com/prefetched',
          location: null,
          photographer: 'Prefetched',
          photographerUrl: '',
        },
      },
    });
    // Deliberately no bytes. Chrome can evict the Cache API bucket without
    // touching `chrome.storage.local`, so a pointer can outlive its image.
    // Adopting on the pointer alone marks the day done in the daily cache,
    // suppresses every retry until midnight, and leaves nothing to render
    // offline — worse than never having prefetched at all.
    const fetchMock = stubFetch();
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh'));
    expect(backgroundRequests(fetchMock)).toHaveLength(1);
    // The dead pointer is dropped rather than re-examined on every load.
    await waitFor(() => expect(chromeStub.readLocal('prefetched_bg')).toBeUndefined());
    await waitFor(() => expect(result.current.imageSrc).not.toContain('unsplash.com'));
  });

  it('adopts a prefetch made with the default query when the settings were never saved', async () => {
    // No `seedSync`: the hook falls back to its merged default, and the worker
    // must have prefetched under that exact string for the packet to be usable.
    const chromeStub = installChromeStub();
    const { DEFAULT_UNSPLASH_QUERY } = await import('../utils/api');
    chromeStub.seedLocal({
      prefetched_bg: {
        date: today(),
        query: DEFAULT_UNSPLASH_QUERY,
        data: {
          url: 'https://images.unsplash.com/prefetched',
          location: null,
          photographer: 'Prefetched',
          photographerUrl: '',
        },
      },
    });
    await seedPrefetchedBytes();
    const fetchMock = stubFetch();
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Prefetched'));
    expect(backgroundRequests(fetchMock)).toHaveLength(0);
  });

  it('keeps an image the service worker prefetched for a later day', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'forest' });
    // The alarm fired before the first new tab of the day, so the slot already
    // holds tomorrow's image. Today's load cannot adopt it, and pruning it away
    // would leave a pointer to an image nobody has — tomorrow would then adopt
    // a packet with nothing behind it and be worse off than with no prefetch.
    chromeStub.seedLocal({
      prefetched_bg: {
        date: tomorrow(),
        query: 'forest',
        data: {
          url: 'https://images.unsplash.com/tomorrow',
          location: null,
          photographer: 'Tomorrow',
          photographerUrl: '',
        },
      },
    });
    stubFetch();
    const { IMAGE_CACHE_NAME } = await import('../utils/imageCache');
    const cache = await caches.open(IMAGE_CACHE_NAME);
    await cache.put('https://images.unsplash.com/tomorrow', new Response(new Blob(['bytes'])));
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh'));
    await waitFor(async () =>
      expect(await cache.match('https://images.unsplash.com/fresh')).toBeDefined(),
    );
    expect(await cache.match('https://images.unsplash.com/tomorrow')).toBeDefined();
    expect(chromeStub.readLocal('prefetched_bg')).toBeTruthy();
  });
});
