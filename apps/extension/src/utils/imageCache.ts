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

  const keep = new Set(keepUrls);
  const requests = await cache.keys();
  await Promise.all(
    requests.filter((request) => !keep.has(request.url)).map((request) => cache.delete(request)),
  );
};
