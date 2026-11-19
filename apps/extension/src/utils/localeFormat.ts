import type { Language } from '@hub/shared';
import type { Locale } from 'date-fns';
import { enUS, hu } from 'date-fns/locale';

/**
 * The date-fns locale for each language. A `Record` over `Language`, so adding
 * a language to `SUPPORTED_LANGUAGES` without an entry here fails the build;
 * the `isHu ? hu : enUS` this replaced gave any third language English dates.
 */
export const DATE_LOCALES: Record<Language, Locale> = { en: enUS, hu };

/**
 * Times follow the language's own convention instead of a fixed `HH:mm`:
 * English reads `3:05 PM`, Hungarian `15:05`. Formatters are cached because
 * the clock asks for one every second.
 */
const timeFormatters = new Map<Language, Intl.DateTimeFormat>();

const timeFormatter = (language: Language) => {
  let formatter = timeFormatters.get(language);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' });
    timeFormatters.set(language, formatter);
  }
  return formatter;
};

export const formatTime = (date: Date, language: Language): string =>
  timeFormatter(language).format(date);

export interface ClockParts {
  hour: string;
  minute: string;
  /** `AM`/`PM` where the language uses a 12-hour clock, otherwise `null`. */
  dayPeriod: string | null;
}

/** The same time as `formatTime`, split so the big clock can lay the parts out itself. */
export const clockParts = (date: Date, language: Language): ClockParts => {
  const parts = timeFormatter(language).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return { hour: value('hour') ?? '', minute: value('minute') ?? '', dayPeriod: value('dayPeriod') ?? null };
};

/** A number with the language's decimal separator: `1.5` in English, `1,5` in Hungarian. */
export const formatNumber = (value: number, language: Language): string =>
  new Intl.NumberFormat(language).format(value);
