/**
 * Every language the product ships, named in one place.
 *
 * This list had been implied in three places that could not check each other:
 * the extension read it from `src/i18n/locales/` at build time, the service
 * worker kept a hand-written map of the two strings it needs for notifications,
 * and nothing tied the two together. Adding a locale file therefore gave the
 * page a new language while the worker silently kept notifying in English — a
 * gap only a test caught, and only because someone thought to write it.
 *
 * Declared here so each consumer can be typed against it and a missing
 * translation becomes a build error naming the language.
 *
 * The one runtime value in this package. It is two short strings; anything
 * larger — quote text, locale bundles — belongs with whichever app consumes it,
 * so importing a type from here never drags data into another app's bundle.
 */
export const SUPPORTED_LANGUAGES = ['en', 'hu'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Response shape of `GET /api/background`. */
export interface BackgroundData {
  url: string;
  location: string | null;
  photographer: string;
  photographerUrl: string;
}

/** Response shape of `GET /api/quote`. */
export interface QuoteData {
  text: string;
  author: string;
  /**
   * Link back to the quote on the site it came from, when that site's terms
   * require attribution. Absent for sources that need none — a built-in list
   * credits its author in `author` and has nowhere to point.
   */
  sourceUrl?: string;
}
