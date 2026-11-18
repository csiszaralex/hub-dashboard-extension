import { DEFAULT_BACKGROUND_TAGS, DEFAULT_QUOTE_SOURCE_ID, type QuoteData } from '@hub/shared';
import { sanitizeHiddenWidgets, type WidgetId } from '../widgets';
import { sanitizeCustomQuotes } from './customQuotes';
import { clampDim, DEFAULT_DIM } from './dim';
import { normalizeBaseUrl, sanitizeMemosTag } from './memos';
import { clampPomodoroMinutes, DEFAULT_BREAK_MINUTES, DEFAULT_WORK_MINUTES } from './pomodoro';

/**
 * The one description of the dashboard's settings: their shape, their
 * defaults, and what counts as a valid stored value for each.
 *
 * Every reader goes through it: the page (`useSettings`, and `i18n.ts` for the
 * language), backup import (`settingsBackup`'s `parseBackup`) and the service
 * worker (`background.ts`). So nothing here, nor anything it imports, may reach
 * React, `window`, `document` or `localStorage`: a service worker has none of
 * them.
 */
export interface HubSettings {
  unsplashQuery: string;
  backgroundSource: 'unsplash' | 'custom';
  backgroundDim: number;
  locationCity: string;
  locationLat: number | null;
  locationLon: number | null;
  selectedCalendars: string[];
  countdownTarget: string | null;
  language: string;
  hiddenWidgets: WidgetId[];
  pomodoroWorkMinutes: number;
  pomodoroBreakMinutes: number;
  /** Which source the daily quote comes from — an id the API advertises. */
  quoteSource: string;
  /** Category narrowing the quote, for sources that take one. Empty means any. */
  quoteQuery: string;
  /** The user's own quotes, used when `quoteSource` is the custom one. */
  customQuotes: QuoteData[];
  /** The user's own Memos instance, normalised. Empty until they connect one. */
  memosUrl: string;
  /** Tag the widget opens on, without the `#`. Empty means unfiltered. */
  memosTag: string;
}

/** A settings field, which is also its key in `chrome.storage.sync`. */
export type SettingKey = keyof HubSettings;

export const DEFAULT_SETTINGS: HubSettings = {
  // The Hub API's own default tags, from `@hub/shared`. Not required for
  // correctness — the API searches whatever it is sent — but a fresh install
  // then asks for exactly the pool the API keeps warm (and keeps a last-good
  // copy of) instead of a near-duplicate under a second KV key.
  unsplashQuery: DEFAULT_BACKGROUND_TAGS,
  backgroundSource: 'unsplash',
  backgroundDim: DEFAULT_DIM,
  locationCity: '',
  locationLat: null,
  locationLon: null,
  selectedCalendars: ['primary'],
  countdownTarget: null,
  language: '',
  hiddenWidgets: [],
  pomodoroWorkMinutes: DEFAULT_WORK_MINUTES,
  pomodoroBreakMinutes: DEFAULT_BREAK_MINUTES,
  quoteSource: DEFAULT_QUOTE_SOURCE_ID,
  quoteQuery: '',
  customQuotes: [],
  memosUrl: '',
  memosTag: '',
};

/** Turns an untrusted value into a setting, or `undefined` when it is not one. */
type Decoder<K extends SettingKey> = (value: unknown) => HubSettings[K] | undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asNullableString = (value: unknown): string | null | undefined =>
  value === null || typeof value === 'string' ? value : undefined;

const asNullableNumber = (value: unknown): number | null | undefined =>
  value === null || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined;

/**
 * A number, or a numeric string — what a hand edit or an older popup may have
 * stored. Anything else (`null`, `''`, `'abc'`, `true`) is not a number at all,
 * which the clamps below would otherwise read as `0` or as their default.
 */
const asNumeric = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const pomodoroMinutes =
  (fallback: number) =>
  (value: unknown): number | undefined => {
    const n = asNumeric(value);
    // `fallback` is never used: `n` is already finite, so the clamp only bounds it.
    return n === undefined ? undefined : clampPomodoroMinutes(n, fallback);
  };

