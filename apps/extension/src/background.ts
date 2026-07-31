import { DEFAULT_UNSPLASH_QUERY } from './utils/api';
import { deleteObsoleteImageCaches } from './utils/imageCache';
import { prefetchBackground } from './utils/prefetch';

/**
 * The dashboard needs no background processing, so the service worker has only
 * housekeeping jobs.
 *
 * 1. Drop image caches written by an older format — an extension update is the
 *    only moment where a previous version's bucket can be identified.
 * 2. Prefetch tomorrow's background so the new tab page never waits on the
 *    network. Chrome fires a missed alarm shortly after the next startup, and
 *    the page falls back to fetching on demand anyway, so a machine asleep when
 *    the alarm is due degrades to the previous behaviour rather than breaking.
 *
 * Everything here must survive being killed mid-flight: an MV3 worker is torn
 * down whenever it goes idle. Nothing below holds state between events.
 */
const PREFETCH_ALARM = 'prefetch-background';

const scheduleAlarm = () => {
  // Creating an alarm that already exists cancels the old one and restarts its
  // 24 h clock. Since this runs on every browser start, an unconditional create
  // would push the prefetch permanently out of reach for anyone who restarts
  // Chrome daily — so only create the alarm when it is genuinely missing.
  chrome.alarms.get(PREFETCH_ALARM, (existing) => {
    if (!existing) chrome.alarms.create(PREFETCH_ALARM, { periodInMinutes: 24 * 60 });
  });
};

const tomorrowIso = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
};

const runPrefetch = () => {
  // No React out here, so settings come straight from storage rather than
  // through `useSettings`.
  chrome.storage.sync.get(['unsplashQuery', 'backgroundSource'], (settings) => {
    // A custom background needs no prefetching.
    if (settings.backgroundSource === 'custom') return;
    // `unsplashQuery` is absent until the popup is saved, so the fallback has to
    // be the page's own default — shared from `utils/api`, since a packet built
    // with any other query is one the page will refuse to adopt. `??` and not
    // `||`, to mirror how `useSettings.merge` treats a deliberately empty query.
    const query = (settings.unsplashQuery as string) ?? DEFAULT_UNSPLASH_QUERY;
    void prefetchBackground(query, tomorrowIso());
  });
};

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install' || reason === 'update') {
    void deleteObsoleteImageCaches();
  }
  scheduleAlarm();
});

chrome.runtime.onStartup.addListener(scheduleAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PREFETCH_ALARM) runPrefetch();
});
