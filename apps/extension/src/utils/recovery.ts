import { clearBackgroundCache } from '../hooks/useBackground';
import { clearQuoteCache } from '../hooks/useQuote';
import { clearWeatherCache } from '../hooks/useWeather';
import { deleteObsoleteImageCaches, pruneImageCache } from './imageCache';
import { clearServerData } from './memosStorage';
import { clearPrefetch } from './prefetch';

/**
 * How long one step may take before the reload goes ahead without it. A
 * `chrome.storage` callback that never fires would otherwise leave the user
 * pressing a button that does nothing, on the one screen meant to get them out.
 */
const STEP_TIMEOUT_MS = 2_000;

/**
 * What the recovery screen's "clear cached data" may delete: only what the
 * extension can fetch or derive again. A bad cached value is the usual reason a
 * render throws on every new tab, so these are the entries worth dropping.
 *
 * Deliberately absent, and never to be added: the quick note, the last-seen
 * release (`useWhatsNew`), the Memos credentials and unsent draft, the Pomodoro
 * state, the popup's remembered tab, everything in `chrome.storage.sync` (the
 * settings), and the user's uploaded background — none of them exists anywhere
 * else. `pruneImageCache` and `deleteObsoleteImageCaches` both keep the upload
 * by construction, which is why the image buckets go through them rather than
 * `caches.delete`.
 */
const STEPS: Record<string, () => void | Promise<void>> = {
  background: clearBackgroundCache,
  quote: clearQuoteCache,
  weather: clearWeatherCache,
  prefetch: clearPrefetch,
  // The Memos list and its check record — not the token, server or draft.
  memos: clearServerData,
  images: async () => {
    await pruneImageCache([]);
    await deleteObsoleteImageCaches();
  },
};

const withTimeout = (step: () => void | Promise<void>): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), STEP_TIMEOUT_MS);
    // `async` so a step that throws synchronously rejects instead of escaping.
    (async () => step())().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/**
 * Clears every re-fetchable cache, each step independently: one that throws or
 * hangs is logged and the rest still run. Never rejects, so the caller's reload
 * always follows.
 */
export const clearRecoverableData = async (): Promise<void> => {
  const names = Object.keys(STEPS);
  const results = await Promise.allSettled(names.map((name) => withTimeout(STEPS[name])));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Recovery could not clear ${names[index]}:`, result.reason);
    }
  });
};
