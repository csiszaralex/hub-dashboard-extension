import { describe, expect, it } from 'vitest';
import type { HubSettings } from '../hooks/useSettings';
import { MAX_DIM } from './dim';
import { MAX_MINUTES, MIN_MINUTES } from './pomodoro';
import { BACKUP_VERSION, buildBackup, parseBackup } from './settingsBackup';

const configured: HubSettings = {
  unsplashQuery: 'forest,fog',
  backgroundSource: 'unsplash',
  backgroundDim: 45,
  locationCity: 'Szeged',
  locationLat: 46.25,
  locationLon: 20.15,
  selectedCalendars: ['primary', 'work@example.com'],
  countdownTarget: '2027-01-01',
  language: 'hu',
  hiddenWidgets: ['note'],
  pomodoroWorkMinutes: 30,
  pomodoroBreakMinutes: 7,
  quoteSource: 'citatum',
  quoteQuery: 'penz',
  customQuotes: [{ text: 'Be one.', author: 'Marcus Aurelius' }],
  memosUrl: 'https://memo.example.com',
  memosTag: 'work',
};

/** A backup file with `settings` replaced wholesale — the shape a hand edit produces. */
const fileWith = (settings: unknown, version: unknown = 1) =>
  JSON.stringify({ version, exportedAt: '2026-08-19T00:00:00.000Z', settings });

/** The settings an import would restore, or null when the file is refused. */
const restored = (text: string): Partial<HubSettings> | null => {
  const result = parseBackup(text);
  return result.ok ? result.settings : null;
};

describe('buildBackup', () => {
  it('round-trips a configured dashboard', () => {
    expect(restored(buildBackup(configured))).toEqual(configured);
  });

  it('writes something a human can read and edit', () => {
    // The point of a file over an opaque blob: a user can open it, see what the
    // extension stores about them, and fix a typo without a round trip.
    const text = buildBackup(configured);

    expect(text).toContain('\n');
    expect(JSON.parse(text)).toMatchObject({ version: 1, settings: { locationCity: 'Szeged' } });
  });
});

describe('parseBackup', () => {
  it('rejects a file that is not JSON at all', () => {
    expect(parseBackup('not a backup')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseBackup('')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects JSON that is not a backup', () => {
    expect(restored('[1,2,3]')).toBeNull();
    expect(restored('{"hello":"world"}')).toBeNull();
    expect(restored(fileWith('a string, not an object'))).toBeNull();
  });

  it('ignores keys that are not settings', () => {
    // Everything returned here is written to chrome.storage.sync, which has a
    // byte quota and propagates to the user's other machines. A file with extra
    // keys must not be able to push anything into it.
    const parsed = restored(fileWith({ locationCity: 'Szeged', evil: 'x'.repeat(5000) }));

    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!)).toEqual(['locationCity']);
  });

  it('never restores the settings version, which is not a setting', () => {
    expect(restored(fileWith({ settingsVersion: 99, locationCity: 'Szeged' }))).toEqual({
      locationCity: 'Szeged',
    });
  });

  it('clamps numbers that are out of range instead of storing them', () => {
    const parsed = restored(
      fileWith({ backgroundDim: 9000, pomodoroWorkMinutes: 0, pomodoroBreakMinutes: 10_000 }),
    );

    expect(parsed?.backgroundDim).toBe(MAX_DIM);
    expect(parsed?.pomodoroWorkMinutes).toBe(MIN_MINUTES);
    expect(parsed?.pomodoroBreakMinutes).toBe(MAX_MINUTES);
  });

  it('drops an invalid field and keeps the rest', () => {
    // Dropped, not reset: the user's current value for that field stays, since
    // the file is the untrustworthy party, not the configuration they have.
    expect(
      restored(
        fileWith({
          locationCity: 'Szeged',
          backgroundDim: 'dark',
          pomodoroWorkMinutes: null,
          hiddenWidgets: 'note',
          customQuotes: { text: 'not a list' },
        }),
      ),
    ).toEqual({ locationCity: 'Szeged' });
  });

  it('drops a widget id the build does not know', () => {
    expect(restored(fileWith({ hiddenWidgets: ['note', 'ghost-widget'] }))?.hiddenWidgets).toEqual(
      ['note'],
    );
  });

  it('refuses a selectedCalendars that is not a list of ids', () => {
    // `useCalendar` maps over this. A string would reach `.map` and take the
    // whole dashboard down on load, which is the worst outcome an import has —
    // the user cannot get back to the popup to undo it.
    expect(restored(fileWith({ selectedCalendars: 'primary' }))?.selectedCalendars).toBeUndefined();
    expect(restored(fileWith({ selectedCalendars: [1, 2] }))?.selectedCalendars).toBeUndefined();
    expect(restored(fileWith({ selectedCalendars: ['primary'] }))?.selectedCalendars).toEqual([
      'primary',
    ]);
  });

  it('refuses a background source outside the two the UI can render', () => {
    expect(restored(fileWith({ backgroundSource: 'bing' }))?.backgroundSource).toBeUndefined();
    expect(restored(fileWith({ backgroundSource: 'custom' }))?.backgroundSource).toBe('custom');
  });

  it('refuses text fields that are not text', () => {
    const parsed = restored(fileWith({ unsplashQuery: 42, locationCity: null, language: {} }));

    expect(parsed).toEqual({});
  });

  it('accepts a coordinate that is null, which is how "not set" is stored', () => {
    const parsed = restored(fileWith({ locationLat: null, locationLon: 20.15 }));

    expect(parsed).toEqual({ locationLat: null, locationLon: 20.15 });
  });

  it('refuses a coordinate that is neither a number nor null', () => {
    expect(restored(fileWith({ locationLat: '46.25' }))).toEqual({});
  });

  it('keeps a countdown target of null, which means no countdown', () => {
    expect(restored(fileWith({ countdownTarget: null }))).toEqual({ countdownTarget: null });
  });
});

