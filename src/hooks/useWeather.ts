import { useEffect, useState } from 'react';

interface WeatherData {
  temp: number;
  code: number;
  city: string;
  windSpeed: number;
  sunrise: string;
  sunset: string;
  nextRain: string | null;
}

const CACHE_KEY = 'weather_cache_v3'; // Új verzió a provider csere miatt
const CACHE_DURATION = 1000 * 60 * 30; // 30 perc

export const useWeather = () => {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWeather = async () => {
      // Cache check
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { timestamp, weather } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          setData(weather);
          setLoading(false);
          return;
        }
      }

      if (!navigator.geolocation) return;

      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        let city = 'Helyi időjárás'; // Fallback név

        try {
          // 1. Időjárás lekérése (Open-Meteo)
          const weatherPromise = fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&hourly=precipitation_probability&daily=sunrise,sunset&timezone=auto`,
          );

          // 2. Város név lekérése (BigDataCloud - stabilabb reverse geocoding)
          // localityLanguage=hu paraméterrel magyarul kapjuk vissza
          const cityPromise = fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=hu`,
          )
            .then((res) => res.json())
            .catch(() => null);

          const [weatherRes, cityData] = await Promise.all([weatherPromise, cityPromise]);
          const wData = await weatherRes.json();

          // Város név feldolgozása (biztonságosan)
          if (cityData && cityData.city) {
            city = cityData.city;
            // Ha kerület van (pl. Budapest XI. kerület), rövidítsük Budapest-re, vagy hagyjuk meg
            if (cityData.locality) city = cityData.locality;
          }

          // Eső logika
          const currentHourIndex = new Date().getHours();
          let nextRain = null;
          if (wData.hourly?.precipitation_probability) {
            for (let i = currentHourIndex; i < currentHourIndex + 12; i++) {
              if (wData.hourly.precipitation_probability[i] > 40) {
                nextRain = wData.hourly.time[i];
                break;
              }
            }
          }

          const weather: WeatherData = {
            temp: Math.round(wData.current.temperature_2m),
            code: wData.current.weather_code,
            windSpeed: Math.round(wData.current.wind_speed_10m),
            sunrise: wData.daily.sunrise[0],
            sunset: wData.daily.sunset[0],
            city,
            nextRain,
          };

          localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
              timestamp: Date.now(),
              weather,
            }),
          );

          setData(weather);
        } catch (error) {
          console.error('Weather fetch failed:', error);
        } finally {
          setLoading(false);
        }
      });
    };

    fetchWeather();
  }, []);

  return { data, loading };
};
