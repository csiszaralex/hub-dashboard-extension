import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStub, type ChromeStub } from '../test/chromeStub';
import { pomodoroState, runningPomodoro } from '../test/pomodoroState';
import { POMODORO_STATE_KEY, writePomodoroState } from '../utils/pomodoroState';

const POMODORO_ALARM = 'pomodoro-phase';
const MINUTE = 60_000;

const load = async () => (await import('./usePomodoro')).usePomodoro;

/** Registers the service worker's listeners, so Start and Reset reach an owner. */
const loadWorker = async () => void (await import('../background'));

let chromeStub: ChromeStub;

/**
 * Drains the microtask queue inside `act`.
 *
 * Every chrome stub callback resolves through `queueMicrotask`, which
 * `vi.useFakeTimers()` leaves alone, so a Start travels page -> worker ->
 * storage -> back into both hooks without the clock moving at all. The loop
 * only has to outlast the longest of those chains.
 */
const flush = () =>
  act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });

/** Writes the state the way the service worker would, from outside every hook. */
const drive = (state: ReturnType<typeof pomodoroState>) =>
  act(async () => {
    await writePomodoroState(state);
  });

const mount = async (usePomodoro: () => ReturnType<Awaited<ReturnType<typeof load>>>) => {
  const rendered = renderHook(() => usePomodoro());
  await waitFor(() => expect(rendered.result.current.ready).toBe(true));
  return rendered;
};

beforeEach(() => {
  // `@testing-library`'s `waitFor` only switches to its fake-timer-aware
  // polling loop (which drives the clock itself via `jest.advanceTimersByTime`
  // instead of a real `setInterval`) when it detects a global `jest`. Vitest
  // never defines one, so without this alias `waitFor` falls back to a real
  // `setInterval`-based poll that never fires once `vi.useFakeTimers()` has
  // frozen the clock, and the awaited `ready` check below hangs until the
  // suite's own timeout. `vi.advanceTimersByTime` is signature-compatible
  // with `jest.advanceTimersByTime`, so aliasing is enough to satisfy it.
  (globalThis as unknown as { jest?: typeof vi }).jest = vi;
  vi.useFakeTimers();
  chromeStub = installChromeStub();
  chromeStub.seedSync({ pomodoroWorkMinutes: 1, pomodoroBreakMinutes: 1 });
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { jest?: typeof vi }).jest;
});

