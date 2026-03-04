import { useCallback, useEffect, useRef, useState } from 'react';
import { getDailyData, setDailyData } from '../utils/dailyStorage';
import { useSettings } from './useSettings';

export interface BackgroundData {
  url: string;
  location?: string;
  photographer: string;
  photographerUrl: string;
}

const CACHE_KEY = 'daily_bg_data';
const DEFAULT_BG: BackgroundData = {
  url: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?q=90&w=3840&auto=format&fit=crop',
  location: 'Völgy a hegyekben',
  photographer: 'Ismeretlen',
  photographerUrl: '',
};

export const useBackground = () => {
  const { settings, isLoaded } = useSettings();
  const [loading, setLoading] = useState(false);
  const prevQueryRef = useRef(settings.unsplashQuery);
  const [bgData, setBgData] = useState<BackgroundData>(() => {
    const cached = getDailyData<BackgroundData>(CACHE_KEY, prevQueryRef.current);
    return cached || DEFAULT_BG;
  });

  const fetchNewImage = useCallback(
    async (force = false, currentQuery = settings.unsplashQuery) => {
      if (!settings.unsplashKey) return;
      if (!force && getDailyData(CACHE_KEY, prevQueryRef.current)) return;

      setLoading(true);
      try {
        const res = await fetch(
          `https://api.unsplash.com/photos/random?orientation=landscape&query=${currentQuery}&client_id=${settings.unsplashKey}&t=${Date.now()}`,
        );
        if (!res.ok) throw new Error('Unsplash API error');

        const data = await res.json();
        const highResUrl = `${data.urls.raw}&w=3840&q=90&fm=jpg&fit=crop`;

        const newBgData: BackgroundData = {
          url: highResUrl,
          location: data.location?.name || null,
          photographer: data.user.name,
          photographerUrl: data.links.html,
        };

        setDailyData(CACHE_KEY, newBgData, currentQuery);
        setBgData(newBgData);
      } catch (error) {
        console.error('Failed to fetch background:', error);
      } finally {
        setLoading(false);
      }
    },
    [settings.unsplashKey, settings.unsplashQuery],
  );

  useEffect(() => {
    if (!isLoaded || !settings.unsplashKey) return;

    const forceUpdate = prevQueryRef.current !== settings.unsplashQuery;
    fetchNewImage(forceUpdate, settings.unsplashQuery);

    prevQueryRef.current = settings.unsplashQuery;
  }, [fetchNewImage, isLoaded, settings.unsplashKey, settings.unsplashQuery]);

  return {
    bgData,
    refreshBackground: () => fetchNewImage(true),
    loading,
    hasKey: !!settings.unsplashKey,
    isSettingsLoaded: isLoaded,
  };
};
