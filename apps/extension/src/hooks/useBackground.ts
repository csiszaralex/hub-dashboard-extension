import type { BackgroundData } from '@hub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDailyData, setDailyData } from '../utils/dailyStorage';
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

const fetchImageAsBase64 = async (url: string): Promise<string | undefined> => {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Failed to cache image locally:', e);
    return undefined;
  }
};

export const useBackground = () => {
  const { settings, isLoaded } = useSettings();
  const [loading, setLoading] = useState(false);
  const prevQueryRef = useRef(settings.unsplashQuery);

  const [bgData, setBgData] = useState<BackgroundData>(() => {
    return getDailyData<BackgroundData>(CACHE_KEY, prevQueryRef.current) || EMPTY_BG_DATA;
  });

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

        const localImageBase64 = await fetchImageAsBase64(data.url);

        const newBgData: BackgroundData = {
          ...data,
          localImage: localImageBase64,
        };

        setDailyData(CACHE_KEY, newBgData, currentQuery);
        setBgData(newBgData);
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

    const forceUpdate = prevQueryRef.current !== settings.unsplashQuery;
    fetchNewImage(forceUpdate, settings.unsplashQuery);

    prevQueryRef.current = settings.unsplashQuery;
  }, [fetchNewImage, isLoaded, settings.unsplashQuery]);

  return {
    bgData,
    refreshBackground: () => fetchNewImage(true, settings.unsplashQuery),
    loading,
    isSettingsLoaded: isLoaded,
  };
};

