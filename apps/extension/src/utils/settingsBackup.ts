import type { HubSettings } from '../hooks/useSettings';
import { sanitizeHiddenWidgets } from '../widgets';
import { clampDim } from './dim';
import { clampPomodoroMinutes, DEFAULT_BREAK_MINUTES, DEFAULT_WORK_MINUTES } from './pomodoro';

/**
 * Bumped only if the file's shape changes in a way an older build cannot read.
 * It is written but not yet enforced on import: there is one version, so
 * refusing anything else would reject files from a future build without
 * gaining anything today.
 */
export const BACKUP_VERSION = 1;

/** Serialises the dashboard's configuration as a file a user can keep and read. */
export const buildBackup = (settings: HubSettings): string =>
  JSON.stringify(
    { version: BACKUP_VERSION, exportedAt: new Date().toISOString(), settings },
    null,
    2,
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asNullableString = (value: unknown): string | null | undefined =>
  value === null || typeof value === 'string' ? value : undefined;

const asNullableNumber = (value: unknown): number | null | undefined =>
  value === null || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined;

/**
 * Every field, with the rule that decides whether an imported value is allowed
 * through and what it becomes. Returning `undefined` drops the key, leaving the
 * setting at whatever the user already had.
 *
 * Written as a table rather than a chain of `if`s so that adding a setting to
 * `HubSettings` and forgetting it here is visible in one place — a missing entry
 * means that setting silently never restores.
 */
const RULES: { [K in keyof HubSettings]: (value: unknown) => HubSettings[K] | undefined } = {
  // Free text the user typed; anything non-string is a corrupt file, not a preference.
  unsplashQuery: asString,
  locationCity: asString,
  language: asString,

  // A closed set the renderer switches on. An unknown source would leave the
  // background in a state no radio button matches.
  backgroundSource: (value) =>
    value === 'unsplash' || value === 'custom' ? value : undefined,

  // `useCalendar` maps over this on load. A string would reach `.map` and take
  // the dashboard down before the user could open the popup to undo the import.
  selectedCalendars: (value) =>
    Array.isArray(value) && value.every((id) => typeof id === 'string')
      ? (value as string[])
      : undefined,

  locationLat: asNullableNumber,
  locationLon: asNullableNumber,
  countdownTarget: asNullableString,

  // The three that already have sanitisers, reused rather than reimplemented so
  // an import cannot enforce different bounds from the settings store.
  backgroundDim: (value) => (value === undefined ? undefined : clampDim(value)),
  hiddenWidgets: (value) => (value === undefined ? undefined : sanitizeHiddenWidgets(value)),
  pomodoroWorkMinutes: (value) =>
    value === undefined ? undefined : clampPomodoroMinutes(value, DEFAULT_WORK_MINUTES),
  pomodoroBreakMinutes: (value) =>
    value === undefined ? undefined : clampPomodoroMinutes(value, DEFAULT_BREAK_MINUTES),
};

const RULE_KEYS = Object.keys(RULES) as (keyof HubSettings)[];

/**
 * Reads a backup file into the settings worth restoring, or null if it is not a
 * backup at all.
 *
 * Validates rather than trusts, because everything returned here goes into
 * `chrome.storage.sync` — which has a byte quota and propagates to the user's
 * other machines. The settings store sanitises what it *reads*, so a bad value
 * could never break the running page; it would still be written, synced and
 * carried around indefinitely. Filtering on the way in keeps the stored state
 * as clean as the rendered one.
 *
 * A rejected field drops out instead of resetting to its default: the file is
 * the untrustworthy party here, not the configuration the user already has.
 */
export const parseBackup = (text: string): Partial<HubSettings> | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !isRecord(parsed.settings)) return null;
  const source = parsed.settings;

  const restored: Partial<HubSettings> = {};
  for (const key of RULE_KEYS) {
    if (!(key in source)) continue;
    const value = RULES[key](source[key]);
    if (value !== undefined) {
      (restored as Record<string, unknown>)[key] = value;
    }
  }

  return restored;
};
