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
import i18n from '../i18n/i18n';

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
  // Drizzle 51–57 (56, 57 freezing), rain 61–67 (66, 67 freezing) and rain
  // showers 80–82, snow 71–77 and snow showers 85–86. The two snow ranges sit
  // between the rain ones, so each range is matched on its own.
  if (code >= 51 && code <= 57) return <CloudDrizzle className={`${size} text-blue-200`} />;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return <CloudSnow className={`${size} text-white`} />;
  }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return <CloudRain className={`${size} text-blue-400`} />;
  }
  if (code >= 95 && code <= 99) return <CloudLightning className={`${size} text-yellow-600`} />;
  return isDaytime ? <Sun className={`${size}`} /> : <Moon className={`${size}`} />;
};

export const getWeatherDescription = (code: number): string => {
  const descriptions = i18n.t('weather.codes', { returnObjects: true }) as Record<string, string>;
  return descriptions[String(code)] ?? i18n.t('weather.unknown');
};
