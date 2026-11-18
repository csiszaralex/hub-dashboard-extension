import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStub, type ChromeStub } from '../test/chromeStub';

/**
 * Spelled out rather than imported: these tests are the record of which keys
 * recovery may touch, so a renamed key has to show up here as a failure.
 */
const CACHED_LOCAL_STORAGE = ['daily_bg_data', 'daily_quote', 'weather_cache'];
const PROTECTED_LOCAL_STORAGE = ['quick_note_content', 'hub_last_seen_version', 'popup_tab'];
const CACHED_CHROME_LOCAL = ['prefetched_bg', 'memos_cache', 'memos_check'];
const PROTECTED_CHROME_LOCAL = [
  'memos_token',
  'memos_server',
  'memos_user',
  'memos_draft',
  'pomodoro_state',
];

const PHOTO_URL = 'https://images.unsplash.com/photo-test';
const OBSOLETE_BUCKET = 'hub-background-v0';

let chromeStub: ChromeStub;

const seedEverything = async () => {
  for (const key of [...CACHED_LOCAL_STORAGE, ...PROTECTED_LOCAL_STORAGE]) {
    localStorage.setItem(key, JSON.stringify({ seeded: key }));
  }
  chromeStub.seedLocal(
    Object.fromEntries(
      [...CACHED_CHROME_LOCAL, ...PROTECTED_CHROME_LOCAL].map((key) => [key, { seeded: key }]),
    ),
  );
  chromeStub.seedSync({ language: 'hu', unsplashQuery: 'mountains' });

  const { CUSTOM_IMAGE_KEY, IMAGE_CACHE_NAME } = await import('./imageCache');
  const current = await caches.open(IMAGE_CACHE_NAME);
  await current.put(PHOTO_URL, new Response('photo'));
  await current.put(CUSTOM_IMAGE_KEY, new Response('upload'));
  const obsolete = await caches.open(OBSOLETE_BUCKET);
  await obsolete.put(PHOTO_URL, new Response('old photo'));
};

const expectProtectedIntact = async () => {
  for (const key of PROTECTED_LOCAL_STORAGE) expect(localStorage.getItem(key)).not.toBeNull();
  for (const key of PROTECTED_CHROME_LOCAL) expect(chromeStub.readLocal(key)).toBeDefined();
  expect(chromeStub.readSync('language')).toBe('hu');
  expect(chromeStub.readSync('unsplashQuery')).toBe('mountains');

  const { CUSTOM_IMAGE_KEY, IMAGE_CACHE_NAME } = await import('./imageCache');
  const upload = await (await caches.open(IMAGE_CACHE_NAME)).match(CUSTOM_IMAGE_KEY);
  expect(await upload?.text()).toBe('upload');
};

describe('clearRecoverableData', () => {
  beforeEach(() => {
    chromeStub = installChromeStub();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears exactly the re-fetchable caches and keeps everything else', async () => {
    await seedEverything();
    const { clearRecoverableData } = await import('./recovery');
    const { IMAGE_CACHE_NAME } = await import('./imageCache');

    await clearRecoverableData();

    for (const key of CACHED_LOCAL_STORAGE) expect(localStorage.getItem(key)).toBeNull();
    for (const key of CACHED_CHROME_LOCAL) expect(chromeStub.readLocal(key)).toBeUndefined();
    expect(await (await caches.open(IMAGE_CACHE_NAME)).match(PHOTO_URL)).toBeUndefined();
    expect(await caches.has(OBSOLETE_BUCKET)).toBe(false);
    await expectProtectedIntact();
  });

  it('runs every other step when one throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedEverything();
    const removeItem = localStorage.removeItem.bind(localStorage);
    vi.spyOn(localStorage, 'removeItem').mockImplementation((key) => {
      if (key === 'daily_quote') throw new Error('storage broke');
      removeItem(key);
    });
    const { clearRecoverableData } = await import('./recovery');

    await expect(clearRecoverableData()).resolves.toBeUndefined();

    expect(localStorage.getItem('daily_quote')).not.toBeNull();
    expect(localStorage.getItem('daily_bg_data')).toBeNull();
    expect(localStorage.getItem('weather_cache')).toBeNull();
    for (const key of CACHED_CHROME_LOCAL) expect(chromeStub.readLocal(key)).toBeUndefined();
    expect(error).toHaveBeenCalledWith('Recovery could not clear quote:', expect.any(Error));
    await expectProtectedIntact();
  });

  it('gives up on a step whose callback never comes, instead of hanging the reload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedEverything();
    // A `chrome.storage` call whose callback is never delivered.
    vi.spyOn(chrome.storage.local, 'remove').mockImplementation(() => {});
    const { clearRecoverableData } = await import('./recovery');
    vi.useFakeTimers();

    const done = clearRecoverableData();
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(done).resolves.toBeUndefined();
    expect(localStorage.getItem('daily_bg_data')).toBeNull();
  });
});