/**
 * Every field, with the rule that decides whether a value is a valid setting
 * and what it becomes.
 *
 * A table keyed by `HubSettings` field rather than a chain of `if`s, so a field
 * added to the interface without a decoder fails the build here. Range and
 * shape checks reuse the sanitisers the popup applies, so no reader enforces
 * different bounds from the one that wrote the value.
 *
 * The decoders only judge; what happens to an invalid value is the reader's
 * policy — see `applyStoredSettings` and `decodeSettings`.
 */
const DECODERS: { [K in SettingKey]: Decoder<K> } = {
  // Free text the user typed; anything non-string is corruption, not a preference.
  unsplashQuery: asString,
  locationCity: asString,
  language: asString,
  quoteSource: asString,
  quoteQuery: asString,

  // A closed set the renderer switches on. An unknown source would leave the
  // background in a state no radio button matches.
  backgroundSource: (value) => (value === 'unsplash' || value === 'custom' ? value : undefined),

  // `useCalendar` maps over this on load. A string would reach `.map` and take
  // the dashboard down before the user could open the popup to fix it.
  selectedCalendars: (value) =>
    Array.isArray(value) && value.every((id): id is string => typeof id === 'string')
      ? value
      : undefined,

  locationLat: asNullableNumber,
  locationLon: asNullableNumber,
  countdownTarget: asNullableString,

  backgroundDim: (value) => {
    const n = asNumeric(value);
    return n === undefined ? undefined : clampDim(n);
  },
  pomodoroWorkMinutes: pomodoroMinutes(DEFAULT_WORK_MINUTES),
  pomodoroBreakMinutes: pomodoroMinutes(DEFAULT_BREAK_MINUTES),

  // Lists are filtered rather than refused when only some entries are bad: an
  // unknown widget id (a renamed widget) drops out, and quotes are held to the
  // sync quota by the same function the popup saves through.
  hiddenWidgets: (value) => (Array.isArray(value) ? sanitizeHiddenWidgets(value) : undefined),
  customQuotes: (value) => (Array.isArray(value) ? sanitizeCustomQuotes(value) : undefined),

  // Validated as an https base, not merely as a string: this is the one setting
  // that decides where the extension sends the user's notes.
  memosUrl: (value) => normalizeBaseUrl(value) ?? undefined,

  // Only ever a bare tag — a leading `#` would be matched against `Memo.tags`,
  // which never carries one — and a non-string would make `composeContent`
  // throw inside the composer's submit.
  memosTag: (value) => (typeof value === 'string' ? sanitizeMemosTag(value) : undefined),
};

// The one cast in the module: `Object.keys` is typed `string[]`, and DECODERS
// has exactly the keys of HubSettings by its type.
export const SETTING_KEYS = Object.keys(DECODERS) as SettingKey[];

const isSettingKey = (key: string): key is SettingKey => key in DECODERS;

/** One field's decoder, for a reader that applies its own policy to `undefined`. */
export const decodeSetting = <K extends SettingKey>(
  key: K,
  value: unknown,
): HubSettings[K] | undefined => DECODERS[key](value);

const assignStored = <K extends SettingKey>(target: HubSettings, key: K, value: unknown) => {
  const decoded = DECODERS[key](value);
  target[key] = decoded === undefined ? DEFAULT_SETTINGS[key] : decoded;
};

/**
 * The read policy, for values coming out of `chrome.storage.sync`: each setting
 * present in `stored` is decoded, and one that is invalid — or was removed,
 * which `onChanged` reports as `newValue: undefined` — becomes its default.
 * Settings absent from `stored` keep their value in `base`.
 *
 * The default, because there is nothing better to fall back to: storage is the
 * configuration, and a value from an older build, another machine or a hand
 * edit that no widget can use must not reach one.
 */
export const applyStoredSettings = (
  base: HubSettings,
  stored: Record<string, unknown>,
): HubSettings => {
  const next = { ...base };
  for (const key of Object.keys(stored)) {
    if (isSettingKey(key)) assignStored(next, key, stored[key]);
  }
  return next;
};

