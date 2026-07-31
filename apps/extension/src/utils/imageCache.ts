/**
 * Background images live in the Cache API, not in localStorage.
 *
 * A 3840px JPEG is 1–4 MB; base64-encoding it into localStorage inflates it by
 * a third and blows the 5–10 MB origin quota, after which every write throws
 * and the image silently re-downloads on every load. The Cache API stores the
 * response as a blob, has its own (far larger) quota, and needs no encoding.
 */
const CACHE_PREFIX = 'hub-background-v';
export const IMAGE_CACHE_NAME = `${CACHE_PREFIX}1`;

/**
 * Cache key for a user-supplied background.
 *
 * Must be `http:`/`https:`: the Cache API's `put()` throws a `TypeError` for
 * any other scheme (a hard requirement of the Service Workers spec), so a
 * `hub://` key — while readable in a Vitest stub that didn't enforce this —
 * fails on every real browser. `.invalid` is an IANA-reserved TLD (RFC 2606)
 * guaranteed never to resolve, which is what we want: this URL is only ever a
 * cache key and must never actually be fetched. The trailing slash matters —
 * `new Request(...)` normalises a bare-authority URL to add one, and
 * `pruneImageCache`'s keep-set compares against `request.url`, so the constant
 * has to already carry the slash or the custom image would be pruned.
 */
export const CUSTOM_IMAGE_KEY = 'https://custom-background.hub.invalid/';

const openCache = async (): Promise<Cache | null> => {
  try {
    return await caches.open(IMAGE_CACHE_NAME);
  } catch {
    return null;
  }
};

/** Downloads `url` into the cache. Returns false if it could not be stored. */
export const cacheImage = async (url: string): Promise<boolean> => {
  const cache = await openCache();
  if (!cache) return false;

  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    await cache.put(url, response);
    return true;
  } catch (error) {
    console.error('Failed to cache background image:', error);
    return false;
  }
};

/** Stores a user-picked file. Unlike `cacheImage` there is nothing to download. */
export const putCustomImage = async (file: Blob): Promise<boolean> => {
  const cache = await openCache();
  if (!cache) return false;

  try {
    await cache.put(CUSTOM_IMAGE_KEY, new Response(file));
    return true;
  } catch (error) {
    console.error('Failed to store the custom background:', error);
    return false;
  }
};

/**
 * Whether `url` has bytes in the cache, without creating an object URL for them.
 *
 * Cheaper than `getCachedImageSrc` when the answer is all that is needed —
 * an object URL nobody revokes leaks the blob for the lifetime of the page.
 */
export const hasCachedImage = async (url: string): Promise<boolean> => {
  const cache = await openCache();
  if (!cache) return false;

  try {
    return (await cache.match(url)) !== undefined;
  } catch (error) {
    console.error('Failed to look up a cached background image:', error);
    return false;
  }
};

export const hasCustomImage = (): Promise<boolean> => hasCachedImage(CUSTOM_IMAGE_KEY);

/** Object URL for a previously cached image, or null when it is not cached. */
export const getCachedImageSrc = async (url: string): Promise<string | null> => {
  const cache = await openCache();
  if (!cache) return null;

  try {
    const response = await cache.match(url);
    if (!response) return null;
    return URL.createObjectURL(await response.blob());
  } catch (error) {
    console.error('Failed to read cached background image:', error);
    return null;
  }
};

/**
 * Drops background caches written by an older cache format.
 *
 * Safe to call from the service worker: it touches only the CacheStorage API,
 * which exists in worker scope, and never creates object URLs.
 */
export const deleteObsoleteImageCaches = async (): Promise<void> => {
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== IMAGE_CACHE_NAME)
        .map((name) => caches.delete(name)),
    );
  } catch (error) {
    console.error('Failed to clean up old background caches:', error);
  }
};

/** Evicts every cached image except the ones still referenced. */
export const pruneImageCache = async (keepUrls: string[]): Promise<void> => {
  const cache = await openCache();
  if (!cache) return;

  // The custom image is not part of the rotating pool and is never re-downloadable.
  const keep = new Set([...keepUrls, CUSTOM_IMAGE_KEY]);
  const requests = await cache.keys();
  await Promise.all(
    requests.filter((request) => !keep.has(request.url)).map((request) => cache.delete(request)),
  );
};
