import type { BackgroundData } from '@hub/shared';

const BASE = 'https://hub-api.csiszaralex.workers.dev';

export const BACKGROUND_ENDPOINT = `${BASE}/api/background`;
export const QUOTE_ENDPOINT = `${BASE}/api/quote`;

export const QUOTE_SOURCES_ENDPOINT = `${BASE}/api/quote/sources`;

export const backgroundRequestUrl = (query: string): string => {
  const url = new URL(BACKGROUND_ENDPOINT);
  if (query) url.searchParams.set('tags', query);
  return url.toString();
};

/**
 * Whether a `GET /api/background` body has an image to show: a non-empty
 * `https://` `url`. Both the page (`useBackground`) and the service worker
 * (`prefetchBackground`) check this before storing anything, because what they
 * store suppresses the next fetch until the day ends — a 200 without a usable
 * URL would leave a day with no background. Plain `URL` parsing only, so the
 * service worker can import it.
 */
export const isUsableBackground = (data: unknown): data is BackgroundData => {
  const url = (data as Partial<BackgroundData> | null)?.url;
  if (typeof url !== 'string' || !url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * The day's quote for one source, in the interface language.
 *
 * The language travels with the request because the answer depends on it: a
 * source that has both serves the one asked for, and one that has only its own
 * ignores it. An empty category is left off entirely rather than sent as `q=`,
 * so there is one spelling of "no category" on the wire.
 */
export const quoteRequestUrl = (
  source: string,
  language: string,
  category: string,
  index = 0,
): string => {
  const url = new URL(QUOTE_ENDPOINT);
  url.searchParams.set('source', source);
  url.searchParams.set('lang', language);
  if (category) url.searchParams.set('q', category);
  // Which entry of the day's pool. Sent only when it is not the first, so the
  // ordinary daily request keeps exactly the URL it had.
  if (index > 0) url.searchParams.set('n', String(index));
  return url.toString();
};
