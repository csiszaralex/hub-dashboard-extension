import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import { hangingFetch, installFakeClock } from '../test/hangingFetch';

const CACHE_KEY = 'daily_bg_data';

// Imported per test: the settings store is module-level, so each test needs the
// same clean slate a fresh page load would give it.
const loadUseBackground = async () => (await import('./useBackground')).useBackground;

/**
 * Every test here runs on a 1920×1080 @1 screen, which `widthBucketFor` puts in
 * the 1920 bucket, so a URL the page downloads or caches carries these values.
 * Written out rather than computed with `backgroundImageUrl`, so a change to
 * the rewrite cannot also change what these tests expect.
 */
const sized = (url: string) => `${url}?w=1920&q=80`;
const PREFETCHED_URL = sized('https://images.unsplash.com/prefetched');

const stubScreen = (width: number, devicePixelRatio: number) => {
  vi.stubGlobal('screen', { width, height: Math.round((width * 9) / 16) });
  vi.stubGlobal('devicePixelRatio', devicePixelRatio);
};

beforeEach(() => stubScreen(1920, 1));

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
const seedPrefetchedBytes = async (url = PREFETCHED_URL) => {
  const { IMAGE_CACHE_NAME } = await import('../utils/imageCache');
  const cache = await caches.open(IMAGE_CACHE_NAME);
  await cache.put(url, new Response(new Blob(['image-bytes'], { type: 'image/jpeg' })));
  return cache;
};

const backgroundRequests = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/background'));

const requestsFor = (fetchMock: ReturnType<typeof stubFetch>, url: string) =>
  fetchMock.mock.calls.filter(([input]) => String(input) === url);

/** An object URL from the Cache API, as opposed to a remote one or nothing. */
const isLocal = (src: string) => src.startsWith('blob:');

/**
 * Like `stubRotatingFetch`, but an image download takes a few milliseconds, as
 * a real one does. An instant fake would let the cache write win the race
 * against the lookup that the published metadata triggers, and hide the order
 * the hook actually performs them in.
 */
