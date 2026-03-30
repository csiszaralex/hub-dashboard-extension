import { useCallback, useEffect, useState } from 'react';
import i18n from '../i18n/i18n';
import { useSettings } from './useSettings';

export interface RainData {
  probability: number;
  amount: number;
  nextTime: string | null;
}

export interface WeatherData {
  temp: number;
  code: number;
  city: string;
  windSpeed: number;
  sunrise: string;
  sunset: string;
  rain: RainData;
}

interface ResolveLocationResult {
  lat: number;
  lon: number;
  source: 'settings' | 'gps' | 'ip' | 'fallback' | 'cache_fallback';
}

const CACHE_KEY = 'weather_cache';
const CACHE_DURATION = 1000 * 60 * 30;

const roundCoord = (coord: number) => Number(coord.toFixed(3));

export const useWeather = () => {
  const { settings, isLoaded } = useSettings();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<WeatherData | null>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.weather || null;
      }
    } catch {
      // ignore
    }
    return null;
  });

  const fetchWeather = useCallback(
    async (force = false) => {
      if (!isLoaded) return;
      setLoading(true);

      try {
        //TODO type
        let cachedData = null;
        try {
          const cachedStr = localStorage.getItem(CACHE_KEY);
          if (cachedStr) cachedData = JSON.parse(cachedStr);
        } catch {
          // ignore
        }

        if (!force && cachedData) {
          const { timestamp, cacheLat, cacheLon } = cachedData;
          const isTimeValid = Date.now() - timestamp < CACHE_DURATION;
          const isSettingsValid =
            settings.locationLat !== null && settings.locationLon !== null
              ? roundCoord(settings.locationLat) === cacheLat &&
                roundCoord(settings.locationLon) === cacheLon
              : true;

          if (isTimeValid && isSettingsValid) {
            setData(cachedData.weather);
            setLoading(false);
            return;
          }
        }

        const resolveLocation = async (): Promise<ResolveLocationResult> => {
          // 1. Settings
          if (settings.locationLat !== null && settings.locationLon !== null) {
            return { lat: settings.locationLat, lon: settings.locationLon, source: 'settings' };
          }

          // 2. Geolocation
          if (navigator.geolocation) {
            try {
              const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                  timeout: 3000,
                  maximumAge: 1000 * 60 * 15,
                });
              });
              return { lat: pos.coords.latitude, lon: pos.coords.longitude, source: 'gps' };
            } catch {
              console.warn('Geolocation failed, falling back to IP');
            }
          }
          // 3. IP
          try {
            const res = await fetch('https://get.geojs.io/v1/ip/geo.json');
            if (res.ok) {
              const geoData = await res.json();
              if (geoData.latitude && geoData.longitude) {
                return {
                  lat: parseFloat(geoData.latitude),
                  lon: parseFloat(geoData.longitude),
                  source: 'ip',
                };
              }
            }
          } catch {
            console.warn('IP location failed, using fallback');
          }

          //4. Last known location from cache (if available)
          if (cachedData && cachedData.cacheLat && cachedData.cacheLon) {
            return { lat: cachedData.cacheLat, lon: cachedData.cacheLon, source: 'cache_fallback' };
          }

          // 5. Fallback (Budapest)
          return { lat: 47.4979, lon: 19.0402, source: 'fallback' };
        };

        const { lat, lon, source } = await resolveLocation();

        const weatherPromise = fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&hourly=precipitation_probability,precipitation&daily=sunrise,sunset&timezone=auto`,
        );

        let city = i18n.t('weather.localWeather');
        let cityPromise: Promise<{ city?: string; locality?: string } | null> | null = null;

        if (source === 'settings' && settings.locationCity) {
          city = settings.locationCity;
        } else {
          cityPromise = fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=hu`,
          )
            .then((res) => res.json())
            .catch(() => null);
        }

        const [weatherRes, cityData] = await Promise.all([weatherPromise, cityPromise]);

        const wData = await weatherRes.json();
        if (cityData) {
          if (cityData.city) city = cityData.city;
          if (cityData.locality) city = cityData.locality;
        }

        const nowTime = Date.now();
        const startIndex = wData.hourly.time.findIndex(
          (t: string) => new Date(t).getTime() > nowTime - 3600000,
        );
        const safeStartIndex = startIndex !== -1 ? startIndex : 0;

        const next12hProb = wData.hourly.precipitation_probability.slice(
          safeStartIndex,
          safeStartIndex + 12,
        );
        const next12hAmount = wData.hourly.precipitation.slice(safeStartIndex, safeStartIndex + 12);

        const maxProb = Math.max(...next12hProb);
        const totalAmount = Number(
          next12hAmount.reduce((sum: number, val: number) => sum + val, 0).toFixed(1),
        );

        const firstRainIndex = next12hProb.findIndex((p: number) => p > 40);
        const nextTime =
          firstRainIndex !== -1 ? wData.hourly.time[safeStartIndex + firstRainIndex] : null;

        const weather: WeatherData = {
          temp: Math.round(wData.current.temperature_2m),
          code: wData.current.weather_code,
          windSpeed: Math.round(wData.current.wind_speed_10m),
          sunrise: wData.daily.sunrise[0],
          sunset: wData.daily.sunset[0],
          city,
          rain: { probability: maxProb, amount: totalAmount, nextTime },
        };

        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            timestamp: Date.now(),
            weather,
            cacheLat: roundCoord(lat),
            cacheLon: roundCoord(lon),
          }),
        );
        setData(weather);
      } catch (error) {
        console.error('Weather fetch failed:', error);
      } finally {
        setLoading(false);
      }
    },
    [isLoaded, settings.locationCity, settings.locationLat, settings.locationLon],
  );

  useEffect(() => {
    fetchWeather(false);

    // Refresh weather every 30 minutes
    const interval = setInterval(
      () => {
        fetchWeather(true);
      },
      30 * 60 * 1000,
    );

    return () => clearInterval(interval);
  }, [fetchWeather]);

  return { data, loading, refresh: () => fetchWeather(true) };
};
