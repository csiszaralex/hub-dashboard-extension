import type { BackgroundData } from '@hub/shared';
import { useCallback, useEffect, useState } from 'react';
import { backgroundRequestUrl } from '../utils/api';
import { getDailyData, getStaleData, setDailyData } from '../utils/dailyStorage';
import {
  CUSTOM_IMAGE_KEY,
  cacheImage,
  getCachedImageSrc,
  hasCachedImage,
  pruneImageCache,
} from '../utils/imageCache';
import { clearPrefetch, readPrefetch } from '../utils/prefetch';
import { useSettings } from './useSettings';

const CACHE_KEY = 'daily_bg_data';
const FALLBACK_BG_URL =
  'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?q=90&w=3840&auto=format&fit=crop';

const EMPTY_BG_DATA: BackgroundData = {
  url: '',
  location: null,
  photographer: '',
  photographerUrl: '',
};

const todayIso = () => new Date().toISOString().split('T')[0];

export const useBackground = () => {
  const { settings, isLoaded } = useSettings();
  const [loading, setLoading] = useState(false);

  // Paint whatever we have on disk immediately — the effect below revalidates.
  const [bgData, setBgData] = useState<BackgroundData>(
    () => getStaleData<BackgroundData>(CACHE_KEY) ?? EMPTY_BG_DATA,
  );
  const [cachedSrc, setCachedSrc] = useState<string | null>(null);

  const fetchNewImage = useCallback(
    async (force = false, currentQuery = settings.unsplashQuery) => {
      // Guard the fetch itself, not just its callers: `refreshBackground` and the
      // revalidation effect both funnel through here, and a custom background must
      // never be silently replaced by a real Unsplash photo fetched under its cover
      // (that photo would render via `cachedSrc` with `bgData` still reporting
      // `EMPTY_BG_DATA`, i.e. an Unsplash image on screen with no attribution).
      if (settings.backgroundSource === 'custom') return;
      if (!force && getDailyData(CACHE_KEY, currentQuery)) return;

      // Read the service worker's hand-off slot once. It decides whether this
      // load can skip the network entirely, and — when it cannot — its image
      // still has to survive the prune further down.
      let packet = await readPrefetch();

      // The worker may already have today's image cached.
      if (!force && packet && packet.date === todayIso() && packet.query === currentQuery) {
        // The pointer alone is not enough. The worker writes it only after the
        // bytes land in the Cache API, but Chrome can evict that bucket later
        // without touching `chrome.storage.local` — and adopting an image that
        // is no longer there would write the daily cache, suppress every retry
        // until midnight and leave nothing to render offline. Checking is one
        // local cache lookup; being wrong costs a whole day.
        if (await hasCachedImage(packet.data.url)) {
          setBgData(packet.data);
          setDailyData(CACHE_KEY, packet.data, currentQuery);
          await clearPrefetch();
          // Nothing else prunes on this path: a day that ends in an adoption
          // never reaches the fetch below, so yesterday's photo would otherwise
          // stay in the cache forever.
          await pruneImageCache([packet.data.url]);
          return;
        }

        // The pointer outlived its image. Drop it rather than re-examine it on
        // every load, and fetch the day's background the ordinary way.
        await clearPrefetch();
        packet = null;
      }

      setLoading(true);
      try {
        const res = await fetch(backgroundRequestUrl(currentQuery));
        if (!res.ok) throw new Error('Worker API error');

        const data: BackgroundData = await res.json();
        setBgData(data);

        // Only metadata goes to localStorage; the pixels live in the Cache API.
        setDailyData(CACHE_KEY, data, currentQuery);

        if (await cacheImage(data.url)) {
          setCachedSrc(await getCachedImageSrc(data.url));
          // A packet that is not for today is the worker's work for a later
          // day. Pruning it away would leave a pointer to an image nobody has,
          // which is exactly what the prefetch ordering exists to prevent.
          await pruneImageCache(packet ? [data.url, packet.data.url] : [data.url]);
        }
      } catch (error) {
        console.error('Failed to fetch background:', error);
        setBgData((prev) => (prev.url ? prev : { ...EMPTY_BG_DATA, url: FALLBACK_BG_URL }));
      } finally {
        setLoading(false);
      }
    },
    [settings.backgroundSource, settings.unsplashQuery],
  );

  useEffect(() => {
    if (!isLoaded) return;
    if (settings.backgroundSource === 'custom') return;

    // No force flag needed: the cache packet stores the query it was built for,
    // so a changed query is already a cache miss inside fetchNewImage.
    fetchNewImage(false, settings.unsplashQuery);
  }, [fetchNewImage, isLoaded, settings.backgroundSource, settings.unsplashQuery]);

  const custom = settings.backgroundSource === 'custom';
  const cacheKey = custom ? CUSTOM_IMAGE_KEY : bgData.url;

  // Resolve the locally cached copy of whatever image is currently selected.
  useEffect(() => {
    if (!cacheKey) return;

    let revoked = false;
    let objectUrl: string | null = null;

    getCachedImageSrc(cacheKey).then((src) => {
      if (revoked) {
        if (src) URL.revokeObjectURL(src);
        return;
      }
      if (!src) {
        // Resolution for this key genuinely failed — e.g. "custom" is selected
        // but nothing has been uploaded. A src left over from a *different* key
        // must not keep showing, so clear it here. This is deliberately not a
        // pre-emptive clear at the top of the effect: an ordinary Unsplash
        // rotation resolves successfully, and until it does, the outgoing image
        // is still legitimate to display — clearing on every key change instead
        // of only on failure would blank the background between every rotation.
        setCachedSrc(null);
        return;
      }
      objectUrl = src;
      setCachedSrc(src);
    });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cacheKey]);

  return {
    bgData: custom ? EMPTY_BG_DATA : bgData,
    // Prefer the local copy: it renders instantly and survives being offline.
    imageSrc: cachedSrc ?? (custom ? '' : bgData.url) ?? '',
    refreshBackground: () => fetchNewImage(true, settings.unsplashQuery),
    loading,
    isSettingsLoaded: isLoaded,
  };
};
