/**
 * The width a background photo is requested at, chosen for the device rather
 * than fixed at 4K.
 *
 * The Hub API hands out Unsplash URLs that already carry `w`, `q`, `fm` and
 * `fit`. Unsplash documents those URLs as resizable: "Every image returned by
 * the Unsplash API is a dynamic image URL, which means that it can be
 * manipulated to create new transformations of the image by simply adjusting
 * the query parameters of the image URL" (unsplash.com/documentation,
 * "Dynamically resizable images"). So the size is chosen here, by rewriting the
 * URL, and the API response stays the same for every installed version.
 *
 * Shared by the page (`useBackground`) and the service worker
 * (`prefetchBackground`), so both download, cache and look up the same URL.
 * Nothing here reads a page global: the page measures its screen and passes
 * the numbers in, and the worker, which has no screen, reads the bucket the
 * page stored.
 */

/**
 * A fixed list rather than the exact screen width, so the URL (and with it the
 * Cache API key) is the same on every load of a device and only changes when
 * the device moves to another bucket.
 */
export const WIDTH_BUCKETS = [1280, 1920, 2560, 3840] as const;
export type WidthBucket = (typeof WIDTH_BUCKETS)[number];

/** What the service worker assumes before any page has stored a bucket. */
export const DEFAULT_WIDTH_BUCKET: WidthBucket = 1920;

/** Largest bucket; also what a screen wider than every bucket gets. */
const MAX_WIDTH_BUCKET: WidthBucket = WIDTH_BUCKETS[WIDTH_BUCKETS.length - 1];

const BG_WIDTH_KEY = 'bg_width_bucket';

const UNSPLASH_IMAGE_HOST = 'images.unsplash.com';

export interface ScreenSize {
  /** `screen.width`, in CSS pixels. The screen, not the viewport: resizing a window must not change the URL. */
  width: number;
  devicePixelRatio: number;
}

/** The smallest bucket that covers the screen's physical width, capped at the largest. */
export const widthBucketFor = ({ width, devicePixelRatio }: ScreenSize): WidthBucket => {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const physical = width * ratio;
  if (!Number.isFinite(physical) || physical <= 0) return DEFAULT_WIDTH_BUCKET;
  return WIDTH_BUCKETS.find((bucket) => bucket >= physical) ?? MAX_WIDTH_BUCKET;
};

/**
 * JPEG quality per bucket. Below the largest bucket the image is at least as
 * wide as the screen's physical pixels, so it is never enlarged and 80 is
 * enough. The largest bucket also serves every wider screen (5K and up), where
 * the browser enlarges the image and its compression artifacts with it, so it
 * keeps a little more.
 */
const qualityFor = (bucket: WidthBucket): number => (bucket === MAX_WIDTH_BUCKET ? 85 : 80);

const isWidthBucket = (value: unknown): value is WidthBucket =>
  (WIDTH_BUCKETS as readonly unknown[]).includes(value);

/**
 * `url` with its `w` and `q` set for `bucket`; every other parameter, `ixid`
 * (which Unsplash requires every resized URL to keep), `fm` and `fit` among
 * them, is left byte for byte as it was, in its place.
 *
 * Done on the query string rather than through `URLSearchParams`, which would
 * re-encode the parameters it did not touch. A URL that is not an Unsplash
 * image (a bundled or future source) is returned unchanged, since these
 * parameters mean nothing anywhere else.
 */
export const backgroundImageUrl = (url: string, bucket: WidthBucket): string => {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return url;
  }
  if (host !== UNSPLASH_IMAGE_HOST) return url;

  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);

  const wanted: Record<string, string> = { w: String(bucket), q: String(qualityFor(bucket)) };
  const written = new Set<string>();
  const params: string[] = [];
  for (const param of query ? query.split('&') : []) {
    const key = param.split('=')[0];
    if (!(key in wanted)) {
      params.push(param);
    } else if (!written.has(key)) {
      // Replaced in place; a repeated `w` or `q` is dropped, as imgix would
      // otherwise have to pick one of two widths.
      params.push(`${key}=${wanted[key]}`);
      written.add(key);
    }
  }
  for (const key of Object.keys(wanted)) {
    if (!written.has(key)) params.push(`${key}=${wanted[key]}`);
  }

  return `${path}?${params.join('&')}${hash}`;
};

/**
 * The bucket the page last stored for this device, or `DEFAULT_WIDTH_BUCKET`.
 * `chrome.storage.local`, not sync: the bucket belongs to this screen, and a
 * laptop and a 4K desktop signed into one profile must not overwrite each other.
 */
export const readWidthBucket = (): Promise<WidthBucket> =>
  new Promise((resolve) => {
    chrome.storage.local.get([BG_WIDTH_KEY], (items) => {
      const stored: unknown = items[BG_WIDTH_KEY];
      resolve(isWidthBucket(stored) ? stored : DEFAULT_WIDTH_BUCKET);
    });
  });

/**
 * Records `bucket` for the service worker's next prefetch. Writes only when it
 * differs from what is stored, so an ordinary new tab costs a read, not a write.
 */
export const recordWidthBucket = (bucket: WidthBucket): Promise<void> =>
  new Promise((resolve) => {
    chrome.storage.local.get([BG_WIDTH_KEY], (items) => {
      if (items[BG_WIDTH_KEY] === bucket) {
        resolve();
        return;
      }
      chrome.storage.local.set({ [BG_WIDTH_KEY]: bucket }, () => resolve());
    });
  });
