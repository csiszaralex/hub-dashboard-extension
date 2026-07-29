import { describe, expect, it } from 'vitest';
import { getDailyData, setDailyData } from './dailyStorage';

const KEY = 'test_key';
const today = () => new Date().toISOString().split('T')[0];

const writePacket = (packet: unknown) => localStorage.setItem(KEY, JSON.stringify(packet));

describe('getDailyData', () => {
  it('returns data stored today for the same query', () => {
    setDailyData(KEY, { value: 42 }, 'forest');

    expect(getDailyData<{ value: number }>(KEY, 'forest')).toEqual({ value: 42 });
  });

  it('returns null for data stored on an earlier day', () => {
    writePacket({ date: '2000-01-01', query: 'forest', data: { value: 42 } });

    expect(getDailyData(KEY, 'forest')).toBeNull();
  });

  it('returns null when the query no longer matches', () => {
    setDailyData(KEY, { value: 42 }, 'forest');

    expect(getDailyData(KEY, 'desert')).toBeNull();
  });

  it('returns null when nothing was stored', () => {
    expect(getDailyData(KEY, 'forest')).toBeNull();
  });

  it('returns null instead of throwing on corrupted storage', () => {
    localStorage.setItem(KEY, 'not json');

    expect(getDailyData(KEY, 'forest')).toBeNull();
  });

  it('matches when neither the write nor the read carries a query', () => {
    setDailyData(KEY, { value: 1 });

    expect(getDailyData<{ value: number }>(KEY)).toEqual({ value: 1 });
  });
});

describe('setDailyData', () => {
  it('stamps the packet with the current date', () => {
    setDailyData(KEY, { value: 7 }, 'forest');

    expect(JSON.parse(localStorage.getItem(KEY)!).date).toBe(today());
  });
});
