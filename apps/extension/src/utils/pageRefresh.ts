/**
 * Periodic refresh that only happens while the tab is on screen. Shared by
 * `useWeather` and `useCalendar`: a new tab page is often left open in the
 * background for hours, and every such tab used to ask its API on its own.
 *
 * `onTick` runs on the interval while the tab is visible and is skipped while
 * it is hidden. `onVisible` runs each time the tab becomes visible again, to
 * catch up on a tick that was skipped; it decides for itself whether the data
 * is old enough to be worth a request. Returns the cleanup for an effect.
 */
export const schedulePageRefresh = (
  intervalMs: number,
  onTick: () => void,
  onVisible: () => void,
): (() => void) => {
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') onTick();
  }, intervalMs);

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') onVisible();
  };
  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
};
