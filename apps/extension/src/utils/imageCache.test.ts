import { describe, expect, it, vi } from 'vitest';
import { cacheImage, getCachedImageSrc, pruneImageCache } from './imageCache';

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

  it('drops cached images that are no longer referenced', async () => {
    stubImageFetch();
    await cacheImage(REMOTE);
    await cacheImage(OTHER);

    await pruneImageCache([OTHER]);

    expect(await getCachedImageSrc(REMOTE)).toBeNull();
    expect(await getCachedImageSrc(OTHER)).toBeTypeOf('string');
  });
});
