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
