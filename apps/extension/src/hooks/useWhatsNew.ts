import { useEffect, useState } from 'react';

const STORAGE_KEY = 'hub_last_seen_version';

export const useWhatsNew = () => {
  const currentVersion = __APP_VERSION__;

  // Captured once, before the effect below overwrites it, because it is the
  // only record of where the user is catching up from — the modal needs the
  // whole range from here to `currentVersion`, not just the newest release.
  // Null on a first install.
  const [lastSeenVersion] = useState(() => localStorage.getItem(STORAGE_KEY));

  // The initialiser only reads. Marking the version as seen is a side effect and
  // belongs in an effect, so a render React discards cannot silently consume the
  // announcement.
  const [shouldShow, setShouldShow] = useState(() => lastSeenVersion !== currentVersion);

  useEffect(() => {
    if (shouldShow) localStorage.setItem(STORAGE_KEY, currentVersion);
  }, [shouldShow, currentVersion]);

  const dismiss = () => setShouldShow(false);

  return { shouldShow, currentVersion, lastSeenVersion, dismiss };
};
