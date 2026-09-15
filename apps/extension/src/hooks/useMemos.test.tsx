import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';

const listPayload = {
  memos: [
    { name: 'memos/1', creator: 'users/1', content: 'call the bank #todo', tags: ['todo'] },
    { name: 'memos/2', creator: 'users/1', content: 'read the paper #read', tags: ['read'] },
  ],
};

/** Connected as `users/1`: what a successful Connect leaves behind on this machine. */
const seedConfigured = () => {
  const stub = installChromeStub();
  stub.seedSync({ memosUrl: 'https://memo.example.com', memosTag: 'todo' });
  stub.seedLocal({ memos_token: 'memos_pat_x', memos_user: 'users/1' });
  stub.grantOrigins(['https://memo.example.com/*']);
  return stub;
};

const respondWith = (status: number, body: unknown) =>
  vi.fn(() =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }),
  );

describe('useMemos', () => {
  it('is unconfigured when no server is set', async () => {
    installChromeStub();
    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('unconfigured'));
  });

  // A configured server whose permission was revoked in chrome://extensions is
  // not a network failure — nothing should be fetched at all.
  it('is unconfigured when the host permission was revoked', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: 'https://memo.example.com' });
    stub.seedLocal({ memos_token: 'memos_pat_x', memos_user: 'users/1' });
    const fetchMock = respondWith(200, listPayload);
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.status).toBe('unconfigured'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Without the account the token belongs to, the hook cannot tell the user's
  // own memos from the other public ones `ListMemos` returns — so it fetches
  // nothing rather than show them all.
  it('is unconfigured, and fetches nothing, when the connected account is not stored', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: 'https://memo.example.com' });
    stub.seedLocal({ memos_token: 'memos_pat_x' });
    stub.grantOrigins(['https://memo.example.com/*']);
    const fetchMock = respondWith(200, listPayload);
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.status).toBe('unconfigured'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // An authenticated `ListMemos` also returns other users' PUBLIC and PROTECTED
  // memos. Each would carry a live archive control, and a host account can
  // archive them — so they are dropped before they render or reach the cache.
  it("renders and caches only the connected account's own memos", async () => {
    const stub = seedConfigured();
    vi.stubGlobal(
      'fetch',
      respondWith(200, {
        memos: [
          { name: 'memos/1', creator: 'users/1', content: 'mine #todo', tags: ['todo'] },
          { name: 'memos/2', creator: 'users/2', content: 'theirs #todo', tags: ['todo'] },
          { name: 'memos/3', creator: 'users/1', content: 'also mine #todo', tags: ['todo'] },
        ],
      }),
    );

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(stub.readLocal('memos_cache')).toBeDefined());
    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1', 'memos/3']);
    const cached = stub.readLocal('memos_cache') as { memos: { name: string }[] };
    expect(cached.memos.map((m) => m.name)).toEqual(['memos/1', 'memos/3']);
  });

  it('filters to the configured base tag', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']);
    expect(result.current.tags).toEqual(['read', 'todo']);
  });

  it('re-filters when a chip is picked', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.setActiveTag(null));
    expect(result.current.memos).toHaveLength(2);
  });

  // The whole point of the cache: the page renders what it had, and the failure
  // stays quiet rather than blanking the widget.
  it('renders the cache and reports the failure when the server is unreachable', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: listPayload });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.failure).toBe('network'));
    expect(result.current.status).toBe('ready');
    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']);
  });

  it('archives optimistically and keeps it gone on success', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    vi.stubGlobal('fetch', respondWith(200, {}));
    await act(async () => {
      await result.current.archive('memos/1');
    });

    expect(result.current.memos).toHaveLength(0);
  });

  // Safe to be optimistic only because it can be put back.
  it('restores the row when archiving fails', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    vi.stubGlobal('fetch', respondWith(500, {}));
    await act(async () => {
      await result.current.archive('memos/1');
    });

    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']);
    expect(result.current.failure).toBe('server');
  });

  it('appends the active tag on submit and clears the draft', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const created = respondWith(200, {
      name: 'memos/3',
      creator: 'users/1',
      content: 'new one #todo',
      tags: ['todo'],
    });
    vi.stubGlobal('fetch', created);

    act(() => result.current.setDraft('new one'));
    await act(async () => {
      await result.current.submit();
    });

    const createInit = (created.mock.calls[0] as unknown[])[1] as { body: string };
    expect(JSON.parse(createInit.body).content).toBe('new one #todo');
    expect(result.current.draft).toBe('');
    expect(result.current.memos.map((m) => m.name)).toContain('memos/3');
  });

  // The one real data-loss path: text typed, send failed, tab closed.
  it('keeps the draft in local storage when the submit fails', async () => {
    const stub = seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    vi.stubGlobal('fetch', respondWith(500, {}));
    act(() => result.current.setDraft('do not lose me'));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.draft).toBe('do not lose me');
    await waitFor(() => expect(stub.readLocal('memos_draft')).toBe('do not lose me'));
  });

  // The hook's own contract is "unconfigured means no fetch" — it must enforce
  // that itself rather than trust the widget to check `status` before calling
  // an action. A stale `credentials.current` surviving the transition would
  // otherwise let `archive`/`submit` reach the abandoned server on stored ones.
  it('stops issuing requests once a live settings change de-configures it', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { saveSettings } = await import('./useSettings');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // De-configure while the hook stays mounted, through the same live
    // storage-change path the popup or a revoked permission would trigger.
    act(() => saveSettings({ memosUrl: '' }));
    await waitFor(() => expect(result.current.status).toBe('unconfigured'));

    const freshFetch = respondWith(200, {});
    vi.stubGlobal('fetch', freshFetch);

    act(() => result.current.setDraft('should not send'));
    await act(async () => {
      await result.current.archive('memos/1');
      await result.current.submit();
    });

    expect(freshFetch).not.toHaveBeenCalled();
  });
});
