import { useCallback, useEffect, useState } from 'react';

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

const CACHE_KEY = 'weather_cache';
const CACHE_DURATION = 1000 * 60 * 30;

export const useWeather = () => {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchWeather = useCallback(async (force = false) => {
    setLoading(true);

    if (!force) {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { timestamp, weather } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          setData(weather);
          setLoading(false);
          return;
        }
      }
    }

    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        let city = 'Helyi időjárás';

        try {
          const weatherPromise = fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&hourly=precipitation_probability,precipitation&daily=sunrise,sunset&timezone=auto`,
          );

          const cityPromise = fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=hu`,
          )
            .then((res) => res.json())
            .catch(() => null);

          const [weatherRes, cityData] = await Promise.all([weatherPromise, cityPromise]);
          const wData = await weatherRes.json();

          if (cityData && cityData.city) {
            city = cityData.city;
            if (cityData.locality) city = cityData.locality;
          }

          // Stabil idő-keresés: megkeressük azt az indexet, ami a jelenlegi órához van legközelebb
          const nowTime = Date.now();
          const startIndex = wData.hourly.time.findIndex(
            (t: string) => new Date(t).getTime() > nowTime - 3600000,
          );
          const safeStartIndex = startIndex !== -1 ? startIndex : 0;

          const next12hProb = wData.hourly.precipitation_probability.slice(
            safeStartIndex,
            safeStartIndex + 12,
          );
          const next12hAmount = wData.hourly.precipitation.slice(
            safeStartIndex,
            safeStartIndex + 12,
          );

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
            rain: {
              probability: maxProb,
              amount: totalAmount,
              nextTime,
            },
          };

          localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), weather }));
          setData(weather);
        } catch (error) {
          console.error('Weather fetch failed:', error);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        console.error(err);
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    fetchWeather(false);
  }, [fetchWeather]);

  return { data, loading, refresh: () => fetchWeather(true) };
};
