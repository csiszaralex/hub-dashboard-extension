import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';

const CACHE_KEY = 'daily_bg_data';

// Imported per test: the settings store is module-level, so each test needs the
// same clean slate a fresh page load would give it.
const loadUseBackground = async () => (await import('./useBackground')).useBackground;

const today = () => new Date().toISOString().split('T')[0];

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

const stubOfflineFetch = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );

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
});
