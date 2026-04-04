import type { BackgroundData } from '@hub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDailyData, getTodayData, setDailyData } from '../utils/dailyStorage';
import { useSettings } from './useSettings';

const CACHE_KEY = 'daily_bg_data';
const WORKER_URL = 'https://hub-api.csiszaralex.workers.dev/api/background';

const DEFAULT_BG: BackgroundData = {
  url: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?q=90&w=3840&auto=format&fit=crop',
  location: 'Völgy a hegyekben',
  photographer: 'Ismeretlen',
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
  const prevQueryRef = useRef<string | undefined>(undefined);

  const [bgData, setBgData] = useState<BackgroundData>(
    () => getTodayData<BackgroundData>(CACHE_KEY) ?? DEFAULT_BG,
  );

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
      } finally {
        setLoading(false);
      }
    },
    [settings.unsplashQuery],
  );

  useEffect(() => {
    if (!isLoaded) return;

    const currentQuery = settings.unsplashQuery;
    const forceUpdate = prevQueryRef.current !== undefined && prevQueryRef.current !== currentQuery;
    prevQueryRef.current = currentQuery;
    fetchNewImage(forceUpdate, currentQuery);
  }, [fetchNewImage, isLoaded, settings.unsplashQuery]);

  return {
    bgData,
    refreshBackground: () => fetchNewImage(true, settings.unsplashQuery),
    loading,
    isSettingsLoaded: isLoaded,
  };
};
