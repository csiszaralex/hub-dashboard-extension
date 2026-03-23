import { useEffect, useState } from 'react';

export interface HubSettings {
  unsplashQuery: string;
  locationCity: string;
  locationLat: number | null;
  locationLon: number | null;
  selectedCalendars: string[];
  countdownTarget: string | null;
}

const DEFAULT_SETTINGS: HubSettings = {
  unsplashQuery: 'landscape,forest,mountain,fog,nature view',
  locationCity: '',
  locationLat: null,
  locationLon: null,
  selectedCalendars: ['primary'],
  countdownTarget: null,
};

export const useSettings = () => {
  const [settings, setSettings] = useState<HubSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    chrome.storage.sync.get(
      Object.keys(DEFAULT_SETTINGS) as (keyof HubSettings)[],
      (res: HubSettings) => {
        setSettings({
          unsplashQuery: res.unsplashQuery ?? DEFAULT_SETTINGS.unsplashQuery,
          locationCity: res.locationCity ?? DEFAULT_SETTINGS.locationCity,
          locationLat: res.locationLat ?? DEFAULT_SETTINGS.locationLat,
          locationLon: res.locationLon ?? DEFAULT_SETTINGS.locationLon,
          selectedCalendars: res.selectedCalendars ?? DEFAULT_SETTINGS.selectedCalendars,
          countdownTarget: res.countdownTarget ?? DEFAULT_SETTINGS.countdownTarget,
        });
        setIsLoaded(true);
      },
    );

    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'sync') {
        setSettings((prev) => ({
          unsplashQuery: (changes.unsplashQuery?.newValue as string) ?? prev.unsplashQuery,
          locationCity: (changes.locationCity?.newValue as string) ?? prev.locationCity,
          locationLat: (changes.locationLat?.newValue as number | null) ?? prev.locationLat,
          locationLon: (changes.locationLon?.newValue as number | null) ?? prev.locationLon,
          selectedCalendars:
            (changes.selectedCalendars?.newValue as string[]) ?? prev.selectedCalendars,
          countdownTarget:
            (changes.countdownTarget?.newValue as string | null) ?? prev.countdownTarget,
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
