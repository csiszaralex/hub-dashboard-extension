import { SUPPORTED_LANGUAGES, type Language } from '@hub/shared';

/**
 * Which interface language applies, decided once for the page and the worker.
 *
 * The page (`i18n/i18n.ts`) and the service worker (`background.ts`) each had
 * their own copy of this, and i18next's `fallbackLng` named a third default
 * (`'hu'`) that disagreed with both. Kept free of React, the DOM and
 * `localStorage` so the worker can import it: `serviceWorkerGuard` in
 * `vite.config.ts` fails the build otherwise.
 */

/** What every path falls back to when nothing better is known. */
export const DEFAULT_LANGUAGE: Language = SUPPORTED_LANGUAGES[0];

export const isSupportedLanguage = (code: string): code is Language =>
  (SUPPORTED_LANGUAGES as readonly string[]).includes(code);

/** The primary subtag of a BCP 47 tag, so `hu-HU` counts as `hu`. */
const primaryCode = (tag: string) => tag.split('-')[0].toLowerCase();

/** `navigator` exists in a worker too (`WorkerNavigator`), with the same two fields. */
const browserLanguages = (): readonly string[] =>
  navigator.languages?.length ? navigator.languages : [navigator.language];

/** The first of the browser's preferred languages that the product ships. */
export const detectLanguage = (preferred: readonly string[] = browserLanguages()): Language => {
  for (const tag of preferred) {
    const code = primaryCode(tag ?? '');
    if (isSupportedLanguage(code)) return code;
  }
  return DEFAULT_LANGUAGE;
};

/** `saved` is `''` until the popup stores one, which means "follow the browser". */
export const resolveLanguage = (saved: string): Language =>
  isSupportedLanguage(saved) ? saved : detectLanguage();

/**
 * Narrows whatever i18next reports (`i18n.language` may carry a region, or be
 * empty before `init` finishes) to a supported language, for code that keys a
 * lookup on it.
 */
export const toLanguage = (tag: string | undefined): Language => {
  const code = primaryCode(tag ?? '');
  return isSupportedLanguage(code) ? code : DEFAULT_LANGUAGE;
};