/** Everything a reader of `chrome.storage.sync` needs, valid and complete. */
export const readSettings = (stored: Record<string, unknown>): HubSettings =>
  applyStoredSettings(DEFAULT_SETTINGS, stored);

const assignDecoded = <K extends SettingKey>(
  target: Partial<HubSettings>,
  key: K,
  value: unknown,
) => {
  const decoded = DECODERS[key](value);
  if (decoded !== undefined) target[key] = decoded;
};

/**
 * The import policy, for values from outside storage: each valid setting in
 * `source` is kept, and an invalid one drops out instead of resetting to its
 * default. The source is the untrustworthy party, not the configuration the
 * user already has. Keys that are not settings never come through.
 */
export const decodeSettings = (source: Record<string, unknown>): Partial<HubSettings> => {
  const decoded: Partial<HubSettings> = {};
  for (const key of SETTING_KEYS) {
    if (key in source) assignDecoded(decoded, key, source[key]);
  }
  return decoded;
};

/* -------------------------------------------------------------------------- */
/* Version and migrations                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where the stored settings record which shape they are in. Not a setting: it
 * is outside `HubSettings`, so it is never decoded into the page's state and
 * never written to a backup file.
 */
export const SETTINGS_VERSION_KEY = 'settingsVersion';

/** The raw contents of `chrome.storage.sync`, before any decoding. */
export type StoredSettings = Record<string, unknown>;

/** Takes stored settings from one version to the next. */
export type SettingsMigration = (stored: StoredSettings) => StoredSettings;

/**
 * `MIGRATIONS[i]` takes stored settings from version `i + 1` to `i + 2`, so the
 * list is append-only and ordered. Renaming a field, or changing the format of
 * a stored value, is a step here — never an edit to a key or a decoder alone,
 * which would silently reset every existing user's value to its default.
 */
export const MIGRATIONS: readonly SettingsMigration[] = [];

/** Derived from the list, so a new step cannot be added without raising it. */
export const CURRENT_SETTINGS_VERSION = MIGRATIONS.length + 1;

export interface MigrationResult {
  stored: StoredSettings;
  /** The version to record, or `null` when storage already says enough. */
  writeVersion: number | null;
}

/**
 * Brings stored settings up to the current version.
 *
 * Settings written before versioning existed carry no version and are in
 * version 1's shape, so a missing version counts as 1 — and is then recorded.
 * A version newer than this build's is left alone: it came from a newer build
 * on another machine, and recording an older number would make that build run
 * its migrations again over data already in its shape.
 */
export const migrateStoredSettings = (
  stored: StoredSettings,
  migrations: readonly SettingsMigration[] = MIGRATIONS,
): MigrationResult => {
  const target = migrations.length + 1;
  const raw = stored[SETTINGS_VERSION_KEY];
  const recorded = typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : null;
  const from = recorded ?? 1;

  if (from >= target) {
    return { stored, writeVersion: recorded === null ? target : null };
  }

  let next = stored;
  for (const migrate of migrations.slice(from - 1)) next = migrate(next);
  return { stored: next, writeVersion: target };
};

/**
 * What a migration result asks of `chrome.storage.sync`: the keys it changed or
 * added, plus the version, to `set`; the keys it dropped to `remove`.
 *
 * Only what changed, so that recording version 1 — the only thing that happens
 * until the first real migration — writes one small key and nothing else. The
 * caller sets before it removes: a refused `set` then leaves storage exactly as
 * it was, and the same migration runs again on the next page.
 */
export const migrationWrites = (
  before: StoredSettings,
  { stored, writeVersion }: MigrationResult,
): { set: StoredSettings; remove: string[] } | null => {
  if (writeVersion === null) return null;
  const set: StoredSettings = { [SETTINGS_VERSION_KEY]: writeVersion };
  for (const [key, value] of Object.entries(stored)) {
    if (key !== SETTINGS_VERSION_KEY && before[key] !== value) set[key] = value;
  }
  const remove = Object.keys(before).filter((key) => !(key in stored));
  return { set, remove };
};
