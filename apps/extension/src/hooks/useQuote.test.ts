import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
