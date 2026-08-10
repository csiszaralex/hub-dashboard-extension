import type { PomodoroPhase } from './pomodoro';

/**
 * The one place the running timer lives.
 *
 * The timer used to be React state inside `usePomodoro`, which made it per-tab:
 * two new tabs showed two different countdowns, and each ran its own interval
 * and raised its own system notification at a phase change. The service worker
 * owns the timer now, tabs only render it, and this module is the record they
 * share.
 *
 * `chrome.storage.local` rather than `localStorage`, because a service worker
 * has no access to the latter — the same constraint `utils/prefetch` lives
 * under. Nothing in this module, or anything it imports, may touch `window`,
 * `document` or `localStorage`.
 */
export const POMODORO_STATE_KEY = 'pomodoro_state';

/** Name of the single alarm that ends whichever phase is currently running. */
export const POMODORO_ALARM = 'pomodoro-phase';

export interface PomodoroState {
  phase: PomodoroPhase;
  /** Epoch ms at which the current phase ends; `null` when idle. */
  endsAt: number | null;
  running: boolean;
  /**
   * Bumped by every Start, Reset and phase transition, and used as a
   * compare-and-swap token by the worker.
   *
   * `chrome.storage.local` has no atomic read-modify-write, and the worker's
   * handlers all await between reading the state and writing it back, so two of
   * them can interleave: a Reset landing inside a transition used to be
   * overwritten, resurrecting the session the user had just ended. A handler
   * that captures this value at read time and refuses to write when it has
   * moved cannot clobber a decision made while it was suspended.
   *
   * It lives in the stored state rather than in a module-level promise chain
   * because the worker is torn down whenever it goes idle.
   */
  epoch: number;
}

export const IDLE_POMODORO: PomodoroState = {
  phase: 'work',
  endsAt: null,
  running: false,
  epoch: 0,
};

/**
 * What a page sends the worker. The worker answers nothing.
 *
 * `pomodoro/ping` asks for no change: it exists so that opening a tab wakes the
 * worker. A tab reads this state straight from `chrome.storage.local`, so
 * nothing else about rendering the timer touches the worker at all — and a
 * session whose alarm went missing would otherwise stay frozen until the daily
 * prefetch alarm, a browser restart, or the user pressing something.
 */
export type PomodoroMessage =
  | { type: 'pomodoro/start' }
  | { type: 'pomodoro/reset' }
  | { type: 'pomodoro/ping' };

const isPhase = (value: unknown): value is PomodoroPhase => value === 'work' || value === 'break';

/**
 * Turns whatever is in storage into a `PomodoroState`, falling back to idle.
 *
 * Exported because the page reaches the state two ways — an initial
 * `storage.local.get` and the `newValue` of a `storage.onChanged` event — and
 * both must validate identically. A record that is anything other than exactly
 * what the worker writes is treated as absent: `chrome.storage.local` is shared
 * with the rest of the extension and editable from devtools, and a half-valid
 * record renders as a stuck or NaN countdown with no way for the user to tell
 * why.
 */
export const parsePomodoroState = (value: unknown): PomodoroState => {
  if (typeof value !== 'object' || value === null) return IDLE_POMODORO;

  const { phase, endsAt, running, epoch } = value as Partial<PomodoroState>;
  if (!isPhase(phase)) return IDLE_POMODORO;
  if (typeof running !== 'boolean') return IDLE_POMODORO;
  if (endsAt !== null && !Number.isFinite(endsAt)) return IDLE_POMODORO;

  // A deadline only means something while the timer runs, and a run without a
  // deadline is a countdown to nothing — neither combination is renderable, so
  // the two fields are reconciled here instead of at every read site.
  if (running && endsAt === null) return IDLE_POMODORO;

  return {
    phase,
    endsAt: running ? (endsAt as number) : null,
    running,
    // Deliberately repaired rather than rejected, unlike every field above. A
    // missing `epoch` is exactly what a record written by the previous version
    // of the extension looks like, and throwing that away would cancel a
    // running session on update. It is an internal concurrency token, not
    // something the user can see, so starting it at 0 costs nothing.
    epoch: Number.isFinite(epoch) ? (epoch as number) : 0,
  };
};

export const readPomodoroState = (): Promise<PomodoroState> =>
  new Promise((resolve) => {
    chrome.storage.local.get([POMODORO_STATE_KEY], (items) => {
      resolve(parsePomodoroState(items[POMODORO_STATE_KEY]));
    });
  });

export const writePomodoroState = (state: PomodoroState): Promise<void> =>
  new Promise((resolve) => {
    chrome.storage.local.set({ [POMODORO_STATE_KEY]: state }, () => resolve());
  });
