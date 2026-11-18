/**
 * Deadlines for the extension's requests.
 *
 * Imported by the service worker (through `prefetch.ts` and `imageCache.ts`),
 * so nothing here may touch `window`, `document` or `localStorage` — only the
 * global `fetch`, `setTimeout` and `AbortController`, which both scopes have.
 * The Memos client keeps its own `MEMOS_TIMEOUT_MS`.
 */

/**
 * The Hub API and the third-party data APIs (weather, geocoding, calendar).
 *
 * For the Hub API this must stay above the worker's own `UPSTREAM_TIMEOUT_MS`
 * (5 s, in `apps/api/src/fetchWithTimeout.ts`) plus its KV round trips: the
 * worker answers a hung upstream with a fallback (the default pool, the stale
 * quote), and a client that gives up first never receives it.
 */
export const REQUEST_TIMEOUT_MS = 8000;

/** The background image itself: several megabytes, possibly over a slow link. */
export const IMAGE_TIMEOUT_MS = 30_000;

/** A request that ran out of time, told apart from a refused connection in the logs. */
export class FetchTimeoutError extends Error {
  override name = 'TimeoutError';

  constructor(host: string, timeoutMs: number) {
    // The host only: a full URL can carry a calendar id or other personal detail.
    super(`Request to ${host} timed out after ${timeoutMs} ms`);
  }
}

const hostOf = (input: RequestInfo | URL): string => {
  try {
    return new URL(input instanceof Request ? input.url : String(input)).host;
  } catch {
    return 'server';
  }
};

export interface TimeoutInit extends RequestInit {
  timeoutMs?: number;
}

/**
 * `fetch`, plus a deadline that covers reading the body as well as the headers.
 *
 * A server that sends headers and then stalls would leave `res.json()` waiting
 * for as long as the browser allows, so `read` runs inside the same deadline
 * and its result is what this returns. A timeout rejects with
 * `FetchTimeoutError`, so it lands in whatever already handles a failed
 * request at the call site.
 *
 * Built on `AbortController` + `setTimeout` rather than `AbortSignal.timeout`,
 * so tests can drive it with fake timers. A caller's own `signal` still aborts
 * the request, with the caller's reason.
 */
export const fetchWithTimeout = async <T>(
  input: RequestInfo | URL,
  read: (response: Response) => Promise<T>,
  { timeoutMs = REQUEST_TIMEOUT_MS, signal, ...init }: TimeoutInit = {},
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onCallerAbort: (() => void) | undefined;

  // Racing `read` rather than relying on the abort alone: whether aborting
  // also errors a body that is mid-read, or a `cache.put` consuming it, is up
  // to the browser, and the deadline must hold either way.
  const deadline = new Promise<never>((_, reject) => {
    const abort = (reason: unknown) => {
      controller.abort(reason);
      reject(reason);
    };
    timer = setTimeout(() => abort(new FetchTimeoutError(hostOf(input), timeoutMs)), timeoutMs);
    if (signal?.aborted) abort(signal.reason);
    onCallerAbort = () => abort(signal?.reason);
    signal?.addEventListener('abort', onCallerAbort, { once: true });
  });

  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }).then(read),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    if (onCallerAbort) signal?.removeEventListener('abort', onCallerAbort);
  }
};
