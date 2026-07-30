/** Slice of the Open-Meteo `hourly` block the widget needs. */
export interface HourlyForecast {
  time: string[];
  precipitation_probability: number[];
  precipitation: number[];
}

export interface RainData {
  probability: number;
  amount: number;
  nextTime: string | null;
}

/** How far ahead the widget looks. */
const WINDOW_HOURS = 12;

/** Probability above which rain is worth announcing a time for. */
const LIKELY_THRESHOLD = 40;

const EMPTY: RainData = { probability: 0, amount: 0, nextTime: null };

/**
 * Condenses the hourly forecast into the one line the weather widget shows.
 *
 * The series starts at midnight, so the window begins at the first hour that
 * has not fully elapsed rather than at index 0.
 */
export const summarizePrecipitation = (hourly: HourlyForecast, now: Date): RainData => {
  const nowTime = now.getTime();
  const firstUpcoming = hourly.time.findIndex(
    (t) => new Date(t).getTime() > nowTime - 60 * 60 * 1000,
  );
  const start = firstUpcoming !== -1 ? firstUpcoming : 0;

  const probabilities = hourly.precipitation_probability.slice(start, start + WINDOW_HOURS);
  const amounts = hourly.precipitation.slice(start, start + WINDOW_HOURS);

  // Math.max() of an empty list is -Infinity, which would render as a temperature-like nonsense.
  if (probabilities.length === 0) return EMPTY;

  const firstLikely = probabilities.findIndex((p) => p > LIKELY_THRESHOLD);

  return {
    probability: Math.max(...probabilities),
    amount: Number(amounts.reduce((sum, value) => sum + value, 0).toFixed(1)),
    nextTime: firstLikely !== -1 ? hourly.time[start + firstLikely] : null,
  };
};
