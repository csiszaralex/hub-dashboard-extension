import { useEffect, useState } from 'react';

declare global {
  interface Window {
    chrome?: {
      topSites: {
        get: (callback: (sites: Site[]) => void) => void;
      };
    };
  }
}

export interface Site {
  title: string;
  url: string;
}

const mockSites: Site[] = [
  { title: 'GitHub', url: 'https://github.com' },
  { title: 'YouTube', url: 'https://youtube.com' },
  { title: 'Gmail', url: 'https://mail.google.com' },
  { title: 'ChatGPT', url: 'https://chat.openai.com' },
  { title: 'Stack Overflow', url: 'https://stackoverflow.com' },
];

export const useTopSites = () => {
  const [sites, setSites] = useState<Site[]>(mockSites);

  useEffect(() => {
    // Ellenőrizzük, hogy Chrome környezetben vagyunk-e
    if (typeof window !== 'undefined' && window.chrome?.topSites) {
      window.chrome.topSites.get((data) => {
        // Csak az első 5-öt kérjük el, hogy ne legyen zsúfolt
        setSites(data.slice(0, 5));
      });
    }
  }, []);

  return sites;
};
