const BASE = 'https://hub-api.csiszaralex.workers.dev';

export const BACKGROUND_ENDPOINT = `${BASE}/api/background`;
export const QUOTE_ENDPOINT = `${BASE}/api/quote`;

/**
 * Search tags used until the user saves their own in the popup.
 *
 * It lives here, and not next to the rest of the settings defaults, because the
 * service worker needs it too: `unsplashQuery` is absent from
 * `chrome.storage.sync` on a fresh install, so the worker has to fall back to
 * the very same string the page falls back to. Anything else and the worker
 * prefetches from one pool while the page asks for another, the query stored in
 * the packet never matches, and every prefetched image is downloaded and thrown
 * away unused. This module is safe to import from a service worker; the
 * settings hook is not, so the constant travels in this direction only.
 */
export const DEFAULT_UNSPLASH_QUERY = 'landscape,forest,mountain,fog,nature view';

export const backgroundRequestUrl = (query: string): string => {
  const url = new URL(BACKGROUND_ENDPOINT);
  if (query) url.searchParams.set('tags', query);
  return url.toString();
};
