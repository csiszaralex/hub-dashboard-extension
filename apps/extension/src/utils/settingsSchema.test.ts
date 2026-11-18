import { DEFAULT_BACKGROUND_TAGS, DEFAULT_QUOTE_SOURCE_ID } from '@hub/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIM, MAX_DIM } from './dim';
import { DEFAULT_BREAK_MINUTES, DEFAULT_WORK_MINUTES, MAX_MINUTES, MIN_MINUTES } from './pomodoro';
import {
  applyStoredSettings,
  CURRENT_SETTINGS_VERSION,
  decodeSetting,
  decodeSettings,
  DEFAULT_SETTINGS,
  migrateStoredSettings,
  migrationWrites,
  readSettings,
  SETTING_KEYS,
  SETTINGS_VERSION_KEY,
  type HubSettings,
  type SettingKey,
  type SettingsMigration,
} from './settingsSchema';

/**
 * Per field: values the decoder must accept (with what they become) and values
 * it must refuse. Typed over every key, so a field added without a row here
 * fails the type check, as a field added without a decoder does in the schema.
 */
const CASES: {
  [K in SettingKey]: { valid: [unknown, HubSettings[K]][]; invalid: unknown[] };
} = {
  unsplashQuery: { valid: [['forest', 'forest'], ['', '']], invalid: [42, null, ['forest']] },
  locationCity: { valid: [['Szeged', 'Szeged']], invalid: [1, null, {}] },
  language: { valid: [['hu', 'hu'], ['', '']], invalid: [7, null] },
  quoteSource: { valid: [['citatum', 'citatum']], invalid: [false, null] },
  quoteQuery: { valid: [['penz', 'penz'], ['', '']], invalid: [[], null] },
  backgroundSource: {
    valid: [
      ['unsplash', 'unsplash'],
      ['custom', 'custom'],
    ],
    invalid: ['bing', 'Custom', null, 1],
  },
  backgroundDim: {
    valid: [
      [45, 45],
      [9000, MAX_DIM],
      [-5, 0],
      ['40', 40],
      [12.6, 13],
    ],
    invalid: ['dark', '', null, true, Number.NaN, Number.POSITIVE_INFINITY],
  },
  locationLat: { valid: [[46.25, 46.25], [null, null], [0, 0]], invalid: ['46.25', Number.NaN] },
  locationLon: { valid: [[20.15, 20.15], [null, null]], invalid: [{}, Number.NaN] },
  selectedCalendars: {
    valid: [
      [['primary', 'work@example.com'], ['primary', 'work@example.com']],
      [[], []],
    ],
    invalid: ['primary', [1, 2], ['primary', null], null],
  },
  countdownTarget: { valid: [['2027-01-01', '2027-01-01'], [null, null]], invalid: [20270101] },
  hiddenWidgets: {
    valid: [
      [['note', 'ghost-widget'], ['note']],
      [['note', 'note'], ['note']],
      [[], []],
    ],
    invalid: ['note', null, {}],
  },
  pomodoroWorkMinutes: {
    valid: [
      [30, 30],
      [0, MIN_MINUTES],
      [10_000, MAX_MINUTES],
      ['45', 45],
    ],
    invalid: ['abc', '', '   ', null, Number.NaN],
  },
  pomodoroBreakMinutes: {
    valid: [
      [7, 7],
      [500, MAX_MINUTES],
    ],
    invalid: ['abc', null, false],
  },
  customQuotes: {
    valid: [
      [[{ text: ' Be one. ', author: 'Marcus' }], [{ text: 'Be one.', author: 'Marcus' }]],
      [[{ text: '' }, 'junk'], []],
    ],
    invalid: [{ text: 'not a list' }, 'Be one.', null],
  },
  memosUrl: {
    valid: [['https://memo.example.com/', 'https://memo.example.com']],
    invalid: ['http://memo.example.com', 'not a url', '', 42, null],
  },
  memosTag: { valid: [['#todo', 'todo'], [' work ', 'work'], ['', '']], invalid: [42, null] },
};

describe('settings decoders', () => {
  it('has a test case for every field', () => {
    expect(Object.keys(CASES).sort()).toEqual([...SETTING_KEYS].sort());
  });

  describe.each(SETTING_KEYS)('%s', (key) => {
    const { invalid } = CASES[key];
    // Widened from the per-key union, which `it.each`'s overloads cannot take.
    const valid: [unknown, unknown][] = CASES[key].valid;

    it.each(valid)('accepts %j', (input, expected) => {
      expect(decodeSetting(key, input)).toEqual(expected);
    });

    it.each(invalid.map((value) => [value]))('refuses %j', (input) => {
      expect(decodeSetting(key, input)).toBeUndefined();
    });
  });

  // Except `memosUrl`, whose default `''` means "not connected": refusing it
  // keeps a backup from a machine without Memos from disconnecting this one,
  // and on the read path it becomes `''` again anyway.
  it.each(SETTING_KEYS.filter((key) => key !== 'memosUrl'))('accepts the default %s', (key) => {
    expect(decodeSetting(key, DEFAULT_SETTINGS[key])).toEqual(DEFAULT_SETTINGS[key]);
  });

  it('takes the defaults the API also uses from @hub/shared', () => {
    expect(DEFAULT_SETTINGS.unsplashQuery).toBe(DEFAULT_BACKGROUND_TAGS);
    expect(DEFAULT_SETTINGS.quoteSource).toBe(DEFAULT_QUOTE_SOURCE_ID);
  });

  it('keeps the pomodoro defaults the timer module declares', () => {
    expect(DEFAULT_SETTINGS.pomodoroWorkMinutes).toBe(DEFAULT_WORK_MINUTES);
    expect(DEFAULT_SETTINGS.pomodoroBreakMinutes).toBe(DEFAULT_BREAK_MINUTES);
    expect(DEFAULT_SETTINGS.backgroundDim).toBe(DEFAULT_DIM);
  });
});

