import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from './test/chromeStub';

// Imported per test: importing the module is what registers the listeners, so
// each test needs a fresh copy wired to its own stub.
const loadBackground = async () => await import('./background');

const PREFETCH_ALARM = 'prefetch-background';
const PREFETCH_KEY = 'prefetched_bg';

const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
};

const stubFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/api/background')
      ? new Response(
          JSON.stringify({
            url: 'https://images.unsplash.com/tomorrow',
            location: null,
            photographer: 'Tomorrow',
            photographerUrl: '',
          }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      : new Response(new Blob(['bytes'], { type: 'image/jpeg' })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/** Lets every queued callback (and the promises they start) run to completion. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('background service worker', () => {
  it('schedules a daily prefetch alarm on install', async () => {
    const chromeStub = installChromeStub();
    await loadBackground();

    chromeStub.fireInstalled('install');
    await settle();

    expect(chromeStub.scheduledAlarms()).toEqual([
      expect.objectContaining({ name: PREFETCH_ALARM, periodInMinutes: 24 * 60 }),
    ]);
  });

  it('leaves the existing alarm alone on browser startup', async () => {
    const chromeStub = installChromeStub();
    await loadBackground();
    chromeStub.fireInstalled('install');
    await settle();

    // Re-creating the alarm here would restart its 24 h clock, so a browser
    // restarted every day would never reach the prefetch at all.
    chromeStub.fireStartup();
    await settle();

    expect(chromeStub.createdAlarms()).toHaveLength(1);
  });

  // Deliberately not named "recreates the alarm when it went missing": with no
  // alarm scheduled, the gated and ungated versions of `scheduleAlarm` behave
  // identically, so this cannot discriminate between them. What it does cover is
  // that the startup path is wired up at all and schedules the right alarm — the
  // test above is the one that pins the gate.
  it('schedules the alarm on browser startup when none is scheduled yet', async () => {
    const chromeStub = installChromeStub();
    await loadBackground();

    chromeStub.fireStartup();
    await settle();

    expect(chromeStub.scheduledAlarms()).toEqual([
      expect.objectContaining({ name: PREFETCH_ALARM, periodInMinutes: 24 * 60 }),
    ]);
  });

  it('prefetches tomorrow when the alarm fires', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ unsplashQuery: 'forest', backgroundSource: 'unsplash' });
    stubFetch();
    await loadBackground();
    chromeStub.fireInstalled('install');
    await settle();

    chromeStub.fireAlarm(PREFETCH_ALARM);
    await settle();

    expect(chromeStub.readLocal(PREFETCH_KEY)).toEqual({
      date: tomorrow(),
      query: 'forest',
      data: {
        url: 'https://images.unsplash.com/tomorrow',
        location: null,
        photographer: 'Tomorrow',
        photographerUrl: '',
      },
    });
  });

  it('prefetches with the default query when the settings were never saved', async () => {
    // Nothing seeded on purpose: `unsplashQuery` only reaches storage when the
    // popup is saved, so on a fresh install — most installs — the key is simply
    // absent. Falling back to anything other than the page's own default makes
    // the packet unadoptable and the whole download wasted.
    const chromeStub = installChromeStub();
    const fetchMock = stubFetch();
    const { DEFAULT_UNSPLASH_QUERY } = await import('./utils/api');
    await loadBackground();
    chromeStub.fireInstalled('install');
    await settle();

    chromeStub.fireAlarm(PREFETCH_ALARM);
    await settle();

    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.searchParams.get('tags')).toBe(DEFAULT_UNSPLASH_QUERY);
    expect(chromeStub.readLocal(PREFETCH_KEY)).toMatchObject({ query: DEFAULT_UNSPLASH_QUERY });
  });

  it('makes no request when the user supplied their own background', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ backgroundSource: 'custom' });
    const fetchMock = stubFetch();
    await loadBackground();
    chromeStub.fireInstalled('install');
    await settle();

    chromeStub.fireAlarm(PREFETCH_ALARM);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(chromeStub.readLocal(PREFETCH_KEY)).toBeUndefined();
  });

  it('drops image caches left by an older format on update', async () => {
    const chromeStub = installChromeStub();
    await caches.open('hub-background-v0');
    const { IMAGE_CACHE_NAME } = await import('./utils/imageCache');
    await caches.open(IMAGE_CACHE_NAME);
    await loadBackground();

    chromeStub.fireInstalled('update');
    await settle();

    expect(await caches.has('hub-background-v0')).toBe(false);
    expect(await caches.has(IMAGE_CACHE_NAME)).toBe(true);
  });
});