describe('usePomodoro', () => {
  it('starts idle, showing the configured work length', async () => {
    const usePomodoro = await load();
    const { result } = await mount(usePomodoro);

    expect(result.current.running).toBe(false);
    expect(result.current.phase).toBe('work');
    expect(result.current.remainingMs).toBe(MINUTE);
  });

  it('is not ready once the settings have arrived but the session has not', async () => {
    // Asserting on the first synchronous render proves nothing: `ready` is
    // false there whether it is gated on the settings alone or on both reads.
    // The gate only shows itself once the settings have landed and the stored
    // session has not — so hold the session read open and let the settings
    // through. Gated on `isLoaded` alone this reports ready, and every tab
    // opened during a session flashes a full idle work length.
    (chrome.storage.local as unknown as { get: () => void }).get = () => {};

    const usePomodoro = await load();
    const { result } = renderHook(() => usePomodoro());
    await flush();

    // The settings really did arrive: the idle display follows the seeded one
    // minute rather than the 25-minute default.
    expect(result.current.remainingMs).toBe(MINUTE);
    expect(result.current.ready).toBe(false);
  });

  it('picks up a session that was already running when the tab opened', async () => {
    chromeStub.seedLocal({
      [POMODORO_STATE_KEY]: { phase: 'break', endsAt: Date.now() + 40_000, running: true },
    });
    const usePomodoro = await load();
    const { result } = await mount(usePomodoro);

    expect(result.current.running).toBe(true);
    expect(result.current.phase).toBe('break');
    // Not exactly 40 s: `waitFor` advances the fake clock while it polls for
    // `ready`, and the countdown is measured against the clock, not the mount.
    expect(result.current.remainingMs).toBeLessThanOrEqual(40_000);
    expect(result.current.remainingMs).toBeGreaterThan(39_000);
  });

  it('counts down while running', async () => {
    const usePomodoro = await load();
    const { result } = await mount(usePomodoro);

    await drive(runningPomodoro('work', MINUTE));
    act(() => void vi.advanceTimersByTime(10_000));

    expect(result.current.running).toBe(true);
    expect(result.current.remainingMs).toBe(50_000);
  });

  it('follows the worker into the next phase', async () => {
    const usePomodoro = await load();
    const { result } = await mount(usePomodoro);
    await drive(runningPomodoro('work', MINUTE));

    await drive(runningPomodoro('break', MINUTE));

    expect(result.current.phase).toBe('break');
  });

  it('runs no timer of its own: a phase ends only when the worker says so', async () => {
    const usePomodoro = await load();
    const { result } = await mount(usePomodoro);
    await drive(runningPomodoro('work', MINUTE));

    act(() => void vi.advanceTimersByTime(5 * MINUTE));

    expect(result.current.phase).toBe('work');
    expect(result.current.running).toBe(true);
    expect(result.current.remainingMs).toBe(0);
  });

  it('goes back to the idle work length when the worker resets', async () => {
    const usePomodoro = await load();
    const { result } = await mount(usePomodoro);
    await drive(runningPomodoro('break', 30_000));

    await drive(pomodoroState());

    expect(result.current.running).toBe(false);
    expect(result.current.phase).toBe('work');
    expect(result.current.remainingMs).toBe(MINUTE);
  });

  it('treats a malformed stored session as no session', async () => {
    const usePomodoro = await load();
    const { result } = await mount(usePomodoro);
    // Starting from a *running* break is what makes this discriminating.
    // Asserting idle from an already-idle hook cannot tell "parsed the record
    // and fell back" from "ignored the change and happened to match".
    await drive(runningPomodoro('break', 30_000));
    expect(result.current.running).toBe(true);

    await act(async () => {
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ [POMODORO_STATE_KEY]: { phase: 'lunch' } }, () => resolve());
      });
    });

    expect(result.current.running).toBe(false);
    expect(result.current.phase).toBe('work');
    expect(result.current.remainingMs).toBe(MINUTE);
  });

  it('asks the worker to start instead of starting anything itself', async () => {
    const usePomodoro = await load();
    const { result } = await mount(usePomodoro);

    act(() => result.current.start());
    await flush();

    expect(chromeStub.sentMessages()).toEqual([{ type: 'pomodoro/start' }]);
    // No worker loaded in this test, so nothing owns the message — and nothing
    // happens. A hook that still kept its own state would run regardless.
    expect(result.current.running).toBe(false);
  });

  it('asks the worker to reset instead of resetting anything itself', async () => {
    const usePomodoro = await load();
    const { result } = await mount(usePomodoro);
    await drive(runningPomodoro('break', 30_000));

    act(() => result.current.reset());
    await flush();

    expect(chromeStub.sentMessages()).toEqual([{ type: 'pomodoro/reset' }]);
    expect(result.current.running).toBe(true);
  });

  it('pings the worker on mount when a session is running', async () => {
    // Rendering the timer reads storage directly and never touches the worker,
    // so without this a session whose alarm went missing stays frozen until
    // something unrelated wakes the worker. Exactly one ping per tab.
    chromeStub.seedLocal({
      [POMODORO_STATE_KEY]: runningPomodoro('work', 30_000),
    });
    const usePomodoro = await load();
    await mount(usePomodoro);

    expect(chromeStub.sentMessages()).toEqual([{ type: 'pomodoro/ping' }]);
  });

  it('wakes nothing when a tab opens with no session running', async () => {
    // There is no alarm to rehydrate when nothing is running, and someone who
    // never uses the timer should not spin the worker up on every new tab.
    const usePomodoro = await load();
    await mount(usePomodoro);

    expect(chromeStub.sentMessages()).toEqual([]);
  });

  it('clears the exact interval it created when unmounted', async () => {
    // `not.toThrow()` on a post-unmount timer advance (the original version
    // of this test) passes identically whether or not the cleanup runs:
    // React 19 no-ops `setState` on an unmounted component and `result.current`
    // is frozen at the last render, so nothing observable ever surfaces a
    // leaked interval. Asserting on the real timer API directly, the way
    // `useUiVisibility.test.ts` asserts on the exact `removeEventListener`
    // call, is the only way to prove the cleanup itself actually runs.
    const usePomodoro = await load();
    const { result, unmount } = await mount(usePomodoro);

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    await drive(runningPomodoro('work', MINUTE));
    expect(result.current.running).toBe(true);

    const intervalId = setIntervalSpy.mock.results.at(-1)?.value;
    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
  });

  it('stops ticking once the session ends', async () => {
    const usePomodoro = await load();
    await mount(usePomodoro);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    await drive(runningPomodoro('work', MINUTE));
    // The hook's own interval, not merely "some `clearInterval` happened" —
    // `waitFor` and React both use timers, so a bare `toHaveBeenCalled()` here
    // passes even if the display clock is left running.
    const intervalId = setIntervalSpy.mock.results.at(-1)?.value;
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    await drive(pomodoroState());

    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
  });

  it('drops its storage listener on unmount', async () => {
    const usePomodoro = await load();
    // One for `useSettings`' module-level store, one for this hook.
    const { unmount } = await mount(usePomodoro);
    expect(chromeStub.changeListenerCount()).toBe(2);

    unmount();

    expect(chromeStub.changeListenerCount()).toBe(1);
  });
});

