import { IDLE_POMODORO, type PomodoroState } from '../utils/pomodoroState';

/**
 * Builds a `PomodoroState` from only the fields a test actually cares about.
 *
 * A test should read as "a running break with 40 seconds left", not restate
 * every field of the record — and bookkeeping fields the worker owns, like
 * `epoch`, are noise in a test about what the user sees. Going through one
 * builder also means the next field added to `PomodoroState` does not send
 * someone editing a dozen object literals.
 *
 * Deliberately typed to `PomodoroState`, so a test cannot use this to smuggle in
 * a malformed record — the parser tests build those as raw objects on purpose.
 */
export const pomodoroState = (overrides: Partial<PomodoroState> = {}): PomodoroState => ({
  ...IDLE_POMODORO,
  ...overrides,
});

/** The common case: a phase that is running and ends `msFromNow` from now. */
export const runningPomodoro = (
  phase: PomodoroState['phase'],
  msFromNow: number,
  overrides: Partial<PomodoroState> = {},
): PomodoroState =>
  pomodoroState({ phase, endsAt: Date.now() + msFromNow, running: true, ...overrides });
