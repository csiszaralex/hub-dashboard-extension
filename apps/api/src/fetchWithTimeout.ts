/**
 * How long the worker waits on any upstream (Unsplash, Stoic, Citatum) before
 * treating it as failed.
 *
 * The worker answers inside the extension's own budget — `REQUEST_TIMEOUT_MS`
 * in the extension's `utils/fetchWithTimeout.ts` — so it has to give up first:
 * otherwise the client abandons the request before the fallback (the default
 * pool, the stale quote) is ever sent.
 */
export const UPSTREAM_TIMEOUT_MS = 5000;

/** A request that ran out of time, told apart from a refused connection in the logs. */
export class FetchTimeoutError extends Error {
  override name = 'TimeoutError';

  constructor(host: string, timeoutMs: number) {
    // The host only: a full URL can carry a credential in its query string.
    super(`Request to ${host} timed out after ${timeoutMs} ms`);
  }
}

const hostOf = (input: RequestInfo | URL): string => {
  try {
    return new URL(input instanceof Request ? input.url : String(input)).host;
  } catch {
    return 'upstream';
  }
};

export interface TimeoutInit extends RequestInit {
  timeoutMs?: number;
}

/**
 * `fetch`, plus a deadline that covers reading the body as well as the headers.
 *
 * An upstream that sends headers and then stalls would leave `res.json()`
 * waiting for as long as the platform allows, so `read` runs inside the same
 * deadline and its result is what this returns. A timeout rejects with
 * `FetchTimeoutError`, so it lands in whatever already handles a failed request.
 *
 * Built on `AbortController` + `setTimeout` rather than `AbortSignal.timeout`,
 * so tests can drive it with fake timers. A caller's own `signal` still aborts
 * the request, with the caller's reason.
 */
export const fetchWithTimeout = async <T>(
  input: RequestInfo | URL,
  read: (response: Response) => Promise<T>,
  { timeoutMs = UPSTREAM_TIMEOUT_MS, signal, ...init }: TimeoutInit = {},
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onCallerAbort: (() => void) | undefined;

  // Racing `read` rather than relying on the abort alone: whether aborting
  // also errors a body that is mid-read, or a `cache.put` consuming it, is up
  // to the runtime, and the deadline must hold either way.
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
