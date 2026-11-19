import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import { installFakeClock } from '../test/hangingFetch';
import { restorePageVisibility, setPageVisibility } from '../test/pageVisibility';
import { warmUp } from '../test/warmUp';

warmUp(() => Promise.all([import('../i18n/i18n'), import('./useWeather')]));

const MINUTE = 60_000;

/** An Open-Meteo answer with just the fields `useWeather` reads. */
const FORECAST = {
  current: { temperature_2m: 12.4, weather_code: 3, wind_speed_10m: 8.2 },
  hourly: { time: [], precipitation_probability: [], precipitation: [] },
  daily: {
    time: ['2026-11-19'],
    sunrise: ['2026-11-19T06:50'],
    sunset: ['2026-11-19T16:10'],
    temperature_2m_max: [14],
    temperature_2m_min: [6],
    weather_code: [3],
  },
};

describe('useWeather refreshing', () => {
  let restoreClock: () => void;
  let forecastRequests: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    restoreClock = installFakeClock();
    // A location in the settings keeps the test off geolocation and the IP lookup.
    installChromeStub().seedSync({
      locationLat: 47.5,
      locationLon: 19.04,
      locationCity: 'Budapest',
    });
    forecastRequests = vi.fn(async () => new Response(JSON.stringify(FORECAST)));
    vi.stubGlobal('fetch', forecastRequests);
  });

  afterEach(() => {
    restorePageVisibility();
    restoreClock();
  });

  const mount = async () => {
    await import('../i18n/i18n');
    const { useWeather } = await import('./useWeather');
    const hook = renderHook(() => useWeather());
    await waitFor(() => expect(hook.result.current.data?.temp).toBe(12));
    expect(forecastRequests).toHaveBeenCalledTimes(1);
    return hook;
  };

  it('makes no request on the interval while the cache is still fresh', async () => {
    await mount();
    await act(() => vi.advanceTimersByTimeAsync(25 * MINUTE));
    // Another tab refreshes the shared cache just before this tab's 30-minute mark.
    const cache = JSON.parse(localStorage.getItem('weather_cache') ?? '{}');
    localStorage.setItem('weather_cache', JSON.stringify({ ...cache, timestamp: Date.now() }));

    await act(() => vi.advanceTimersByTimeAsync(5 * MINUTE));

    expect(forecastRequests).toHaveBeenCalledTimes(1);
  });

  it('makes no request on the interval while the tab is hidden', async () => {
    await mount();
    setPageVisibility('hidden');

    await act(() => vi.advanceTimersByTimeAsync(45 * MINUTE));

    expect(forecastRequests).toHaveBeenCalledTimes(1);
  });

  it('refreshes once when a tab with a stale cache becomes visible', async () => {
    await mount();
    setPageVisibility('hidden');
    await act(() => vi.advanceTimersByTimeAsync(45 * MINUTE));

    await act(async () => setPageVisibility('visible'));

    await waitFor(() => expect(forecastRequests).toHaveBeenCalledTimes(2));
    // The cache is fresh again, so coming back to the tab once more costs nothing.
    await act(async () => setPageVisibility('hidden'));
    await act(async () => setPageVisibility('visible'));
    expect(forecastRequests).toHaveBeenCalledTimes(2);
  });

  it('refreshes on the interval of a visible tab once the cache has run out', async () => {
    await mount();

    await act(() => vi.advanceTimersByTimeAsync(35 * MINUTE));

    expect(forecastRequests).toHaveBeenCalledTimes(2);
  });

  it('still forces a request from the refresh button while the cache is fresh', async () => {
    const hook = await mount();

    await act(() => hook.result.current.refresh());

    expect(forecastRequests).toHaveBeenCalledTimes(2);
  });
});
