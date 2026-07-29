import type { BackgroundData } from '@hub/shared';
import { useCallback, useEffect, useState } from 'react';
import { getDailyData, getStaleData, setDailyData } from '../utils/dailyStorage';
import { cacheImage, getCachedImageSrc, pruneImageCache } from '../utils/imageCache';
import { useSettings } from './useSettings';

const CACHE_KEY = 'daily_bg_data';
const WORKER_URL = 'https://hub-api.csiszaralex.workers.dev/api/background';
const FALLBACK_BG_URL =
  'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?q=90&w=3840&auto=format&fit=crop';

const EMPTY_BG_DATA: BackgroundData = {
  url: '',
  location: null,
  photographer: '',
  photographerUrl: '',
};

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
      if (!force && getDailyData(CACHE_KEY, currentQuery)) return;

      setLoading(true);
      try {
        const url = new URL(WORKER_URL);
        if (currentQuery) {
          url.searchParams.set('tags', currentQuery);
        }

        const res = await fetch(url.toString());
        if (!res.ok) throw new Error('Worker API error');

        const data: BackgroundData = await res.json();
        setBgData(data);

        // Only metadata goes to localStorage; the pixels live in the Cache API.
        setDailyData(CACHE_KEY, data, currentQuery);

        if (await cacheImage(data.url)) {
          setCachedSrc(await getCachedImageSrc(data.url));
          await pruneImageCache([data.url]);
        }
      } catch (error) {
        console.error('Failed to fetch background:', error);
        setBgData((prev) => (prev.url ? prev : { ...EMPTY_BG_DATA, url: FALLBACK_BG_URL }));
      } finally {
        setLoading(false);
      }
    },
    [settings.unsplashQuery],
  );

  useEffect(() => {
    if (!isLoaded) return;

    // No force flag needed: the cache packet stores the query it was built for,
    // so a changed query is already a cache miss inside fetchNewImage.
    fetchNewImage(false, settings.unsplashQuery);
  }, [fetchNewImage, isLoaded, settings.unsplashQuery]);

  // Resolve the locally cached copy of whatever image is currently selected.
  useEffect(() => {
    if (!bgData.url) return;

    let revoked = false;
    let objectUrl: string | null = null;

    getCachedImageSrc(bgData.url).then((src) => {
      if (!src) return;
      if (revoked) {
        URL.revokeObjectURL(src);
        return;
      }
      objectUrl = src;
      setCachedSrc(src);
    });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bgData.url]);

  return {
    bgData,
    // Prefer the local copy: it renders instantly and survives being offline.
    imageSrc: cachedSrc ?? bgData.url ?? '',
    refreshBackground: () => fetchNewImage(true, settings.unsplashQuery),
    loading,
    isSettingsLoaded: isLoaded,
  };
};
