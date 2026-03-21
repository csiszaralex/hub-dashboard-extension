import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
} from 'lucide-react';
import type { ReactNode } from 'react';

export const getWeatherIcon = (code: number, isDaytime: boolean = true): ReactNode => {
  // WMO Weather interpretation codes (https://open-meteo.com/en/docs)
  const size = 'w-7 h-7';

  if (code === 0) {
    return isDaytime ? (
      <Sun className={`${size} text-yellow-400`} />
    ) : (
      <Moon className={`${size} text-indigo-200`} />
    );
  }
  if (code === 1 || code === 2) {
    return isDaytime ? (
      <CloudSun className={`${size} text-yellow-400`} />
    ) : (
      <CloudMoon className={`${size} text-indigo-200`} />
    );
  }
  if (code === 3) return <Cloud className={`${size} text-gray-200`} />;
  if (code >= 45 && code <= 48) return <CloudFog className={`${size} text-gray-400`} />;
  if (code >= 51 && code <= 55) return <CloudDrizzle className={`${size} text-blue-200`} />;
  if (code >= 61 && code <= 86) return <CloudRain className={`${size} text-blue-400`} />;
  if (code >= 71 && code <= 77) return <CloudSnow className={`${size} text-white`} />;
  if (code >= 95 && code <= 99) return <CloudLightning className={`${size} text-yellow-600`} />;
  return isDaytime ? <Sun className={`${size}`} /> : <Moon className={`${size}`} />;
};

export const getWeatherDescription = (code: number): string => {
  // Egyszerűsített mapping magyarul
  const map: Record<number, string> = {
    0: 'Tiszta égbolt',
    1: 'Túlnyomóan derűs',
    2: 'Változóan felhős',
    3: 'Borult',
    45: 'Köd',
    48: 'Zúzmarás köd',
    51: 'Szitálás',
    53: 'Mérsékelt szitálás',
    55: 'Sűrű szitálás',
    61: 'Gyenge eső',
    63: 'Eső',
    65: 'Heves eső',
    71: 'Hószállingózás',
    73: 'Havazás',
    75: 'Erős havazás',
    95: 'Zivatar',
    96: 'Zivatar jégesővel',
  };
  return map[code] || 'Ismeretlen';
};