const stubSlowImageFetch = (imageStatus = 200) => {
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
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(new Blob(['image-bytes'], { type: 'image/jpeg' }), { status: imageStatus });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('useBackground when the worker never answers', () => {
  let restoreClock: () => void;
  beforeEach(() => {
    restoreClock = installFakeClock();
  });
  afterEach(() => restoreClock());

  it('shows the fallback background once the request times out', async () => {
    // A hung request raises no error by itself, so without a deadline the
    // fallback in the catch is never reached and the page stays blank.
    installChromeStub();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(hangingFetch));
    const { REQUEST_TIMEOUT_MS } = await import('../utils/fetchWithTimeout');
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.bgData.url).toBe('');

    await act(() => vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS));

    expect(result.current.loading).toBe(false);
    expect(result.current.bgData.url).toContain('images.unsplash.com');
    // The fallback is sized for the screen like every other photo.
    const params = new URL(result.current.bgData.url).searchParams;
    expect([params.get('w'), params.get('q')]).toEqual(['1920', '80']);
    expect(result.current.bgData.photographer).toBe('');
  });
});

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

    await waitFor(() => expect(isLocal(result.current.imageSrc)).toBe(true));
  });

  it.each([
    ['no url', { location: null, photographer: 'Broken', photographerUrl: '' }],
    ['an empty url', { url: '', location: null, photographer: 'Broken', photographerUrl: '' }],
    ['a non-https url', { url: 'http://images.unsplash.com/x', location: null, photographer: 'Broken', photographerUrl: '' }],
  ])('treats a 200 with %s as a failed fetch and stores nothing', async (_label, body) => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'desert,dunes' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })),
    );
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    // The existing failure path: the built-in fallback image, no attribution.
    await waitFor(() => expect(result.current.bgData.url).toContain('images.unsplash.com/photo-'));
    expect(result.current.bgData.photographer).toBe('');
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
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
    await waitFor(() => expect(isLocal(result.current.imageSrc)).toBe(true));

    // Switch to custom without ever calling putCustomImage — the popup is supposed
    // to block this, but the hook must not depend on that: a stale key resolving to
    // nothing must clear whatever the previous key left behind.
    await act(async () => {
      void saveSettings({ backgroundSource: 'custom' });
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
    await waitFor(() => expect(isLocal(result.current.imageSrc)).toBe(true));
    const firstSrc = result.current.imageSrc;

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
      void result.current.refreshBackground();
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
          url: PREFETCHED_URL,
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
          url: PREFETCHED_URL,
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
          url: PREFETCHED_URL,
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
          url: PREFETCHED_URL,
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
          url: PREFETCHED_URL,
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
    await waitFor(() => expect(isLocal(result.current.imageSrc)).toBe(true));
  });

  it('adopts a prefetch made with the default query when the settings were never saved', async () => {
    // No `seedSync`: the hook falls back to its merged default, and the worker
    // must have prefetched under that exact string for the packet to be usable.
    const chromeStub = installChromeStub();
    const { DEFAULT_SETTINGS } = await import('../utils/settingsSchema');
    chromeStub.seedLocal({
      prefetched_bg: {
        date: today(),
        query: DEFAULT_SETTINGS.unsplashQuery,
        data: {
          url: PREFETCHED_URL,
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
          url: sized('https://images.unsplash.com/tomorrow'),
          location: null,
          photographer: 'Tomorrow',
          photographerUrl: '',
        },
      },
    });
    stubFetch();
    const { IMAGE_CACHE_NAME } = await import('../utils/imageCache');
    const cache = await caches.open(IMAGE_CACHE_NAME);
    await cache.put(sized('https://images.unsplash.com/tomorrow'), new Response(new Blob(['bytes'])));
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh'));
    await waitFor(async () =>
      expect(await cache.match(sized('https://images.unsplash.com/fresh'))).toBeDefined(),
    );
    expect(await cache.match(sized('https://images.unsplash.com/tomorrow'))).toBeDefined();
    expect(chromeStub.readLocal('prefetched_bg')).toBeTruthy();
  });

  it('adopts what the service worker prefetched without downloading the image again', async () => {
    // The real prefetch, not a hand-built packet: the URL the worker caches and
    // the one the page looks up are produced by two call sites, and only
    // running both shows they agree.
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'forest' });
    chromeStub.seedLocal({ bg_width_bucket: 1920 });
    const fetchMock = stubFetch();
    const { prefetchBackground } = await import('../utils/prefetch');
    expect(await prefetchBackground('forest', today())).toBe(true);
    const downloadsBefore = fetchMock.mock.calls.length;
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.url).toBe(sized('https://images.unsplash.com/fresh')));
    await waitFor(() => expect(isLocal(result.current.imageSrc)).toBe(true));
    expect(fetchMock.mock.calls.length).toBe(downloadsBefore);
    expect(chromeStub.readLocal('prefetched_bg')).toBeUndefined();
  });

  it.each([
    ['another bucket', 'https://images.unsplash.com/prefetched?w=3840&q=85'],
    ['a version that predates the buckets', 'https://images.unsplash.com/prefetched?w=3840&q=90&fm=jpg&fit=crop'],
  ])('does not adopt a prefetched image sized for %s', async (_label, url) => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'forest' });
    chromeStub.seedLocal({
      prefetched_bg: {
        date: today(),
        query: 'forest',
        data: { url, location: null, photographer: 'Prefetched', photographerUrl: '' },
      },
    });
    const cache = await seedPrefetchedBytes(url);
    const fetchMock = stubFetch();
    const useBackground = await loadUseBackground();

    const { result } = renderHook(() => useBackground());

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh'));
    expect(backgroundRequests(fetchMock)).toHaveLength(1);
    await waitFor(() => expect(chromeStub.readLocal('prefetched_bg')).toBeUndefined());
    // The oversized copy goes the ordinary way, with the next prune.
    await waitFor(async () => expect(await cache.match(url)).toBeUndefined());
  });

  it.each([
    [1366, 1, 1920],
    [1920, 1, 1920],
    [1440, 2, 3840],
    [1280, 1, 1280],
  ])('records the bucket of a %ipx @%i screen for the service worker', async (width, ratio, bucket) => {
    stubScreen(width, ratio);
    const chromeStub = installChromeStub();
    stubFetch();
    const useBackground = await loadUseBackground();

    renderHook(() => useBackground());

    await waitFor(() => expect(chromeStub.readLocal('bg_width_bucket')).toBe(bucket));
  });
});