describe('parseBackup — version', () => {
  it('accepts the current version and an older one', () => {
    expect(parseBackup(fileWith({ locationCity: 'Szeged' }, BACKUP_VERSION)).ok).toBe(true);
    expect(parseBackup(fileWith({ locationCity: 'Szeged' }, 0)).ok).toBe(true);
  });

  it('rejects a backup written by a newer build', () => {
    // This build cannot know what a newer one meant by its fields, so it says
    // so instead of guessing and restoring the wrong thing.
    expect(parseBackup(fileWith({ locationCity: 'Szeged' }, BACKUP_VERSION + 1))).toEqual({
      ok: false,
      reason: 'newer',
    });
  });

  it('treats a file without a usable version as not a backup', () => {
    // Every file `buildBackup` has written carries one.
    expect(parseBackup(JSON.stringify({ settings: {} }))).toEqual({ ok: false, reason: 'invalid' });
    expect(parseBackup(fileWith({}, '1'))).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('parseBackup — quote source', () => {
  it('restores the quote source and category', () => {
    const parsed = restored(
      JSON.stringify({ version: 1, settings: { quoteSource: 'citatum', quoteQuery: 'penz' } }),
    );

    expect(parsed).toEqual({ quoteSource: 'citatum', quoteQuery: 'penz' });
  });

  it('has a rule for every settings field', () => {
    // The schema's decoder table is keyed by `HubSettings` field precisely so a
    // setting added later cannot silently never restore. This is that promise,
    // checked: a field with no rule drops out of an import, and nobody notices
    // until someone restores a backup and one preference is missing.
    const everyField = JSON.stringify({ version: 1, settings: configured });

    expect(Object.keys(restored(everyField) ?? {}).sort()).toEqual(Object.keys(configured).sort());
  });
});

describe('memos settings', () => {
  it('restores a valid https base url', () => {
    const file = JSON.stringify({
      version: 1,
      settings: { memosUrl: 'https://memo.example.com/', memosTag: 'todo' },
    });
    expect(restored(file)).toEqual({ memosUrl: 'https://memo.example.com', memosTag: 'todo' });
  });

  // Dropped rather than reset: the file is the untrustworthy party, not the
  // configuration the user already has.
  it('drops a non-https base url', () => {
    const file = JSON.stringify({ version: 1, settings: { memosUrl: 'http://memo.example.com' } });
    expect(restored(file)).toEqual({});
  });

  // The token lives outside HubSettings precisely so it cannot be written to a
  // backup file. A file that carries one anyway must not put it back.
  it('ignores a token smuggled into a backup file', () => {
    const file = JSON.stringify({
      version: 1,
      settings: { memosUrl: 'https://memo.example.com', memosToken: 'memos_pat_leaked' },
    });
    expect(restored(file)).toEqual({ memosUrl: 'https://memo.example.com' });
  });
});
