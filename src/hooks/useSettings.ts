import { useEffect, useState } from 'react';

export interface HubSettings {
  unsplashKey: string;
  unsplashQuery: string;
  locationCity: string;
  locationLat: number | null;
  locationLon: number | null;
}

const DEFAULT_SETTINGS: HubSettings = {
  unsplashKey: '',
  unsplashQuery: 'landscape,forest,mountain,fog,nature view',
  locationCity: '',
  locationLat: null,
  locationLon: null,
};

export const useSettings = () => {
  const [settings, setSettings] = useState<HubSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Betöltés induláskor
    chrome.storage.sync.get(
      Object.keys(DEFAULT_SETTINGS) as (keyof HubSettings)[],
      (res: HubSettings) => {
        setSettings({
          unsplashKey: res.unsplashKey ?? DEFAULT_SETTINGS.unsplashKey,
          unsplashQuery: res.unsplashQuery ?? DEFAULT_SETTINGS.unsplashQuery,
          locationCity: res.locationCity ?? DEFAULT_SETTINGS.locationCity,
          locationLat: res.locationLat ?? DEFAULT_SETTINGS.locationLat,
          locationLon: res.locationLon ?? DEFAULT_SETTINGS.locationLon,
        });
        setIsLoaded(true);
      },
    );

    // Feliratkozás a változásokra (ha a popupban módosítanak, a new tab azonnal frissül)
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'sync') {
        setSettings((prev) => ({
          unsplashKey: (changes.unsplashKey?.newValue as string) ?? prev.unsplashKey,
          unsplashQuery: (changes.unsplashQuery?.newValue as string) ?? prev.unsplashQuery,
          locationCity: (changes.locationCity?.newValue as string) ?? prev.locationCity,
          locationLat: (changes.locationLat?.newValue as number | null) ?? prev.locationLat,
          locationLon: (changes.locationLon?.newValue as number | null) ?? prev.locationLon,
        }));
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const saveSettings = (newSettings: Partial<HubSettings>) => {
    chrome.storage.sync.set(newSettings);
  };

  return { settings, isLoaded, saveSettings };
};
