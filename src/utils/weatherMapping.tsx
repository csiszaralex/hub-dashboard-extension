import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Sun,
} from 'lucide-react';
import type { ReactNode } from 'react';

export const getWeatherIcon = (code: number): ReactNode => {
  // WMO Weather interpretation codes (https://open-meteo.com/en/docs)
  if (code === 0 || code === 1) return <Sun className='w-5 h-5 text-yellow-400' />;
  if (code === 2 || code === 3) return <Cloud className='w-5 h-5 text-gray-200' />;
  if (code >= 45 && code <= 48) return <CloudFog className='w-5 h-5 text-gray-400' />;
  if (code >= 51 && code <= 55) return <CloudDrizzle className='w-5 h-5 text-blue-200' />;
  if (code >= 61 && code <= 86) return <CloudRain className='w-5 h-5 text-blue-400' />;
  if (code >= 71 && code <= 77) return <CloudSnow className='w-5 h-5 text-white' />;
  if (code >= 95 && code <= 99) return <CloudLightning className='w-5 h-5 text-yellow-600' />;
  return <Sun className='w-5 h-5' />;
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
