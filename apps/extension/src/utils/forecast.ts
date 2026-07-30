/** Slice of the Open-Meteo `daily` block the strip needs. */
export interface DailyBlock {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  weather_code: number[];
}

export interface DailyForecast {
  date: string;
  max: number;
  min: number;
  code: number;
}

const DEFAULT_DAYS = 4;

/**
 * Condenses the daily block into the strip under the current conditions.
 *
 * A day missing either temperature is dropped: Open-Meteo occasionally returns
 * a null at the edge of the range, and `Math.round(null)` would render as 0°.
 */
export const summarizeDaily = (daily: DailyBlock, days = DEFAULT_DAYS): DailyForecast[] => {
  const out: DailyForecast[] = [];

  for (let i = 0; i < daily.time.length && out.length < days; i++) {
    const max = daily.temperature_2m_max?.[i];
    const min = daily.temperature_2m_min?.[i];
    if (typeof max !== 'number' || typeof min !== 'number') continue;

    out.push({
      date: daily.time[i],
      max: Math.round(max),
      min: Math.round(min),
      code: daily.weather_code?.[i] ?? 0,
    });
  }

  return out;
};
