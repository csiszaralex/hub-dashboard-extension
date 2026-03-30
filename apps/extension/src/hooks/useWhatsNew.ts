import { useState } from 'react';

const STORAGE_KEY = 'hub_last_seen_version';

export const useWhatsNew = () => {
  const currentVersion = __APP_VERSION__;

  const [shouldShow, setShouldShow] = useState(() => {
    const lastSeen = localStorage.getItem(STORAGE_KEY);
    if (lastSeen !== currentVersion) {
      localStorage.setItem(STORAGE_KEY, currentVersion);
      return true;
    }
    return false;
  });

  const dismiss = () => setShouldShow(false);

  return { shouldShow, currentVersion, dismiss };
};
