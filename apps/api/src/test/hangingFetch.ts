/**
 * A `fetch` whose request is accepted and never answered: it settles only when
 * its signal aborts, as a real request does. That is the upstream the timeouts
 * exist for, and the one a rejecting stub cannot stand in for.
 */
export const hangingFetch = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  new Promise((_, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) return reject(signal.reason);
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
