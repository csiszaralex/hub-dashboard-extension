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

export const QUOTE_SOURCES_ENDPOINT = `${BASE}/api/quote/sources`;

/** The source a fresh install reads quotes from, until the popup says otherwise. */
export const DEFAULT_QUOTE_SOURCE = 'stoic';

export const backgroundRequestUrl = (query: string): string => {
  const url = new URL(BACKGROUND_ENDPOINT);
  if (query) url.searchParams.set('tags', query);
  return url.toString();
};

/**
 * The day's quote for one source, in the interface language.
 *
 * The language travels with the request because the answer depends on it: a
 * source that has both serves the one asked for, and one that has only its own
 * ignores it. An empty category is left off entirely rather than sent as `q=`,
 * so there is one spelling of "no category" on the wire.
 */
export const quoteRequestUrl = (source: string, language: string, category: string): string => {
  const url = new URL(QUOTE_ENDPOINT);
  url.searchParams.set('source', source);
  url.searchParams.set('lang', language);
  if (category) url.searchParams.set('q', category);
  return url.toString();
};
