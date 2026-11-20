import type { BackgroundData } from '@hub/shared';
import { useCallback, useEffect, useState } from 'react';
import { backgroundRequestUrl, isUsableBackground } from '../utils/api';
import {
  backgroundImageUrl,
  recordWidthBucket,
  widthBucketFor,
  type WidthBucket,
} from '../utils/backgroundImageSize';
import { getDailyData, getStaleData, setDailyData } from '../utils/dailyStorage';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import {
  CUSTOM_IMAGE_KEY,
  cacheImage,
  getCachedImageSrc,
  hasCachedImage,
  pruneImageCache,
} from '../utils/imageCache';
import { clearPrefetch, readPrefetch, type PrefetchPacket } from '../utils/prefetch';
import { useSettings } from './useSettings';

const CACHE_KEY = 'daily_bg_data';
// Shown straight from its remote URL, never cached through `cacheImage`, so
// `auto=format` is harmless here: the browser that negotiates the format is
// the one that decodes it.
const FALLBACK_BG_BASE_URL =
  'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?q=90&w=3840&auto=format&fit=crop';

/** This device's bucket, from the screen rather than the window, so resizing never refetches. */
const currentWidthBucket = (): WidthBucket =>
  widthBucketFor({ width: screen.width, devicePixelRatio: globalThis.devicePixelRatio });

const EMPTY_BG_DATA: BackgroundData = {
  url: '',
  location: null,
  photographer: '',
  photographerUrl: '',
};

const todayIso = () => new Date().toISOString().split('T')[0];

/** Forgets today's photo metadata; the next load fetches a fresh one. */
export const clearBackgroundCache = (): void => localStorage.removeItem(CACHE_KEY);

