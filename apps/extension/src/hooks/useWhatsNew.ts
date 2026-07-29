import { useEffect, useState } from 'react';

const STORAGE_KEY = 'hub_last_seen_version';

export const useWhatsNew = () => {
  const currentVersion = __APP_VERSION__;

  // The initialiser only reads. Marking the version as seen is a side effect and
  // belongs in an effect, so a render React discards cannot silently consume the
  // announcement.
  const [shouldShow, setShouldShow] = useState(
    () => localStorage.getItem(STORAGE_KEY) !== currentVersion,
  );

  useEffect(() => {
    if (shouldShow) localStorage.setItem(STORAGE_KEY, currentVersion);
  }, [shouldShow, currentVersion]);

  const dismiss = () => setShouldShow(false);

  return { shouldShow, currentVersion, dismiss };
};
