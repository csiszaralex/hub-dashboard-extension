import type { Language } from '@hub/shared';
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

/** The locale files this build actually has, keyed by language code. */
type Locales = {
  en: LocaleShape<typeof en>;
  hu: LocaleShape<typeof hu>;
};

/**
 * Ties the locale files to `SUPPORTED_LANGUAGES`, so the two cannot drift.
 *
 * Adding a language to the shared list without adding its JSON here fails the
 * build naming the missing code, instead of shipping a language the picker
 * offers and nothing can render.
 */
type _AssertEveryLanguageHasALocale<T extends Record<Language, BaseShape>> = T;
export type _CheckLocaleCoverage = _AssertEveryLanguageHasALocale<Locales>;
