import { useEffect, useState, useCallback } from 'react';
import { getDailyData, setDailyData } from '../utils/dailyStorage';

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
  // Loading state a gomb visszajelzéséhez
  const [loading, setLoading] = useState(false);

  const [bgData, setBgData] = useState<BackgroundData>(() => {
    const cached = getDailyData<BackgroundData>(CACHE_KEY);
    return cached || DEFAULT_BG;
  });

  // A lekérő függvényt useCallback-be tesszük, hogy stabil maradjon
  const fetchNewImage = useCallback(async (force = false) => {
    // Ha nem kényszerített frissítés és van cache, akkor ne csináljon semmit
    if (!force && getDailyData(CACHE_KEY)) return;

    const accessKey = import.meta.env.VITE_UNSPLASH_ACCESS_KEY;
    if (!accessKey) return;

    setLoading(true);
    try {
      const query = 'landscape,forest,mountain,fog,nature view';
      // Hozzáadunk egy timestamp-et, hogy elkerüljük a böngésző cache-elését
      const res = await fetch(
        `https://api.unsplash.com/photos/random?orientation=landscape&query=${query}&client_id=${accessKey}&t=${Date.now()}`,
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

      setDailyData(CACHE_KEY, newBgData);
      setBgData(newBgData);
    } catch (error) {
      console.error('Failed to fetch background:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initkor lefut (force = false)
  useEffect(() => {
    fetchNewImage();
  }, [fetchNewImage]);

  // Visszaadjuk a refresh függvényt is
  return {
    bgData,
    refreshBackground: () => fetchNewImage(true),
    loading,
  };
};
