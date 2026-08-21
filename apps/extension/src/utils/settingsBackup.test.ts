import { describe, expect, it } from 'vitest';
import type { HubSettings } from '../hooks/useSettings';
import { MAX_DIM } from './dim';
import { MAX_MINUTES, MIN_MINUTES } from './pomodoro';
import { buildBackup, parseBackup } from './settingsBackup';

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
};

/** A backup file with `settings` replaced wholesale — the shape a hand edit produces. */
const fileWith = (settings: unknown) =>
  JSON.stringify({ version: 1, exportedAt: '2026-08-19T00:00:00.000Z', settings });

describe('buildBackup', () => {
  it('round-trips a configured dashboard', () => {
    expect(parseBackup(buildBackup(configured))).toEqual(configured);
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
    expect(parseBackup('not a backup')).toBeNull();
    expect(parseBackup('')).toBeNull();
  });

  it('rejects JSON that is not a backup', () => {
    expect(parseBackup('[1,2,3]')).toBeNull();
    expect(parseBackup('{"hello":"world"}')).toBeNull();
    expect(parseBackup(fileWith('a string, not an object'))).toBeNull();
  });

  it('ignores keys that are not settings', () => {
    // Everything returned here is written to chrome.storage.sync, which has a
    // byte quota and propagates to the user's other machines. A file with extra
    // keys must not be able to push anything into it.
    const parsed = parseBackup(fileWith({ locationCity: 'Szeged', evil: 'x'.repeat(5000) }));

    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!)).toEqual(['locationCity']);
  });

  it('clamps numbers that are out of range instead of storing them', () => {
    const parsed = parseBackup(
      fileWith({ backgroundDim: 9000, pomodoroWorkMinutes: 0, pomodoroBreakMinutes: 10_000 }),
    );

    expect(parsed?.backgroundDim).toBe(MAX_DIM);
    expect(parsed?.pomodoroWorkMinutes).toBe(MIN_MINUTES);
    expect(parsed?.pomodoroBreakMinutes).toBe(MAX_MINUTES);
  });

  it('drops a widget id the build does not know', () => {
    expect(parseBackup(fileWith({ hiddenWidgets: ['note', 'ghost-widget'] }))?.hiddenWidgets).toEqual(
      ['note'],
    );
  });

  it('refuses a selectedCalendars that is not a list of ids', () => {
    // `useCalendar` maps over this. A string would reach `.map` and take the
    // whole dashboard down on load, which is the worst outcome an import has —
    // the user cannot get back to the popup to undo it.
    expect(parseBackup(fileWith({ selectedCalendars: 'primary' }))?.selectedCalendars).toBeUndefined();
    expect(parseBackup(fileWith({ selectedCalendars: [1, 2] }))?.selectedCalendars).toBeUndefined();
    expect(parseBackup(fileWith({ selectedCalendars: ['primary'] }))?.selectedCalendars).toEqual([
      'primary',
    ]);
  });

  it('refuses a background source outside the two the UI can render', () => {
    expect(parseBackup(fileWith({ backgroundSource: 'bing' }))?.backgroundSource).toBeUndefined();
    expect(parseBackup(fileWith({ backgroundSource: 'custom' }))?.backgroundSource).toBe('custom');
  });

  it('refuses text fields that are not text', () => {
    const parsed = parseBackup(fileWith({ unsplashQuery: 42, locationCity: null, language: {} }));

    expect(parsed).toEqual({});
  });

  it('accepts a coordinate that is null, which is how "not set" is stored', () => {
    const parsed = parseBackup(fileWith({ locationLat: null, locationLon: 20.15 }));

    expect(parsed).toEqual({ locationLat: null, locationLon: 20.15 });
  });

  it('refuses a coordinate that is neither a number nor null', () => {
    expect(parseBackup(fileWith({ locationLat: '46.25' }))).toEqual({});
  });

  it('keeps a countdown target of null, which means no countdown', () => {
    expect(parseBackup(fileWith({ countdownTarget: null }))).toEqual({ countdownTarget: null });
  });
});
