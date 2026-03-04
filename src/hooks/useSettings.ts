import { useEffect, useState } from 'react';

export interface HubSettings {
  unsplashKey: string;
  unsplashQuery: string;
}

const DEFAULT_SETTINGS: HubSettings = {
  unsplashKey: '',
  unsplashQuery: 'landscape,forest,mountain,fog,nature view',
};

export const useSettings = () => {
  const [settings, setSettings] = useState<HubSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Betöltés induláskor
    chrome.storage.sync.get(['unsplashKey', 'unsplashQuery'], (res: HubSettings) => {
      setSettings({
        unsplashKey: res.unsplashKey || DEFAULT_SETTINGS.unsplashKey,
        unsplashQuery: res.unsplashQuery || DEFAULT_SETTINGS.unsplashQuery,
      });
      setIsLoaded(true);
    });

    // Feliratkozás a változásokra (ha a popupban módosítanak, a new tab azonnal frissül)
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'sync') {
        setSettings((prev) => ({
          unsplashKey: (changes.unsplashKey?.newValue as string) ?? prev.unsplashKey,
          unsplashQuery: (changes.unsplashQuery?.newValue as string) ?? prev.unsplashQuery,
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
