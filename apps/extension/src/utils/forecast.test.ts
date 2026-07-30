import { describe, expect, it } from 'vitest';
import { summarizeDaily, type DailyBlock } from './forecast';

const block: DailyBlock = {
  time: ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02', '2026-08-03'],
  temperature_2m_max: [28.4, 30.9, 26.1, 24.8, 22.2],
  temperature_2m_min: [17.6, 19.2, 15.4, 14.9, 13.1],
  weather_code: [0, 2, 61, 3, 95],
};

describe('summarizeDaily', () => {
  it('rounds the temperatures to whole degrees', () => {
    expect(summarizeDaily(block)[0]).toEqual({
      date: '2026-07-30',
      max: 28,
      min: 18,
      code: 0,
    });
  });

  it('returns four days by default', () => {
    expect(summarizeDaily(block)).toHaveLength(4);
  });

  it('honours an explicit day count', () => {
    expect(summarizeDaily(block, 2).map((d) => d.date)).toEqual(['2026-07-30', '2026-07-31']);
  });

  it('never returns more days than the forecast contains', () => {
    const short: DailyBlock = {
      time: ['2026-07-30'],
      temperature_2m_max: [20],
      temperature_2m_min: [10],
      weather_code: [0],
    };
    expect(summarizeDaily(short, 4)).toHaveLength(1);
  });

  it('returns nothing for an empty forecast', () => {
    expect(summarizeDaily({ time: [], temperature_2m_max: [], temperature_2m_min: [], weather_code: [] })).toEqual([]);
  });

  it('survives a block missing the temperature arrays entirely', () => {
    expect(summarizeDaily({ time: ['2026-07-30'] } as unknown as DailyBlock)).toEqual([]);
  });

  it('skips days with a missing temperature rather than reporting NaN', () => {
    const gappy: DailyBlock = {
      time: ['2026-07-30', '2026-07-31'],
      temperature_2m_max: [20, null as unknown as number],
      temperature_2m_min: [10, 5],
      weather_code: [0, 1],
    };
    expect(summarizeDaily(gappy).map((d) => d.date)).toEqual(['2026-07-30']);
  });
});
