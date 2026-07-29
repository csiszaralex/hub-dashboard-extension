import { deleteObsoleteImageCaches } from './utils/imageCache';

/**
 * Hub's service worker deliberately does almost nothing: the dashboard is a
 * plain new tab page and needs no background processing.
 *
 * Its one job is housekeeping. Background images are stored in a versioned
 * Cache storage bucket, and an extension update is the only moment where a
 * previous version's bucket can be identified and dropped — the new tab page
 * itself never learns which older formats existed.
 */
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install' || reason === 'update') {
    void deleteObsoleteImageCaches();
  }
});
