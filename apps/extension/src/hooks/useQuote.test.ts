import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import { FALLBACK_QUOTES } from '../utils/quoteFallback';

const loadUseQuote = async () => (await import('./useQuote')).useQuote;

describe('useQuote', () => {
  it('shows the quote the worker returns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ text: 'From the worker.', author: 'Seneca' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const useQuote = await loadUseQuote();

    const { result } = renderHook(() => useQuote());

    await waitFor(() => expect(result.current.text).toBe('From the worker.'));
  });

  it('falls back to a bundled quote when the worker is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const useQuote = await loadUseQuote();

    const { result } = renderHook(() => useQuote());

    await waitFor(() => expect(FALLBACK_QUOTES).toContainEqual(result.current));
  });

  it('falls back when the worker replies with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    const useQuote = await loadUseQuote();

    const { result } = renderHook(() => useQuote());

    await waitFor(() => expect(FALLBACK_QUOTES).toContainEqual(result.current));
  });

  it('makes no request when today\'s quote is already cached', async () => {
    localStorage.setItem(
      'daily_quote',
      JSON.stringify({
        date: new Date().toISOString().split('T')[0],
        // The selection the packet was fetched for. A cached quote is only a
        // hit for the same source, language and category — switching any of
        // them has to refetch rather than show the previous source's quote.
        query: 'stoic|en|',
        data: { text: 'Cached.', author: 'Epictetus' },
      }),
    );
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const useQuote = await loadUseQuote();

    const { result } = renderHook(() => useQuote());

    expect(result.current.text).toBe('Cached.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useQuote — the user\'s own list', () => {
  it('answers from the saved list without a request', async () => {
    // The whole point of this source: no worker, no upstream, nothing to be
    // down. A request here would also mean the quote could differ from what
    // the popup shows.
    const chromeStub = installChromeStub();
    chromeStub.seedSync({
      quoteSource: 'custom',
      customQuotes: [{ text: 'Only mine.', author: 'Me' }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const useQuote = await loadUseQuote();

    const { result } = renderHook(() => useQuote());

    await waitFor(() => expect(result.current.text).toBe('Only mine.'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the bundled set when the list is empty', async () => {
    // Selecting the source before typing anything is a reachable state, and an
    // empty widget would look broken rather than unconfigured.
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ quoteSource: 'custom', customQuotes: [] });
    const useQuote = await loadUseQuote();

    const { result } = renderHook(() => useQuote());

    await waitFor(() => expect(result.current.text.length).toBeGreaterThan(0));
  });
});
