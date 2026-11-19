import { decodeSettings, type HubSettings, type SettingKey } from './settingsSchema';

/**
 * Bumped only if the file's shape changes in a way an older build cannot read.
 * Import refuses a file with a higher number: this build cannot know what a
 * newer one put in it, so guessing could restore the wrong thing. A lower one
 * is accepted; there is none yet, and when there is, reading it is this
 * build's job.
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

export type BackupParseResult =
  | { ok: true; settings: Partial<HubSettings> }
  /** `invalid`: not a backup at all. `newer`: a backup from a newer build. */
  | { ok: false; reason: 'invalid' | 'newer' };

/**
 * Reads a backup file into the settings worth restoring.
 *
 * Validates rather than trusts, because everything returned here goes into
 * `chrome.storage.sync` — which has a byte quota and propagates to the user's
 * other machines. The page would survive a bad value anyway: `useSettings`
 * decodes what it reads and falls back to the default. But the value would
 * still be written, synced and carried around indefinitely, so the same
 * decoders filter it on the way in.
 *
 * The policy differs from the read path's: a rejected field drops out instead
 * of resetting to its default (see `decodeSettings`), since the file is the
 * untrustworthy party here, not the configuration the user already has.
 */
export const parseBackup = (text: string): BackupParseResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (!isRecord(parsed) || !isRecord(parsed.settings)) return { ok: false, reason: 'invalid' };
  // Every file `buildBackup` has ever written carries a version, so one
  // without a usable number was not written by it.
  const { version } = parsed;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { ok: false, reason: 'invalid' };
  }
  if (version > BACKUP_VERSION) return { ok: false, reason: 'newer' };

  return { ok: true, settings: decodeSettings(parsed.settings) };
};

/**
 * Structural equality for setting values: primitives, `null`, arrays and plain
 * objects (`customQuotes` entries), which is every shape `HubSettings` holds.
 * Object keys are compared as a set, since a hand-edited file may order them
 * differently and still mean the same quote.
 */
const sameValue = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameValue(item, b[i]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
  );
};

/**
 * How many of the settings an import would write differ from the ones in
 * place — what the popup shows before it asks to apply them.
 */
export const countChangedSettings = (
  current: HubSettings,
  incoming: Partial<HubSettings>,
): number =>
  (Object.keys(incoming) as SettingKey[]).filter((key) => !sameValue(current[key], incoming[key]))
    .length;
