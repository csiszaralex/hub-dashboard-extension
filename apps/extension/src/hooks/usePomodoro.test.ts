import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStub, type ChromeStub } from '../test/chromeStub';

const load = async () => (await import('./usePomodoro')).usePomodoro;

let chromeStub: ChromeStub;

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
  it('starts idle', async () => {
    const usePomodoro = await load();
    const { result } = renderHook(() => usePomodoro());

    expect(result.current.running).toBe(false);
    expect(result.current.phase).toBe('work');
  });

  it('counts down while running', async () => {
    const usePomodoro = await load();
    const { result } = renderHook(() => usePomodoro());
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.start());
    act(() => void vi.advanceTimersByTime(10_000));

    expect(result.current.remainingMs).toBeLessThanOrEqual(50_000);
    expect(result.current.running).toBe(true);
  });

  it('switches to the break phase when the work phase elapses', async () => {
    const usePomodoro = await load();
    const { result } = renderHook(() => usePomodoro());
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.start());
    act(() => void vi.advanceTimersByTime(61_000));

    expect(result.current.phase).toBe('break');
  });

  it('notifies at the phase transition', async () => {
    const usePomodoro = await load();
    const { result } = renderHook(() => usePomodoro());
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => result.current.start());
    act(() => void vi.advanceTimersByTime(61_000));

    expect(chromeStub.sentNotifications()).toHaveLength(1);
  });

  it('resets back to an idle work phase', async () => {
    const usePomodoro = await load();
    const { result } = renderHook(() => usePomodoro());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());
    act(() => void vi.advanceTimersByTime(61_000));

    act(() => result.current.reset());

    expect(result.current.running).toBe(false);
    expect(result.current.phase).toBe('work');
  });

  it('does not throw when chrome.notifications is unavailable', async () => {
    const usePomodoro = await load();
    const { result } = renderHook(() => usePomodoro());
    await waitFor(() => expect(result.current.ready).toBe(true));

    // Mirrors a manifest missing the `notifications` permission: in a real
    // browser the namespace is simply absent, not a stub that always answers.
    // A phase transition must degrade gracefully instead of throwing and
    // taking the ticking interval down with it.
    delete (globalThis as unknown as { chrome: { notifications?: unknown } }).chrome.notifications;

    act(() => result.current.start());
    expect(() => {
      act(() => void vi.advanceTimersByTime(61_000));
    }).not.toThrow();
    expect(result.current.phase).toBe('break');
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
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const { result, unmount } = renderHook(() => usePomodoro());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.start());

    const intervalId = setIntervalSpy.mock.results.at(-1)?.value;
    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
  });
});
