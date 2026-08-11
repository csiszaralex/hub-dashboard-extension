import { describe, expect, it, vi } from 'vitest';
import {
  CUSTOM_IMAGE_KEY,
  IMAGE_CACHE_NAME,
  cacheImage,
  deleteObsoleteImageCaches,
  getCachedImageSrc,
  hasCustomImage,
  pruneImageCache,
  putCustomImage,
} from './imageCache';

const REMOTE = 'https://images.unsplash.com/photo-a?w=3840';
const OTHER = 'https://images.unsplash.com/photo-b?w=3840';

const stubImageFetch = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Blob(['bytes'], { type: 'image/jpeg' }))),
  );

describe('imageCache', () => {
  it('returns null for an image that was never cached', async () => {
    expect(await getCachedImageSrc(REMOTE)).toBeNull();
  });

  it('serves a local object URL after the image has been cached', async () => {
    stubImageFetch();

    await cacheImage(REMOTE);
    const src = await getCachedImageSrc(REMOTE);

    expect(src).toBeTypeOf('string');
    expect(src).not.toContain('unsplash.com');
  });

  it('serves the cached image when the network is unavailable', async () => {
    stubImageFetch();
    await cacheImage(REMOTE);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(await getCachedImageSrc(REMOTE)).toBeTypeOf('string');
  });

  it('reports failure instead of throwing when the image cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(await cacheImage(REMOTE)).toBe(false);
  });

  it('removes background caches left behind by earlier versions', async () => {
    await caches.open('hub-background-v0');
    await caches.open(IMAGE_CACHE_NAME);
    await caches.open('unrelated-cache');

    await deleteObsoleteImageCaches();

    expect(await caches.keys()).toEqual([IMAGE_CACHE_NAME, 'unrelated-cache']);
  });

  it('drops cached images that are no longer referenced', async () => {
    stubImageFetch();
    await cacheImage(REMOTE);
    await cacheImage(OTHER);

    await pruneImageCache([OTHER]);

    expect(await getCachedImageSrc(REMOTE)).toBeNull();
    expect(await getCachedImageSrc(OTHER)).toBeTypeOf('string');
  });

  it('stores a user-supplied image without going to the network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('must not fetch a local file');
      }),
    );

    const stored = await putCustomImage(new Blob(['own-bytes'], { type: 'image/png' }));

    expect(stored).toBe(true);
    expect(await getCachedImageSrc(CUSTOM_IMAGE_KEY)).toBeTypeOf('string');
  });

  it('reports whether a custom image is present', async () => {
    expect(await hasCustomImage()).toBe(false);

    await putCustomImage(new Blob(['own-bytes'], { type: 'image/png' }));

    expect(await hasCustomImage()).toBe(true);
  });

  it("carries the user's own image forward when an older bucket is dropped", async () => {
    // The uploaded background shares a bucket with the rotating Unsplash pool
    // but, unlike those photos, exists nowhere else — so a cache version bump
    // must not delete it along with the bucket it happens to live in.
    const previous = await caches.open('hub-background-v0');
    await previous.put(CUSTOM_IMAGE_KEY, new Response(new Blob(['own-bytes'])));
    await caches.open(IMAGE_CACHE_NAME);

    await deleteObsoleteImageCaches();

    expect(await caches.has('hub-background-v0')).toBe(false);
    expect(await hasCustomImage()).toBe(true);
    // The bytes, not just the key: a rescue that stored an empty response would
    // satisfy `hasCustomImage` and still leave the user with a blank background.
    const rescued = await (await caches.open(IMAGE_CACHE_NAME)).match(CUSTOM_IMAGE_KEY);
    expect(await rescued?.text()).toBe('own-bytes');
  });

  it('leaves a newer upload alone when an older bucket also holds one', async () => {
    const previous = await caches.open('hub-background-v0');
    await previous.put(CUSTOM_IMAGE_KEY, new Response(new Blob(['stale-bytes'])));
    await putCustomImage(new Blob(['fresh-bytes'], { type: 'image/png' }));

    await deleteObsoleteImageCaches();

    const kept = await (await caches.open(IMAGE_CACHE_NAME)).match(CUSTOM_IMAGE_KEY);
    expect(await kept?.text()).toBe('fresh-bytes');
  });

  it('discards an obsolete bucket that holds no custom image', async () => {
    // The rescue must not become a reason to keep dead buckets around.
    const previous = await caches.open('hub-background-v0');
    await previous.put(REMOTE, new Response(new Blob(['bytes'])));

    await deleteObsoleteImageCaches();

    expect(await caches.has('hub-background-v0')).toBe(false);
    expect(await hasCustomImage()).toBe(false);
  });

  it('keeps the custom image when unreferenced Unsplash photos are pruned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['bytes'], { type: 'image/jpeg' }))),
    );
    await cacheImage(REMOTE);
    await putCustomImage(new Blob(['own-bytes'], { type: 'image/png' }));

    await pruneImageCache([]);

    expect(await getCachedImageSrc(CUSTOM_IMAGE_KEY)).toBeTypeOf('string');
    expect(await getCachedImageSrc(REMOTE)).toBeNull();
  });
});
