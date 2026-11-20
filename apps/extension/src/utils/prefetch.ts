import type { BackgroundData } from '@hub/shared';
import { backgroundRequestUrl, isUsableBackground } from './api';
import { backgroundImageUrl, readWidthBucket } from './backgroundImageSize';
import { fetchWithTimeout } from './fetchWithTimeout';
import { cacheImage } from './imageCache';

/**
 * Hand-off slot between the service worker and the new tab page.
 *
 * `chrome.storage.local` rather than `localStorage`, because a service worker
 * has no access to the latter. The page adopts the packet on load and moves it
 * into its own daily cache. Nothing in this module — or anything it imports —
 * may touch `window`, `document` or `localStorage` for the same reason.
 */
const PREFETCH_KEY = 'prefetched_bg';

export interface PrefetchPacket {
  date: string;
  query: string;
  data: BackgroundData;
}

export const readPrefetch = (): Promise<PrefetchPacket | null> =>
  new Promise((resolve) => {
    chrome.storage.local.get([PREFETCH_KEY], (items) => {
      const packet = items[PREFETCH_KEY] as PrefetchPacket | undefined;
      resolve(packet?.date && packet?.data ? packet : null);
    });
  });

export const savePrefetch = (packet: PrefetchPacket): Promise<void> =>
  new Promise((resolve) => {
    chrome.storage.local.set({ [PREFETCH_KEY]: packet }, () => resolve());
  });

export const clearPrefetch = (): Promise<void> =>
  new Promise((resolve) => {
    chrome.storage.local.remove(PREFETCH_KEY, () => resolve());
  });

/**
 * Fetches metadata and the image itself for `date`, ready for the page to adopt.
 *
 * The order of the three steps is what makes this safe to interrupt: an MV3
 * service worker can be terminated at any point, so the pointer in
 * `chrome.storage.local` is written last, only once the bytes are provably in
 * the Cache API. A worker killed earlier leaves either nothing at all or an
 * orphaned image (evicted by the page's next `pruneImageCache`) — never a
 * pointer to an image nobody has, which would make the page skip its own fetch
 * and then have nothing to render offline.
 */
export const prefetchBackground = async (query: string, date: string): Promise<boolean> => {
  try {
    const data = await fetchWithTimeout(
      backgroundRequestUrl(query),
      async (res): Promise<unknown> => (res.ok ? res.json() : null),
    );
    // A packet without a usable URL would be adopted by the page as the day's
    // background and suppress its own fetch until midnight.
    if (!isUsableBackground(data)) return false;

    // Resized with the bucket the page stored, so the URL cached here is the
    // one the page's `hasCachedImage` asks for when it adopts the packet.
    const sized = { ...data, url: backgroundImageUrl(data.url, await readWidthBucket()) };
    if (!(await cacheImage(sized.url))) return false;

    await savePrefetch({ date, query, data: sized });
    return true;
  } catch (error) {
    console.error('Background prefetch failed:', error);
    return false;
  }
};
