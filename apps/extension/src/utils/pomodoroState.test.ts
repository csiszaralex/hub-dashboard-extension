import { describe, expect, it } from 'vitest';
import { installChromeStub, type ChromeStub } from '../test/chromeStub';
import { pomodoroState } from '../test/pomodoroState';
import {
  IDLE_POMODORO,
  parsePomodoroState,
  POMODORO_STATE_KEY,
  readPomodoroState,
  writePomodoroState,
} from './pomodoroState';

/** A raw stored record, as `chrome.storage.local` would hand it back. */
const running = (endsAt: number) => ({ phase: 'work' as const, endsAt, running: true, epoch: 4 });

describe('parsePomodoroState', () => {
  it('accepts a well-formed state', () => {
    const state = { phase: 'break' as const, endsAt: 1_700_000_000_000, running: true, epoch: 7 };
    expect(parsePomodoroState(state)).toEqual(state);
  });

  // A record written by the version of the extension that predates `epoch` — the
  // one case repaired rather than rejected, because rejecting it would cancel a
  // session that was running across the update.
  it('keeps a pre-epoch record, starting its epoch at zero', () => {
    expect(parsePomodoroState({ phase: 'break', endsAt: 1_700_000_000_000, running: true })).toEqual(
      { phase: 'break', endsAt: 1_700_000_000_000, running: true, epoch: 0 },
    );
  });

  it('repairs a non-numeric epoch instead of dropping the session', () => {
    expect(
      parsePomodoroState({ phase: 'work', endsAt: 1_700_000_000_000, running: true, epoch: 'x' }),
    ).toMatchObject({ running: true, epoch: 0 });
  });

  it('accepts a well-formed idle state', () => {
    expect(parsePomodoroState({ phase: 'work', endsAt: null, running: false })).toEqual(
      IDLE_POMODORO,
    );
  });

  // Everything below is a value the page could actually be handed: the key is
  // absent on a fresh profile, and `chrome.storage.local` is writable by any
  // other part of the extension and inspectable (and editable) from devtools.
  it('falls back to idle when nothing was ever stored', () => {
    expect(parsePomodoroState(undefined)).toEqual(IDLE_POMODORO);
  });

  it('falls back to idle for null', () => {
    expect(parsePomodoroState(null)).toEqual(IDLE_POMODORO);
  });

  it('falls back to idle for a value that is not an object', () => {
    expect(parsePomodoroState('running')).toEqual(IDLE_POMODORO);
    expect(parsePomodoroState(42)).toEqual(IDLE_POMODORO);
    expect(parsePomodoroState(true)).toEqual(IDLE_POMODORO);
  });

  it('falls back to idle when the phase is missing', () => {
    expect(parsePomodoroState({ endsAt: 1, running: true })).toEqual(IDLE_POMODORO);
  });

  it('falls back to idle when the phase is not one of the two phases', () => {
    expect(parsePomodoroState({ phase: 'lunch', endsAt: 1, running: true })).toEqual(
      IDLE_POMODORO,
    );
  });

  it('falls back to idle when endsAt is neither a number nor null', () => {
    expect(parsePomodoroState({ phase: 'work', endsAt: '1700000000000', running: true })).toEqual(
      IDLE_POMODORO,
    );
    expect(parsePomodoroState({ phase: 'work', endsAt: undefined, running: true })).toEqual(
      IDLE_POMODORO,
    );
  });

  // `JSON.stringify(NaN)` is `"null"`, so a NaN deadline cannot survive a
  // storage round-trip — but a non-finite number reaching the parser any other
  // way would make `endsAt - Date.now()` NaN and freeze the display, so it is
  // refused here rather than rendered.
  it('falls back to idle for a non-finite endsAt', () => {
    expect(parsePomodoroState({ phase: 'work', endsAt: Number.NaN, running: true })).toEqual(
      IDLE_POMODORO,
    );
    expect(parsePomodoroState({ phase: 'work', endsAt: Infinity, running: true })).toEqual(
      IDLE_POMODORO,
    );
  });

  it('falls back to idle when running is not a boolean', () => {
    expect(parsePomodoroState({ phase: 'work', endsAt: 1, running: 'yes' })).toEqual(
      IDLE_POMODORO,
    );
  });

  // The worker only ever writes the two consistent combinations. This one can
  // only arrive from a hand-edited or half-written record, and it has no
  // rendering: "running" with no deadline is a countdown to nothing.
  it('falls back to idle for a running state with no deadline', () => {
    expect(parsePomodoroState({ phase: 'break', endsAt: null, running: true })).toEqual(
      IDLE_POMODORO,
    );
  });

  it('keeps a stopped state that still carries a deadline, minus the deadline', () => {
    expect(parsePomodoroState({ phase: 'break', endsAt: 1, running: false, epoch: 2 })).toEqual({
      phase: 'break',
      endsAt: null,
      running: false,
      epoch: 2,
    });
  });

  it('ignores extra properties rather than rejecting the whole record', () => {
    expect(parsePomodoroState({ ...running(5), rounds: 3 })).toEqual(running(5));
  });
});

describe('readPomodoroState / writePomodoroState', () => {
  let chromeStub: ChromeStub;

  const install = () => {
    chromeStub = installChromeStub();
    return chromeStub;
  };

  it('reads back exactly what was written', async () => {
    install();
    const state = pomodoroState({ phase: 'break', endsAt: 1_700_000_000_000, running: true });

    await writePomodoroState(state);

    expect(await readPomodoroState()).toEqual(state);
  });

  it('writes under the shared key so the worker and the page meet in one place', async () => {
    const stub = install();

    await writePomodoroState(IDLE_POMODORO);

    expect(stub.readLocal(POMODORO_STATE_KEY)).toEqual(IDLE_POMODORO);
  });

  it('reads idle when nothing was ever written', async () => {
    install();
    expect(await readPomodoroState()).toEqual(IDLE_POMODORO);
  });

  it('reads idle when the stored record is malformed', async () => {
    const stub = install();
    stub.seedLocal({ [POMODORO_STATE_KEY]: { phase: 'work' } });

    expect(await readPomodoroState()).toEqual(IDLE_POMODORO);
  });

  it('announces the write to the other tabs listening on the local area', async () => {
    install();
    const seen: unknown[] = [];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && POMODORO_STATE_KEY in changes) {
        seen.push(changes[POMODORO_STATE_KEY].newValue);
      }
    });

    await writePomodoroState(pomodoroState(running(1_700_000_000_000)));

    expect(seen).toEqual([pomodoroState(running(1_700_000_000_000))]);
  });
});
