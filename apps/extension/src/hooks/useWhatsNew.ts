import { useEffect, useState } from 'react';
import { useSettings } from './useSettings';

const STORAGE_KEY = 'hub_last_seen_version';

/**
 * What the page has to say about the running version: a welcome on a first
 * install, the release notes after an update, nothing otherwise.
 */
export type Announcement = 'welcome' | 'releaseNotes' | null;

export const useWhatsNew = () => {
  const currentVersion = __APP_VERSION__;
  // The settings store's one read of `chrome.storage.sync`, not a second one.
  const { isLoaded, hadStoredSettings } = useSettings();

  // Captured once, before the effect below overwrites it, because it is the
  // only record of where the user is catching up from — the modal needs the
  // whole range from here to `currentVersion`, not just the newest release.
  // Null on a first install, and also after the user cleared the site data.
  const [lastSeenVersion] = useState(() => localStorage.getItem(STORAGE_KEY));
  const [dismissed, setDismissed] = useState(false);

  // No recorded version alone does not make a new user: clearing the site data
  // empties `localStorage` too, and a second machine starts without it. Synced
  // settings tell those apart. Such a user is shown nothing, since there is no
  // range to show release notes for and the welcome would explain what they
  // already know. Undecided until the store has loaded, as `App` renders
  // nothing before that anyway.
  let announcement: Announcement = null;
  if (isLoaded && !dismissed && lastSeenVersion !== currentVersion) {
    if (lastSeenVersion !== null) announcement = 'releaseNotes';
    else if (!hadStoredSettings) announcement = 'welcome';
  }

  // Release notes count as seen once shown, and a returning user without a
  // recorded version is caught up silently. The welcome is the exception: it
  // records the version only when dismissed, so a first tab closed without
  // reading it does not use it up. Writing is a side effect and belongs in an
  // effect, so a render React discards cannot silently consume anything.
  const recordsOnLoad = isLoaded && lastSeenVersion !== currentVersion && announcement !== 'welcome';
  useEffect(() => {
    if (recordsOnLoad) localStorage.setItem(STORAGE_KEY, currentVersion);
  }, [recordsOnLoad, currentVersion]);

  const dismiss = () => {
    if (announcement === 'welcome') localStorage.setItem(STORAGE_KEY, currentVersion);
    setDismissed(true);
  };

  return { announcement, currentVersion, lastSeenVersion, dismiss };
};
