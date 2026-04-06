import type en from './locales/en.json';
import type hu from './locales/hu.json';

/** Recursively maps every leaf value to `string` — preserves key structure, ignores actual values */
type LocaleShape<T> = {
  [K in keyof T]: T[K] extends Record<string, unknown> ? LocaleShape<T[K]> : string;
};

type BaseShape = LocaleShape<typeof en>;

/**
 * Add every new locale file here.
 * TypeScript will report a compile error pointing to the specific missing key
 * if a locale JSON does not fully implement en.json's structure.
 */
type _CheckLocale<T extends BaseShape> = T;
export type _CheckHu = _CheckLocale<LocaleShape<typeof hu>>;