describe('useBackground image source', () => {
  /** Renders the hook and records every `imageSrc` it renders with, in order. */
  const renderRecording = async (seen: string[] = []) => {
    const useBackground = await loadUseBackground();
    const hook = renderHook(() => {
      const value = useBackground();
      seen.push(value.imageSrc);
      return value;
    });
    return { ...hook, seen };
  };

  it('never shows the remote URL across a refresh whose download succeeds', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'desert,dunes' });
    const fetchMock = stubSlowImageFetch();

    const { result, seen } = await renderRecording();
    await waitFor(() => expect(isLocal(result.current.imageSrc)).toBe(true));
    const firstSrc = result.current.imageSrc;
    seen.length = 0;

    // Not awaited inside `act`: an async `act` would batch the whole refresh
    // into one render and hide the frames in between, which are the point.
    act(() => {
      void result.current.refreshBackground();
    });
    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh 2'));
    await waitFor(() => expect(result.current.imageSrc).not.toBe(firstSrc));

    // Every frame showed either the outgoing local copy or the incoming one:
    // no remote URL (blank until it loads), and no empty frame either.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(isLocal)).toBe(true);
    // Downloaded once, for the cache, rather than a second time for display.
    expect(requestsFor(fetchMock, sized('https://images.unsplash.com/rotation-2'))).toHaveLength(1);
  });

  it('revokes every object URL exactly once, after its replacement is on screen, and on unmount', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'desert,dunes' });
    stubSlowImageFetch();
    const seen: string[] = [];
    const created: string[] = [];
    const revoked: string[] = [];
    // What was rendering at the moment each URL was revoked.
    const onScreenAtRevoke = new Map<string, string | undefined>();
    let counter = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:hub-test/spy-${++counter}`;
      created.push(url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
      revoked.push(url);
      onScreenAtRevoke.set(url, seen.at(-1));
    });
    const { result, unmount } = await renderRecording(seen);

    await waitFor(() => expect(isLocal(result.current.imageSrc)).toBe(true));
    for (const photographer of ['Fresh 2', 'Fresh 3']) {
      const before = result.current.imageSrc;
      // Not awaited inside `act`, so every intermediate frame really renders.
      act(() => {
        void result.current.refreshBackground();
      });
      await waitFor(() => expect(result.current.bgData.photographer).toBe(photographer));
      await waitFor(() => expect(result.current.imageSrc).not.toBe(before));
    }

    // Each replaced image was revoked while its successor was the one rendering.
    expect(revoked).toHaveLength(created.length - 1);
    for (const url of revoked) {
      expect(onScreenAtRevoke.get(url)).not.toBe(url);
      expect(isLocal(onScreenAtRevoke.get(url) ?? '')).toBe(true);
    }

    unmount();

    expect(created.length).toBeGreaterThanOrEqual(3);
    expect([...revoked].sort()).toEqual([...created].sort());
  });

  it('does not touch the remote URL while the cached copy is being looked up on a warm load', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'city,night' });
    seedCache('city,night');
    await seedPrefetchedBytes('https://images.unsplash.com/cached');
    const fetchMock = stubFetch();

    const { result, seen } = await renderRecording();
    await waitFor(() => expect(isLocal(result.current.imageSrc)).toBe(true));

    // Nothing until the lookup answers, then the local copy: the bytes were
    // already here, so the remote image must not be requested at all.
    expect(seen.filter((src) => !isLocal(src)).every((src) => src === '')).toBe(true);
    expect(requestsFor(fetchMock, 'https://images.unsplash.com/cached')).toHaveLength(0);
  });

  it('shows the remote URL when the download into the cache fails', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'desert,dunes' });
    stubSlowImageFetch(503);

    const { result } = await renderRecording();

    await waitFor(() => expect(result.current.bgData.photographer).toBe('Fresh 1'));
    await waitFor(() =>
      expect(result.current.imageSrc).toBe(sized('https://images.unsplash.com/rotation-1')),
    );
  });

  it.each([
    ['an uploaded image', true],
    ['nothing uploaded', false],
  ])('never shows a remote URL for a custom background with %s', async (_label, uploaded) => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ backgroundSource: 'custom' });
    // A remote photo in the daily cache, so `bgData` starts out naming one.
    seedCache('anything');
    stubFetch();
    if (uploaded) {
      const { putCustomImage } = await import('../utils/imageCache');
      await putCustomImage(new Blob(['own-bytes'], { type: 'image/png' }));
    }

    const { result, seen } = await renderRecording();
    await waitFor(() => expect(result.current.isSettingsLoaded).toBe(true));
    if (uploaded) await waitFor(() => expect(isLocal(result.current.imageSrc)).toBe(true));
    // Let a miss for the custom key land as well.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(seen.every((src) => src === '' || isLocal(src))).toBe(true);
  });
});
