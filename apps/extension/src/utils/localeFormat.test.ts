import { SUPPORTED_LANGUAGES } from '@hub/shared';
import { describe, expect, it } from 'vitest';
import { clockParts, DATE_LOCALES, formatNumber, formatTime } from './localeFormat';

const AFTERNOON = new Date(2026, 2, 4, 15, 5);

describe('DATE_LOCALES', () => {
  // The type already demands an entry per language; this guards against one
  // being filled with `undefined` through a cast or a bad import.
  it.each(SUPPORTED_LANGUAGES)('has a date-fns locale for %s', (language) => {
    expect(DATE_LOCALES[language]?.code).toMatch(new RegExp(`^${language}`));
  });
});

describe('formatTime', () => {
  it('uses a 12-hour clock in English and a 24-hour one in Hungarian', () => {
    // ICU may put a narrow no-break space before the day period.
    expect(formatTime(AFTERNOON, 'en')).toMatch(/^3:05\sPM$/);
    expect(formatTime(AFTERNOON, 'hu')).toBe('15:05');
  });
});

describe('clockParts', () => {
  it('splits the time into hour, minute and day period', () => {
    expect(clockParts(AFTERNOON, 'en')).toEqual({ hour: '3', minute: '05', dayPeriod: 'PM' });
    expect(clockParts(AFTERNOON, 'hu')).toEqual({ hour: '15', minute: '05', dayPeriod: null });
  });
});

describe('formatNumber', () => {
  it('writes a decimal comma in Hungarian', () => {
    expect(formatNumber(1.5, 'hu')).toBe('1,5');
    expect(formatNumber(1.5, 'en')).toBe('1.5');
  });
});