export const useBackground = () => {
  const { settings, isLoaded } = useSettings();
  const [loading, setLoading] = useState(false);

  // Paint whatever we have on disk immediately — the effect below revalidates.
  const [bgData, setBgData] = useState<BackgroundData>(
    () => getStaleData<BackgroundData>(CACHE_KEY) ?? EMPTY_BG_DATA,
  );
  // The last cache lookup that answered: which key it was for, and the object
  // URL it produced (null for a miss). Until the first answer there is nothing
  // to show, rather than the remote URL, which would download the photo even
  // when its bytes are already in the Cache API.
  const [resolved, setResolved] = useState<{ key: string; objectUrl: string | null } | null>(
    null,
  );

  // Continues a load once the service worker's hand-off slot has been read, so
  // every state update here comes after an await. Only `loadImage` calls it.
  const fetchNewImage = useCallback(
    async (force: boolean, currentQuery: string, prefetched: PrefetchPacket | null) => {
      let packet = prefetched;
      const bucket = currentWidthBucket();

      // The worker may already have today's image cached.
      if (!force && packet && packet.date === todayIso() && packet.query === currentQuery) {
        // The worker sized the URL with the bucket a page recorded. A packet
        // sized for another one (the screen changed since, or no page had
        // recorded a bucket yet) is the wrong size for this screen, and is
        // dropped below like a pointer whose image is gone.
        const sizedForThisScreen = backgroundImageUrl(packet.data.url, bucket) === packet.data.url;

        // The pointer alone is not enough. The worker writes it only after the
        // bytes land in the Cache API, but Chrome can evict that bucket later
        // without touching `chrome.storage.local` — and adopting an image that
        // is no longer there would write the daily cache, suppress every retry
        // until midnight and leave nothing to render offline. Checking is one
        // local cache lookup; being wrong costs a whole day.
        if (sizedForThisScreen && (await hasCachedImage(packet.data.url))) {
          setBgData(packet.data);
          setDailyData(CACHE_KEY, packet.data, currentQuery);
          await clearPrefetch();
          // Nothing else prunes on this path: a day that ends in an adoption
          // never reaches the fetch below, so yesterday's photo would otherwise
          // stay in the cache forever.
          await pruneImageCache([packet.data.url]);
          return;
        }

        // The pointer outlived its image, or names one of the wrong size. Drop
        // it rather than re-examine it on every load, and fetch the day's
        // background the ordinary way.
        await clearPrefetch();
        packet = null;
      }

      setLoading(true);
      try {
        const data = await fetchWithTimeout(
          backgroundRequestUrl(currentQuery),
          async (res): Promise<BackgroundData> => {
            if (!res.ok) throw new Error('Worker API error');
            const body: unknown = await res.json();
            // Thrown into the failure path below rather than stored: the daily
            // cache would otherwise hold an image-less entry until midnight.
            if (!isUsableBackground(body)) throw new Error('Worker answered without an image URL');
            // Resized before anything stores it, so the cached bytes, the daily
            // metadata and the lookup below all name the same URL.
            return { ...body, url: backgroundImageUrl(body.url, bucket) };
          },
        );
        // Download before publishing. The lookup effect below resolves whatever
        // `bgData` names the moment it changes; publishing first made that
        // lookup miss, which put the remote URL on screen (blank until it
        // loaded) and downloaded the photo a second time for display. When
        // caching fails the photo is still published and shown from its remote
        // URL, the same degraded path as before.
        const cached = await cacheImage(data.url);
        setBgData(data);

        // Only metadata goes to localStorage; the pixels live in the Cache API.
        // Written after the download so a tab closed halfway through it does not
        // leave today's metadata pointing at bytes nobody stored.
        setDailyData(CACHE_KEY, data, currentQuery);

        if (cached) {
          // A packet that is not for today is the worker's work for a later
          // day. Pruning it away would leave a pointer to an image nobody has,
          // which is exactly what the prefetch ordering exists to prevent.
          await pruneImageCache(packet ? [data.url, packet.data.url] : [data.url]);
        }
      } catch (error) {
        console.error('Failed to fetch background:', error);
        setBgData((prev) =>
          prev.url ? prev : { ...EMPTY_BG_DATA, url: backgroundImageUrl(FALLBACK_BG_BASE_URL, bucket) },
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Every caller starts the load and moves on. `fetchNewImage` handles a failed
  // fetch itself, but the prefetch adoption path runs before its `try`, so a
  // failure there (a rejected `pruneImageCache`, say) is logged here instead
  // of going unhandled.
  //
  // The guards are synchronous and set no state; everything that does runs in
  // the callback of the hand-off read. That keeps the revalidation effect from
  // updating state synchronously in its body (`react-hooks/set-state-in-effect`).
  const loadImage = useCallback(
    async (force: boolean, currentQuery: string) => {
      try {
        // Guard the load itself, not just its callers: `refreshBackground` and the
        // revalidation effect both funnel through here, and a custom background must
        // never be silently replaced by a real Unsplash photo fetched under its cover
        // (that photo would render via `cachedSrc` with `bgData` still reporting
        // `EMPTY_BG_DATA`, i.e. an Unsplash image on screen with no attribution).
        if (settings.backgroundSource === 'custom') return;
        if (!force && getDailyData(CACHE_KEY, currentQuery)) return;

        // Read the service worker's hand-off slot once. It decides whether this
        // load can skip the network entirely, and — when it cannot — its image
        // still has to survive the prune further down.
        await readPrefetch().then((packet) => fetchNewImage(force, currentQuery, packet));
      } catch (error) {
        console.error('Failed to fetch background:', error);
      }
    },
    [fetchNewImage, settings.backgroundSource],
  );

  // The service worker has no screen to measure, so it prefetches at whatever
  // bucket a page last recorded here.
  useEffect(() => {
    void recordWidthBucket(currentWidthBucket());
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (settings.backgroundSource === 'custom') return;

    // No force flag needed: the cache packet stores the query it was built for,
    // so a changed query is already a cache miss inside fetchNewImage.
    void loadImage(false, settings.unsplashQuery);
  }, [loadImage, isLoaded, settings.backgroundSource, settings.unsplashQuery]);

  const custom = settings.backgroundSource === 'custom';
  // Nothing is looked up before the settings arrive: until then `custom` reads
  // the default source, and the stale photo in `bgData` would flash up on the
  // page of a user who has since picked their own image.
  const cacheKey = !isLoaded ? '' : custom ? CUSTOM_IMAGE_KEY : bgData.url;

  // Resolve the locally cached copy of whatever image is currently selected.
  // This is the only place that creates an object URL for the page.
  useEffect(() => {
    if (!cacheKey) return;

    let cancelled = false;

    // `getCachedImageSrc` answers a failed lookup with null rather than rejecting.
    void getCachedImageSrc(cacheKey).then((objectUrl) => {
      if (cancelled) {
        // Superseded before it was ever shown, so nothing else will revoke it.
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      // A miss replaces the outgoing image too: a src left over from a
      // *different* key must not keep showing (e.g. "custom" is selected but
      // nothing has been uploaded). What is deliberately not done is clearing
      // it pre-emptively when the key changes: until this lookup answers, the
      // outgoing image is still legitimate to display, and clearing on every
      // key change would blank the background between every rotation.
      setResolved({ key: cacheKey, objectUrl });
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  // An object URL lives exactly as long as it is the one on screen. The cleanup
  // runs after the commit that shows its replacement, so the outgoing image is
  // never revoked while it is still the background; unmount revokes the last
  // one. StrictMode's mount-time re-run cannot revoke a live URL here, because
  // on mount there is none yet.
  const objectUrl = resolved?.objectUrl ?? null;
  useEffect(() => {
    if (!objectUrl) return;
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  // Prefer the local copy: it renders instantly and survives being offline. The
  // remote URL is only a fallback for a lookup that answered with a miss, never
  // a stand-in for a lookup still pending (the previous answer keeps showing
  // instead), and never for a custom background, whose key is not a URL
  // anything should be fetched from.
  const remoteFallback = resolved && !custom && resolved.key !== CUSTOM_IMAGE_KEY ? resolved.key : '';

  return {
    bgData: custom ? EMPTY_BG_DATA : bgData,
    imageSrc: objectUrl ?? remoteFallback,
    refreshBackground: () => loadImage(true, settings.unsplashQuery),
    loading,
    isSettingsLoaded: isLoaded,
  };
};
