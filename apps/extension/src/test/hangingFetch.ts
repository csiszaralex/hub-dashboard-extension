import { vi } from 'vitest';

/**
 * A `fetch` whose request is accepted and never answered: it settles only when
 * its signal aborts, as a real request does. That is the server the timeouts in
 * `utils/fetchWithTimeout.ts` exist for, and one a rejecting stub (like the
 * offline default in `setup.ts`) cannot stand in for.
 */
export const hangingFetch = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  new Promise((_, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

/**
 * Fake timers that `@testing-library`'s `waitFor` can still work under: it only
 * drives a fake clock when it finds a global `jest`, which Vitest never
 * defines. The same alias `usePomodoro.test.ts` sets up, for the same reason.
 * Returns the undo.
 */
export const installFakeClock = () => {
  (globalThis as unknown as { jest?: unknown }).jest = vi;
  vi.useFakeTimers();
  return () => {
    vi.useRealTimers();
    delete (globalThis as unknown as { jest?: unknown }).jest;
  };
};