/**
 * The two properties this task exists for, both driven through the real path:
 * a tab posts a message, the service worker owns the state, and every tab reads
 * it back. Both fail against the per-tab implementation these replace.
 */
describe('usePomodoro across two tabs', () => {
  it('shows the same phase and countdown in a tab that did not start it', async () => {
    await loadWorker();
    const usePomodoro = await load();
    const tabA = await mount(usePomodoro);
    const tabB = await mount(usePomodoro);

    act(() => tabA.result.current.start());
    await flush();

    expect(tabB.result.current.running).toBe(true);
    expect(tabB.result.current.phase).toBe(tabA.result.current.phase);
    expect(Math.abs(tabB.result.current.remainingMs - tabA.result.current.remainingMs)).toBeLessThan(
      1000,
    );
  });

  it('keeps both tabs together across a phase transition', async () => {
    await loadWorker();
    const usePomodoro = await load();
    const tabA = await mount(usePomodoro);
    const tabB = await mount(usePomodoro);
    act(() => tabA.result.current.start());
    await flush();

    // The worker refuses to advance a phase whose deadline has not arrived, so
    // the clock has to reach it — an alarm never fires early in Chrome either.
    act(() => void vi.advanceTimersByTime(MINUTE + 1000));
    chromeStub.fireAlarm(POMODORO_ALARM);
    await flush();

    expect(tabA.result.current.phase).toBe('break');
    expect(tabB.result.current.phase).toBe('break');
    expect(Math.abs(tabB.result.current.remainingMs - tabA.result.current.remainingMs)).toBeLessThan(
      1000,
    );
  });

  it('raises exactly one notification per transition, with two tabs running', async () => {
    await loadWorker();
    const usePomodoro = await load();
    const tabA = await mount(usePomodoro);
    const tabB = await mount(usePomodoro);

    act(() => tabA.result.current.start());
    await flush();
    act(() => tabB.result.current.start());
    await flush();

    // Past the deadline, and still silent: a tab does not decide a phase is
    // over. The per-tab implementation announced one transition per open tab
    // right here.
    act(() => void vi.advanceTimersByTime(MINUTE + 1000));
    expect(chromeStub.sentNotifications()).toHaveLength(0);

    // The worker's single alarm is the only thing that ends a phase.
    chromeStub.fireAlarm(POMODORO_ALARM);
    await flush();

    expect(chromeStub.sentNotifications()).toHaveLength(1);
    expect(tabA.result.current.phase).toBe('break');
    expect(tabB.result.current.phase).toBe('break');
  });

  it('lets either tab reset the session for both', async () => {
    await loadWorker();
    const usePomodoro = await load();
    const tabA = await mount(usePomodoro);
    const tabB = await mount(usePomodoro);
    act(() => tabA.result.current.start());
    await flush();

    act(() => tabB.result.current.reset());
    await flush();

    expect(tabA.result.current.running).toBe(false);
    expect(tabB.result.current.running).toBe(false);
    expect(chromeStub.scheduledAlarms().map((alarm) => alarm.name)).not.toContain(POMODORO_ALARM);
  });
});
