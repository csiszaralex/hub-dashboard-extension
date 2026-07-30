import { describe, expect, it } from 'vitest';
import { summarizePrecipitation, type HourlyForecast } from './precipitation';

const NOW = new Date(2026, 6, 29, 10, 30, 0);

/** Builds an hourly series starting at 08:00 local on the fixed test day. */
const forecast = (probabilities: number[], amounts?: number[]): HourlyForecast => ({
  time: probabilities.map((_, i) => `2026-07-29T${String(8 + i).padStart(2, '0')}:00`),
  precipitation_probability: probabilities,
  precipitation: amounts ?? probabilities.map(() => 0),
});

describe('summarizePrecipitation', () => {
  it('reports the highest probability in the window', () => {
    const { probability } = summarizePrecipitation(forecast([0, 0, 10, 80, 20]), NOW);

    expect(probability).toBe(80);
  });

  it('ignores hours that are already in the past', () => {
    // 08:00 and 09:00 are behind us; their 90% must not be reported.
    const { probability } = summarizePrecipitation(forecast([90, 90, 10, 20]), NOW);

    expect(probability).toBe(20);
  });

  it('adds up the expected rainfall, rounded to one decimal', () => {
    // 08:00 and 09:00 are in the past; 1.24 + 0.5 + 0.5 = 2.24 rounds to 2.2.
    const { amount } = summarizePrecipitation(
      forecast([0, 0, 0, 0, 0], [9, 9, 1.24, 0.5, 0.5]),
      NOW,
    );

    expect(amount).toBe(2.2);
  });

  it('looks no further than twelve hours ahead', () => {
    const probabilities = Array(16).fill(0);
    probabilities[14] = 100; // 22:00 — the 13th hour from now
    const { probability } = summarizePrecipitation(forecast(probabilities), NOW);

    expect(probability).toBe(0);
  });

  it('reports when rain first becomes likely', () => {
    const { nextTime } = summarizePrecipitation(forecast([0, 0, 10, 41, 90]), NOW);

    expect(nextTime).toBe('2026-07-29T11:00');
  });

  it('reports no time when rain never becomes likely', () => {
    const { nextTime } = summarizePrecipitation(forecast([0, 0, 10, 40, 30]), NOW);

    expect(nextTime).toBeNull();
  });

  it('returns zeroes rather than infinities for an empty forecast', () => {
    const summary = summarizePrecipitation(forecast([]), NOW);

    expect(summary).toEqual({ probability: 0, amount: 0, nextTime: null });
  });

  it('falls back to the start of the series when every hour is in the past', () => {
    const past: HourlyForecast = {
      time: ['2026-07-28T08:00', '2026-07-28T09:00'],
      precipitation_probability: [50, 60],
      precipitation: [1, 2],
    };

    expect(summarizePrecipitation(past, NOW).probability).toBe(60);
  });
});