describe('read policy (readSettings / applyStoredSettings)', () => {
  it.each(SETTING_KEYS)('falls back to the default for an invalid %s', (key) => {
    const [invalid] = CASES[key].invalid;
    expect(readSettings({ [key]: invalid })[key]).toEqual(DEFAULT_SETTINGS[key]);
  });

  it('falls back for a calendar list stored as a string and an unknown background source', () => {
    const settings = readSettings({ selectedCalendars: 'primary', backgroundSource: 'bing' });

    expect(settings.selectedCalendars).toEqual(['primary']);
    expect(settings.backgroundSource).toBe('unsplash');
  });

  it('keeps every valid stored value and ignores keys that are not settings', () => {
    const settings = readSettings({
      locationCity: 'Szeged',
      backgroundDim: 45,
      [SETTINGS_VERSION_KEY]: 1,
      junk: 'x',
    });

    expect(settings).toEqual({ ...DEFAULT_SETTINGS, locationCity: 'Szeged', backgroundDim: 45 });
    expect(settings).not.toHaveProperty('junk');
    expect(settings).not.toHaveProperty(SETTINGS_VERSION_KEY);
  });

  it('leaves settings that are absent from the change at their current value', () => {
    const current = { ...DEFAULT_SETTINGS, locationCity: 'Szeged', memosTag: 'todo' };

    const next = applyStoredSettings(current, { memosTag: 42 });

    expect(next.locationCity).toBe('Szeged');
    expect(next.memosTag).toBe('');
  });

  it('treats a removed key, reported as undefined, as missing', () => {
    const current = { ...DEFAULT_SETTINGS, pomodoroWorkMinutes: 40 };

    expect(applyStoredSettings(current, { pomodoroWorkMinutes: undefined }).pomodoroWorkMinutes).toBe(
      DEFAULT_WORK_MINUTES,
    );
  });
});

describe('import policy (decodeSettings)', () => {
  it('drops an invalid field and keeps the rest', () => {
    expect(
      decodeSettings({ locationCity: 'Szeged', selectedCalendars: 'primary', backgroundDim: 45 }),
    ).toEqual({ locationCity: 'Szeged', backgroundDim: 45 });
  });

  it('never invents a value for a field the source does not have', () => {
    expect(decodeSettings({})).toEqual({});
  });

  it('keeps a valid null rather than dropping it', () => {
    expect(decodeSettings({ countdownTarget: null })).toEqual({ countdownTarget: null });
  });
});

describe('migrateStoredSettings', () => {
  const tagging =
    (label: string, log: string[]): SettingsMigration =>
    (stored) => {
      log.push(label);
      return { ...stored, trail: `${String(stored.trail ?? '')}${label}` };
    };

  it('is at version 1 with no migrations yet', () => {
    expect(CURRENT_SETTINGS_VERSION).toBe(1);
  });

  it('records version 1 for settings stored before versioning, changing nothing else', () => {
    const stored = { locationCity: 'Szeged' };

    const result = migrateStoredSettings(stored);

    expect(result).toEqual({ stored, writeVersion: 1 });
    expect(migrationWrites(stored, result)).toEqual({
      set: { [SETTINGS_VERSION_KEY]: 1 },
      remove: [],
    });
  });

  it('does nothing when the stored version is current', () => {
    const stored = { [SETTINGS_VERSION_KEY]: 1, locationCity: 'Szeged' };

    const result = migrateStoredSettings(stored);

    expect(result.writeVersion).toBeNull();
    expect(migrationWrites(stored, result)).toBeNull();
  });

  it('runs every step from the stored version, in order, and records the last', () => {
    const log: string[] = [];
    const migrations = [tagging('a', log), tagging('b', log), tagging('c', log)];

    const result = migrateStoredSettings({ [SETTINGS_VERSION_KEY]: 2 }, migrations);

    expect(log).toEqual(['b', 'c']);
    expect(result.stored.trail).toBe('bc');
    expect(result.writeVersion).toBe(4);
  });

  it('runs every step for settings that carry no version', () => {
    const log: string[] = [];

    migrateStoredSettings({}, [tagging('a', log), tagging('b', log)]);

    expect(log).toEqual(['a', 'b']);
  });

  it('leaves a version from a newer build alone', () => {
    const log: string[] = [];
    const stored = { [SETTINGS_VERSION_KEY]: 9 };

    const result = migrateStoredSettings(stored, [tagging('a', log)]);

    expect(log).toEqual([]);
    expect(result).toEqual({ stored, writeVersion: null });
  });

  it('writes a renamed key and removes the old one', () => {
    const rename: SettingsMigration = ({ oldName, ...rest }) => ({ ...rest, newName: oldName });
    const before = { oldName: 'x', locationCity: 'Szeged' };

    const writes = migrationWrites(before, migrateStoredSettings(before, [rename]));

    expect(writes).toEqual({ set: { [SETTINGS_VERSION_KEY]: 2, newName: 'x' }, remove: ['oldName'] });
  });
});
