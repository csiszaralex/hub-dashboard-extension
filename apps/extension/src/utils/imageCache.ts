/**
 * Background images live in the Cache API, not in localStorage.
 *
 * A 3840px JPEG is 1–4 MB; base64-encoding it into localStorage inflates it by
 * a third and blows the 5–10 MB origin quota, after which every write throws
 * and the image silently re-downloads on every load. The Cache API stores the
 * response as a blob, has its own (far larger) quota, and needs no encoding.
 */
const CACHE_NAME = 'hub-background-v1';

const openCache = async (): Promise<Cache | null> => {
  try {
    return await caches.open(CACHE_NAME);
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
