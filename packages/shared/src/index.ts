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
 * Runtime values in this package are kept to a few short strings like these
 * and the small response guards below; anything larger — quote text, locale
 * bundles — belongs with whichever app consumes it, so importing a type from
 * here never drags data into another app's bundle.
 */
export const SUPPORTED_LANGUAGES = ['en', 'hu'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * The background search tags used when a request names none.
 *
 * The API serves them for a request without `tags`, and the extension sends
 * them until the user saves their own, so a fresh install draws from the pool
 * the API keeps warm rather than a near-identical one under a second KV key.
 */
export const DEFAULT_BACKGROUND_TAGS = 'landscape,forest,mountain,fog,nature view';

/**
 * The quote source a request without a known `source` gets, and the one a
 * fresh install asks for.
 */
export const DEFAULT_QUOTE_SOURCE_ID = 'stoic';

/*
 * The API contract: what the worker answers and what the extension reads.
 *
 * Installed extensions lag behind the worker by days to weeks, so a response
 * may only gain optional fields. The guards below check only the fields a
 * reader relies on and accept extra ones, for the same reason. The API's
 * contract test (`apps/api/src/contract.test.ts`) runs every endpoint through
 * them, so a worker change that would break a reader fails there.
 */

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

/** One entry of `GET /api/quote/sources`. */
export interface QuoteSourceInfo {
  id: string;
  /**
   * Plain strings rather than `Language`: a newer worker may serve a language
   * an older extension does not know, and that build should skip the language,
   * not reject the whole list.
   */
  languages: readonly string[];
  /** Whether `?q=` narrows the result. */
  acceptsQuery: boolean;
}

/** Response shape of `GET /api/quote/sources`. */
export type QuoteSourceList = QuoteSourceInfo[];

/** Response shape of `GET /api/health`, with 200 when `ok` and 503 when not. */
export interface HealthReport {
  ok: boolean;
  backgrounds: boolean;
}

/** Body of every error the API answers: the routes' 503s, 404 and 500. */
export interface ErrorBody {
  error: string;
}

type Fields = Partial<Record<string, unknown>>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

export const isBackgroundData = (value: unknown): value is BackgroundData =>
  isObject(value) &&
  isString(value.url) &&
  (value.location === null || isString(value.location)) &&
  isString(value.photographer) &&
  isString(value.photographerUrl);

export const isQuoteData = (value: unknown): value is QuoteData =>
  isObject(value) &&
  isString(value.text) &&
  isString(value.author) &&
  (value.sourceUrl === undefined || isString(value.sourceUrl));

export const isQuoteSourceInfo = (value: unknown): value is QuoteSourceInfo =>
  isObject(value) &&
  isString(value.id) &&
  Array.isArray(value.languages) &&
  value.languages.every(isString) &&
  typeof value.acceptsQuery === 'boolean';

export const isQuoteSourceList = (value: unknown): value is QuoteSourceList =>
  Array.isArray(value) && value.every(isQuoteSourceInfo);

export const isHealthReport = (value: unknown): value is HealthReport =>
  isObject(value) && typeof value.ok === 'boolean' && typeof value.backgrounds === 'boolean';

export const isErrorBody = (value: unknown): value is ErrorBody =>
  isObject(value) && isString(value.error);
