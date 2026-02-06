import { useEffect, useState } from 'react';
import { getDailyData, setDailyData } from '../utils/dailyStorage';

export interface BackgroundData {
  url: string;
  location?: string;
  photographer: string;
  photographerUrl: string;
}

const CACHE_KEY = 'daily_bg_data';

// Default fallback: Megnövelt felbontás (w=3840) és minőség (q=90)
const DEFAULT_BG: BackgroundData = {
  url: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?q=90&w=3840&auto=format&fit=crop',
  location: 'Völgy a hegyekben',
  photographer: 'Ismeretlen',
  photographerUrl: '',
};

export const useBackground = () => {
  const [bgData, setBgData] = useState<BackgroundData>(() => {
    const cached = getDailyData<BackgroundData>(CACHE_KEY);
    return cached || DEFAULT_BG;
  });

  useEffect(() => {
    if (getDailyData(CACHE_KEY)) return;

    const fetchImage = async () => {
      const accessKey = import.meta.env.VITE_UNSPLASH_ACCESS_KEY;
      if (!accessKey) return;

      try {
        const query = 'landscape,forest,mountain,fog,nature view';
        const res = await fetch(
          `https://api.unsplash.com/photos/random?orientation=landscape&query=${query}&client_id=${accessKey}`,
        );
        if (!res.ok) throw new Error('Unsplash API error');

        const data = await res.json();

        // TRÜKK: Az Unsplash 'raw' URL-jét használjuk, és mi mondjuk meg a méretet.
        // w=3840: 4K szélesség
        // q=90: Magas JPEG minőség
        // fm=jpg: Formátum kényszerítése
        // fit=crop: Vágás, ha szükséges
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
      }
    };

    fetchImage();
  }, []);

  return bgData;
};
