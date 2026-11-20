import { describe, expect, it } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import {
  DEFAULT_WIDTH_BUCKET,
  backgroundImageUrl,
  readWidthBucket,
  recordWidthBucket,
  widthBucketFor,
} from './backgroundImageSize';

/**
 * Shaped like what `toPooledPhoto` in apps/api/src/background.ts hands out:
 * Unsplash's `urls.raw` (path, `ixid`, `ixlib`) with the worker's own
 * parameters appended. The `ixid` value is made up.
 */
const RAW =
  'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?ixid=M3w2NTQzMjF8MHwxfHNlYXJjaHwxfHxmb3Jlc3R8ZW58MHx8fHwxNzYzNjAwMDAwfDA&ixlib=rb-4.1.0';
const API_URL = `${RAW}&w=3840&q=90&fm=jpg&fit=crop`;

describe('widthBucketFor', () => {
  it.each([
    ['1366×768 @1', 1366, 1, 1920],
    ['1920×1080 @1', 1920, 1, 1920],
    ['1440×900 @2', 1440, 2, 3840],
    ['2560×1440 @1', 2560, 1, 2560],
    ['3840×2160 @1', 3840, 1, 3840],
    ['5120×2880 @1 (5K)', 5120, 1, 3840],
    ['2560×1440 @2 (5K as a Retina display reports it)', 2560, 2, 3840],
    ['1280×800 @1', 1280, 1, 1280],
    ['1024×768 @1', 1024, 1, 1280],
    ['1536×864 @1.25 (a 1920 panel scaled to 125%)', 1536, 1.25, 1920],
  ])('puts a %s screen in its bucket', (_label, width, devicePixelRatio, bucket) => {
    expect(widthBucketFor({ width, devicePixelRatio })).toBe(bucket);
  });

  it.each([
    ['a zero width', 0, 1],
    ['a missing ratio', 1920, Number.NaN],
  ])('falls back sensibly for %s', (_label, width, devicePixelRatio) => {
    expect(widthBucketFor({ width, devicePixelRatio })).toBe(DEFAULT_WIDTH_BUCKET);
  });
});

describe('backgroundImageUrl', () => {
  it('replaces only w and q, in place, and keeps every other parameter byte for byte', () => {
    expect(backgroundImageUrl(API_URL, 1920)).toBe(`${RAW}&w=1920&q=80&fm=jpg&fit=crop`);
  });

  it('keeps more quality in the largest bucket', () => {
    expect(backgroundImageUrl(API_URL, 3840)).toBe(`${RAW}&w=3840&q=85&fm=jpg&fit=crop`);
  });

  it('is idempotent, so a URL sized once is recognised as sized', () => {
    const once = backgroundImageUrl(API_URL, 2560);
    expect(backgroundImageUrl(once, 2560)).toBe(once);
    expect(backgroundImageUrl(once, 1920)).not.toBe(once);
  });

  it('adds w and q to a URL that has neither', () => {
    expect(backgroundImageUrl(RAW, 1280)).toBe(`${RAW}&w=1280&q=80`);
    expect(backgroundImageUrl('https://images.unsplash.com/photo-1', 1280)).toBe(
      'https://images.unsplash.com/photo-1?w=1280&q=80',
    );
  });

  it('does not mistake a parameter that only starts with w or q for them', () => {
    expect(backgroundImageUrl('https://images.unsplash.com/p?wx=1&qq=2&w=3840', 1920)).toBe(
      'https://images.unsplash.com/p?wx=1&qq=2&w=1920&q=80',
    );
  });

  it('collapses a repeated w into one', () => {
    expect(backgroundImageUrl('https://images.unsplash.com/p?w=1&w=2&q=90', 1920)).toBe(
      'https://images.unsplash.com/p?w=1920&q=80',
    );
  });

  it.each([
    ['another host', 'https://example.com/photo.jpg?w=3840&q=90'],
    ['an uploaded background key', 'https://custom-background.hub.invalid/'],
    ['something that is not a URL', 'not a url'],
  ])('leaves %s alone', (_label, url) => {
    expect(backgroundImageUrl(url, 1920)).toBe(url);
  });

  it('asks a 1920×1080 @1 screen for a quarter of the pixels the API URL asks for', () => {
    // The measurement the change exists for: width 3840 → 1920 at the same
    // aspect ratio (`fit=crop` with no `h` keeps the photo's own) is half the
    // width and a quarter of the pixels to download and decode.
    const before = new URL(API_URL).searchParams.get('w');
    const after = new URL(
      backgroundImageUrl(API_URL, widthBucketFor({ width: 1920, devicePixelRatio: 1 })),
    ).searchParams.get('w');
    expect([before, after]).toEqual(['3840', '1920']);
  });
});

describe('the stored width bucket', () => {
  it('reads as the default when no page has recorded one', async () => {
    installChromeStub();
    expect(await readWidthBucket()).toBe(DEFAULT_WIDTH_BUCKET);
  });

  it('reads back what the page recorded', async () => {
    installChromeStub();
    await recordWidthBucket(2560);
    expect(await readWidthBucket()).toBe(2560);
  });

  it('does not write when the bucket is unchanged', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedLocal({ bg_width_bucket: 1920 });
    const writes: string[][] = [];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') writes.push(Object.keys(changes));
    });

    await recordWidthBucket(1920);

    expect(writes).toEqual([]);
  });

  it('gives the page and the worker the same URL for the same bucket', async () => {
    // The page sizes with the bucket it measured, the worker with the one it
    // reads back; both go through `backgroundImageUrl`.
    installChromeStub();
    const pageBucket = widthBucketFor({ width: 2560, devicePixelRatio: 1 });
    await recordWidthBucket(pageBucket);

    expect(backgroundImageUrl(API_URL, await readWidthBucket())).toBe(
      backgroundImageUrl(API_URL, pageBucket),
    );
  });
});
