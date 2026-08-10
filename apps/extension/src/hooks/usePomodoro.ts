import { useCallback, useEffect, useState } from 'react';
import { phaseDurationMs } from '../utils/pomodoro';
import {
  IDLE_POMODORO,
  parsePomodoroState,
  POMODORO_STATE_KEY,
  readPomodoroState,
  type PomodoroMessage,
  type PomodoroState,
} from '../utils/pomodoroState';
import { useSettings } from './useSettings';

const TICK_MS = 1000;

/**
 * The worker answers nothing, so the reply callback exists only to read
 * `runtime.lastError`. Without it Chrome logs an unchecked-lastError warning
 * for every Start and Reset ("the message port closed before a response was
 * received"), and the promise-returning form would surface the same thing as an
 * unhandled rejection in the page console.
 */
const send = (message: PomodoroMessage) => {
  chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
};

/**
 * Renders the timer the service worker owns; it does not run one.
 *
 * The timer used to live here, which made it per-tab — two new tabs showed two
 * different countdowns, and each ran its own interval and raised its own system
 * notification at a phase change. Now the deadline, the transition and the
 * notification all belong to `background.ts`, and this hook does two things:
 * mirror `chrome.storage.local`, and tick a display clock while something is
 * running. `start` and `reset` post a message and change nothing locally, so
 * every tab — and no tab at all — sees the same session.
 */
export const usePomodoro = () => {
  const { settings, isLoaded } = useSettings();
  const [state, setState] = useState<PomodoroState>(IDLE_POMODORO);
  const [stateLoaded, setStateLoaded] = useState(false);
  // Not `Date.now()` during render: `remainingMs` has to change once a second
  // while the phase itself does not, and a render that reads the clock directly
  // is impure. `now` is refreshed both by the tick below and whenever a new
  // state arrives, so a countdown is never a tick out of date at the moment it
  // appears.
  const [now, setNow] = useState(0);

  useEffect(() => {
    let live = true;
    const adopt = (next: PomodoroState) => {
      setState(next);
      setNow(Date.now());
    };

    void readPomodoroState().then((stored) => {
      if (!live) return;
      adopt(stored);
      setStateLoaded(true);

      // Everything else here reads storage directly, so rendering the timer
      // never touches the worker. That leaves one gap: a session whose alarm was
      // lost — the worker torn down between writing the state and creating the
      // alarm — is only put right when something wakes the worker, and opening a
      // new tab otherwise does not. This ping makes opening a tab one of those
      // things, which is the one moment the user is looking at the timer.
      //
      // Only when a session is actually running: there is nothing to rehydrate
      // otherwise, and someone who never uses the timer should not wake the
      // worker every time they open a tab.
      if (stored.running) send({ type: 'pomodoro/ping' });
    });

    // The only channel between tabs, and between the worker and a tab. A tab
    // opened mid-session picks the session up from the initial read above; from
    // then on every change — including the worker's phase transitions — arrives
    // here.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !(POMODORO_STATE_KEY in changes)) return;
      adopt(parsePomodoroState(changes[POMODORO_STATE_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);

    return () => {
      live = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  // Display only. Nothing here decides a phase is over — the worker's alarm
  // does, whether or not this tab is open.
  useEffect(() => {
    if (!state.running) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [state.running]);

  const remainingMs =
    state.running && state.endsAt !== null
      ? Math.max(0, state.endsAt - now)
      : // Idle shows the length the next phase would have, which is always the
        // work length, and follows the setting as soon as it is changed.
        phaseDurationMs(state.phase, settings.pomodoroWorkMinutes, settings.pomodoroBreakMinutes);

  const start = useCallback(() => send({ type: 'pomodoro/start' }), []);
  const reset = useCallback(() => send({ type: 'pomodoro/reset' }), []);

  return {
    phase: state.phase,
    running: state.running,
    remainingMs,
    // Both halves: the settings give the idle length, the stored state gives
    // the session. Rendering before the state arrives would flash a full work
    // length on every new tab opened during a session.
    ready: isLoaded && stateLoaded,
    start,
    reset,
  };
};
