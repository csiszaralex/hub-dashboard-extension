import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import { memosConnectRoutes, memosListRoute, routeFetch } from '../test/memosFetch';

const BASE = 'https://memo.example.com';
const OTHER = 'https://other.example.com';

/** The token this machine holds, and the account the server issued it to. */
const TOKENS = { memos_pat_x: 'users/1' };

const listPayload = {
  memos: [
    { name: 'memos/1', creator: 'users/1', content: 'call the bank #todo', tags: ['todo'] },
    { name: 'memos/2', creator: 'users/1', content: 'read the paper #read', tags: ['read'] },
  ],
};

interface CacheRecord {
  baseUrl: string;
  memos: { name: string }[];
}

interface CheckRecord {
  baseUrl: string;
  nextAt: number;
  failure: string | null;
}

/** A cache written for the configured server. */
const cacheOf = (memos: Record<string, unknown>[], baseUrl = BASE) => ({ baseUrl, memos });

/** A check that says the configured server was asked a moment ago and need not be asked yet. */
const freshCheck = (failure: string | null, baseUrl = BASE) => ({
  baseUrl,
  nextAt: Date.now() + 60_000,
  failure,
});

/** Connected as `users/1`: what a successful Connect leaves behind on this machine. */
const seedConfigured = () => {
  const stub = installChromeStub();
  stub.seedSync({ memosUrl: BASE, memosTag: 'todo' });
  stub.seedLocal({ memos_server: BASE, memos_token: 'memos_pat_x', memos_user: 'users/1' });
  stub.grantOrigins([`${BASE}/*`]);
  return stub;
};

/** A v0.30 server holding `memos`, which accepts only the tokens in `tokens`. */
const serve = (
  memos: Record<string, unknown>[] = listPayload.memos,
  tokens: Record<string, string> = TOKENS,
) =>
  routeFetch({ ...memosConnectRoutes({ tokens }), ...memosListRoute({ tokens, memos }) });

const offline = () => Promise.reject(new TypeError('Failed to fetch'));

const respondWith = (status: number, body: unknown) =>
  vi.fn(() =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }),
  );

describe('useMemos — setup', () => {
  // No server is what every user who never set the widget up has. That is
  // "off", not "needs reconnecting" — nothing to prompt about, nothing to fetch.
  it('is off, and fetches nothing, when no server is set', async () => {
    installChromeStub();
    const fetchMock = serve();
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.status).toBe('off'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Chrome drops the host grant when an unpacked extension is reloaded, and a
  // user can revoke it by hand. The connection itself is intact, so this is
  // not "unconfigured": it is one permission away, and asking for it needs
  // only a click. Nothing is fetched in the meantime.
  it('needs access, not a reconnect, when only the host permission is gone', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: BASE });
    stub.seedLocal({ memos_server: BASE, memos_token: 'memos_pat_x', memos_user: 'users/1' });
    const fetchMock = serve();
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.status).toBe('needs-access'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads as soon as the permission is granted back', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: BASE, memosTag: 'todo' });
    stub.seedLocal({ memos_server: BASE, memos_token: 'memos_pat_x', memos_user: 'users/1' });
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('needs-access'));

    await act(async () => {
      await result.current.grantAccess();
    });

    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));
  });

  // A refused prompt leaves it exactly where it was, with nothing sent.
  it('stays where it is when the prompt is refused', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: BASE });
    stub.seedLocal({ memos_server: BASE, memos_token: 'memos_pat_x', memos_user: 'users/1' });
    stub.denyPermissionRequests();
    const fetchMock = serve();
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('needs-access'));

    await act(async () => {
      await result.current.grantAccess();
    });

    expect(result.current.status).toBe('needs-access');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Without the account the token belongs to, the hook cannot tell the user's
  // own memos from the other public ones `ListMemos` returns — so it fetches
  // nothing rather than show them all.
  it('is unconfigured, and fetches nothing, when the connected account is not stored', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: BASE });
    stub.seedLocal({ memos_server: BASE, memos_token: 'memos_pat_x' });
    stub.grantOrigins([`${BASE}/*`]);
    const fetchMock = serve();
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.status).toBe('unconfigured'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The permission and token check is local and near-instant, so doing it
  // before the cache costs nothing — and a widget that cannot be used must not
  // flash its old rows for a tick before it says so.
  //
  // `permissions.contains` answers on a later task here, as Chrome's really
  // does: its callback crosses a process boundary, where the stub's other
  // answers are microtasks. Without that, React would batch a wrong order's
  // `ready` and `unconfigured` into one render and the flash this guards
  // against could not be observed at all.
  it('never shows cached rows while the host permission is missing', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: BASE, memosTag: 'todo' });
    stub.seedLocal({
      memos_server: BASE,
      memos_token: 'memos_pat_x',
      memos_user: 'users/1',
      memos_cache: cacheOf(listPayload.memos),
    });
    vi.spyOn(chrome.permissions, 'contains').mockImplementation((_options, callback) => {
      setTimeout(() => callback(false), 0);
    });
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const seen: string[] = [];
    const { result } = renderHook(() => {
      const memos = useMemos();
      seen.push(memos.status);
      return memos;
    });

    await waitFor(() => expect(result.current.status).toBe('needs-access'));
    expect(seen).not.toContain('ready');
  });
});

describe('useMemos — the token belongs to one server', () => {
  // Connect writes the token to local storage before it writes the URL to
  // sync, so a tab that is already open learns of the new token first. Pairing
  // that token with the URL this tab still holds would send the new server's
  // credential to the old host. The token is stored with the server it is for,
  // and nothing goes out until the two agree.
  it('asks nothing while the stored server and the settings disagree', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: BASE, memosTag: 'todo' });
    stub.seedLocal({ memos_server: OTHER, memos_token: 'memos_pat_x', memos_user: 'users/1' });
    stub.grantOrigins([`${BASE}/*`, `${OTHER}/*`]);
    const fetchMock = serve();
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.status).toBe('unconfigured'));
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A connection made before the server was kept beside the token has no
  // server recorded. Demanding a reconnect for that would make every rebuild
  // or update look like a lost setup; the configured URL is adopted instead,
  // and from then on the pairing rule guards it like any other.
  it('adopts the configured server for a connection stored without one', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: BASE, memosTag: 'todo' });
    stub.seedLocal({ memos_token: 'memos_pat_x', memos_user: 'users/1' });
    stub.grantOrigins([`${BASE}/*`]);
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));
    expect(stub.readLocal('memos_server')).toBe(BASE);
  });

  it('starts once the stored server catches up', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: BASE, memosTag: 'todo' });
    stub.seedLocal({ memos_server: OTHER, memos_token: 'memos_pat_x', memos_user: 'users/1' });
    stub.grantOrigins([`${BASE}/*`]);
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('unconfigured'));

    await act(async () => {
      await new Promise<void>((resolve) =>
        chrome.storage.local.set({ memos_server: BASE }, () => resolve()),
      );
    });

    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));
  });
});

describe('useMemos — loading', () => {
  // An authenticated `ListMemos` also returns other users' PUBLIC and PROTECTED
  // memos. Each would carry a live archive control, and a host account can
  // archive them — so they are dropped before they render or reach the cache.
  it("renders and caches only the connected account's own memos", async () => {
    const stub = seedConfigured();
    vi.stubGlobal(
      'fetch',
      serve([
        { name: 'memos/1', creator: 'users/1', content: 'mine #todo', tags: ['todo'] },
        { name: 'memos/2', creator: 'users/2', content: 'theirs #todo', tags: ['todo'] },
        { name: 'memos/3', creator: 'users/1', content: 'also mine #todo', tags: ['todo'] },
      ]),
    );

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(stub.readLocal('memos_cache')).toBeDefined());
    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1', 'memos/3']);
    const cached = stub.readLocal('memos_cache') as CacheRecord;
    expect(cached.baseUrl).toBe(BASE);
    expect(cached.memos.map((m) => m.name)).toEqual(['memos/1', 'memos/3']);
  });

  it('filters to the configured base tag', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));
    expect(result.current.tags).toEqual(['read', 'todo']);
  });

  it('re-filters when a chip is picked', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.tags).toEqual(['read', 'todo']));

    act(() => result.current.setActiveTag(null));
    expect(result.current.memos).toHaveLength(2);
  });

  // The whole point of the cache: the page renders what it had, and the failure
  // stays quiet rather than blanking the widget.
  it('renders the cache and reports the failure when the server is unreachable', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: cacheOf(listPayload.memos) });
    vi.stubGlobal('fetch', offline);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.failure).toBe('network'));
    expect(result.current.status).toBe('ready');
    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']);
  });

  // Nothing cached and nothing reachable is still a widget, not a crash or an
  // endless spinner: it settles on the failure.
  it('settles on the failure with nothing to show when offline and uncached', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', offline);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.failure).toBe('network');
    expect(result.current.memos).toEqual([]);
  });
});

describe('useMemos — a token the server no longer accepts', () => {
  // `ListMemos` is public. With an expired token it still answers 200, with
  // only the PUBLIC memos — usually none of this account's, since the widget
  // writes PRIVATE ones. Trusting that answer blanked the list and overwrote
  // the offline cache, so an ordinary token expiry looked like lost notes.
  it('keeps the cache on screen and in storage, and reports auth', async () => {
    const stub = seedConfigured();
    const cache = cacheOf(listPayload.memos);
    stub.seedLocal({ memos_cache: cache });
    vi.stubGlobal(
      'fetch',
      serve(
        [
          ...listPayload.memos,
          {
            name: 'memos/9',
            creator: 'users/1',
            content: 'public #todo',
            tags: ['todo'],
            visibility: 'PUBLIC',
          },
        ],
        { memos_pat_renewed: 'users/1' },
      ),
    );

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.failure).toBe('auth'));
    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']);
    expect(stub.readLocal('memos_cache')).toEqual(cache);
  });

  // The list is only trusted once `auth/me` has vouched for the token in the
  // same refresh. If that proof never arrives, neither does the list.
  it('does not trust the list when the token check cannot be reached', async () => {
    const stub = seedConfigured();
    const cache = cacheOf([listPayload.memos[0]]);
    stub.seedLocal({ memos_cache: cache });
    const server = serve();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) =>
        input.includes('/api/v1/auth/me') ? offline() : server(input, init),
      ),
    );

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.failure).toBe('network'));
    act(() => result.current.setActiveTag(null));
    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']);
    expect(stub.readLocal('memos_cache')).toEqual(cache);
  });
});

describe('useMemos — asking the server less often', () => {
  it('uses a fresh cache without asking the server', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: cacheOf(listPayload.memos), memos_check: freshCheck(null) });
    const fetchMock = serve();
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {});
    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A tab that skips the request must still say why its list may be stale.
  it('carries the last failure while the check is fresh', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: cacheOf(listPayload.memos), memos_check: freshCheck('network') });
    const fetchMock = serve();
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.failure).toBe('network'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the server once the check is due', async () => {
    const stub = seedConfigured();
    stub.seedLocal({
      memos_cache: cacheOf([listPayload.memos[0]]),
      memos_check: { baseUrl: BASE, nextAt: Date.now() - 1, failure: null },
    });
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.tags).toEqual(['read', 'todo']));
  });

  // The server URL syncs and the check does not: after another machine moves
  // to a different server, this machine's fresh check is about the old one and
  // must not stop it asking the new one — nor show the old one's rows.
  it('ignores a check and a cache taken against another server', async () => {
    const stub = seedConfigured();
    stub.seedLocal({
      memos_cache: cacheOf([{ name: 'memos/77', creator: 'users/1', content: 'old #todo', tags: ['todo'] }], OTHER),
      memos_check: freshCheck(null, OTHER),
    });
    const fetchMock = serve();
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const seenRows: string[] = [];
    const { result } = renderHook(() => {
      const memos = useMemos();
      seenRows.push(...memos.memos.map((m) => m.name));
      return memos;
    });

    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));
    expect(fetchMock).toHaveBeenCalled();
    expect(seenRows).not.toContain('memos/77');
  });

  it.each([
    ['five minutes after a refresh that succeeded', () => serve(), 5 * 60_000, null],
    ['one minute after a refresh that failed', () => vi.fn(offline), 60_000, 'network'],
  ])('schedules the next check %s', async (_label, makeFetch, wait, failure) => {
    const stub = seedConfigured();
    vi.stubGlobal('fetch', makeFetch());

    const { useMemos } = await import('./useMemos');
    const before = Date.now();
    renderHook(() => useMemos());

    await waitFor(() => expect(stub.readLocal('memos_check')).toBeDefined());
    const after = Date.now();
    const check = stub.readLocal('memos_check') as CheckRecord;
    expect(check.baseUrl).toBe(BASE);
    expect(check.failure).toBe(failure);
    expect(check.nextAt).toBeGreaterThanOrEqual(before + wait);
    expect(check.nextAt).toBeLessThanOrEqual(after + wait);
  });

  it('refresh asks the server even while the check is fresh', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: cacheOf([listPayload.memos[0]]), memos_check: freshCheck(null) });
    const fetchMock = serve();
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(result.current.tags).toEqual(['read', 'todo']);
  });

  it('reports refreshing while a refresh runs, and ignores a second one meanwhile', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: cacheOf(listPayload.memos), memos_check: freshCheck(null) });
    const server = serve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      await gate;
      return server(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.refresh();
      void result.current.refresh();
    });
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      release();
      await first;
    });
    expect(result.current.refreshing).toBe(false);
    // One refresh is the token check and the list — two requests, not four.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Reconnecting in the popup writes a new token. A tab left open must pick it
  // up without a reload — and without waiting out a check that described the
  // token it replaced.
  it('reloads, ignoring the check, when a new token is stored', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: BASE, memosTag: 'todo' });
    stub.seedLocal({ memos_server: BASE, memos_user: 'users/1', memos_check: freshCheck('auth') });
    stub.grantOrigins([`${BASE}/*`]);
    const fetchMock = serve();
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('unconfigured'));

    await act(async () => {
      await new Promise<void>((resolve) =>
        chrome.storage.local.set({ memos_token: 'memos_pat_x' }, () => resolve()),
      );
    });

    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));
    expect(result.current.failure).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('useMemos — writing', () => {
  it('archives optimistically, keeps it gone on success, and updates the cache', async () => {
    const stub = seedConfigured();
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));

    vi.stubGlobal('fetch', respondWith(200, {}));
    await act(async () => {
      await result.current.archive('memos/1');
    });

    expect(result.current.memos).toHaveLength(0);
    await waitFor(() =>
      expect((stub.readLocal('memos_cache') as CacheRecord).memos.map((m) => m.name)).toEqual([
        'memos/2',
      ]),
    );
    expect((stub.readLocal('memos_cache') as CacheRecord).baseUrl).toBe(BASE);
  });

  // A write that the server took proves it is reachable and the token good, so
  // a failure recorded minutes ago must stop being reported — including to the
  // next tab, which would otherwise read it back out of the check.
  it('drops a recorded failure once a write proves the server is there', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: cacheOf(listPayload.memos), memos_check: freshCheck('network') });
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.failure).toBe('network'));

    vi.stubGlobal('fetch', respondWith(200, {}));
    await act(async () => {
      await result.current.archive('memos/1');
    });

    expect(result.current.failure).toBeNull();
    await waitFor(() => expect((stub.readLocal('memos_check') as CheckRecord).failure).toBeNull());
  });

  // Safe to be optimistic only because it can be put back.
  it('restores the row when archiving fails', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));

    vi.stubGlobal('fetch', respondWith(500, {}));
    await act(async () => {
      await result.current.archive('memos/1');
    });

    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']);
    // A write failure is reported as one, apart from the load's `failure`.
    expect(result.current.writeFailure).toEqual({ action: 'archive', reason: 'server' });
    expect(result.current.failure).toBeNull();
  });

  // Offline is the common case; a write that cannot leave must fail cleanly.
  it('reports an archive that cannot reach the server, and puts the row back', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));

    vi.stubGlobal('fetch', offline);
    await act(async () => {
      await result.current.archive('memos/1');
    });

    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']);
    expect(result.current.writeFailure).toEqual({ action: 'archive', reason: 'network' });
  });

  it('clears a write failure as soon as the next write starts', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));

    vi.stubGlobal('fetch', respondWith(500, {}));
    await act(async () => {
      await result.current.archive('memos/1');
    });
    expect(result.current.writeFailure).toEqual({ action: 'archive', reason: 'server' });

    // Held open, so what is observed is the moment the write starts, not its end.
    let answer: (response: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => (answer = resolve))));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.archive('memos/1');
    });
    expect(result.current.writeFailure).toBeNull();

    await act(async () => {
      answer({ ok: true, status: 200, json: () => Promise.resolve({}) });
      await pending;
    });
    expect(result.current.writeFailure).toBeNull();
  });

  it('appends the active tag on submit and clears the draft', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));

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
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));

    vi.stubGlobal('fetch', offline);
    act(() => result.current.setDraft('do not lose me'));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.draft).toBe('do not lose me');
    expect(result.current.writeFailure).toEqual({ action: 'submit', reason: 'network' });
    await waitFor(() => expect(stub.readLocal('memos_draft')).toBe('do not lose me'));
  });

  // A reload triggered while typing must not replace what is in the field with
  // an older persisted draft.
  it('does not overwrite text being typed when it reloads', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_draft: 'old draft' });
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.draft).toBe('old draft'));

    act(() => result.current.setDraft('typing now'));
    await act(async () => {
      await new Promise<void>((resolve) =>
        chrome.storage.local.set({ memos_token: 'memos_pat_x' }, () => resolve()),
      );
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {});

    expect(result.current.draft).toBe('typing now');
  });

  // The persisted draft exists to bring text back; once the user has cleared
  // the field, bringing it back on every new tab would resurrect text they
  // threw away.
  it('forgets the persisted draft once the field is cleared', async () => {
    const stub = seedConfigured();
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));

    vi.stubGlobal('fetch', respondWith(500, {}));
    act(() => result.current.setDraft('changed my mind'));
    await act(async () => {
      await result.current.submit();
    });
    await waitFor(() => expect(stub.readLocal('memos_draft')).toBe('changed my mind'));

    act(() => result.current.setDraft(''));

    await waitFor(() => expect(stub.readLocal('memos_draft')).toBeUndefined());
  });

  // The hook's own contract is "off or unconfigured means no fetch" — it must enforce
  // that itself rather than trust the widget to check `status` before calling
  // an action. A stale `credentials.current` surviving the transition would
  // otherwise let `archive`/`submit` reach the abandoned server on stored ones.
  it('stops issuing requests once a live settings change de-configures it', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', serve());

    const { useMemos } = await import('./useMemos');
    const { saveSettings } = await import('./useSettings');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']));

    // De-configure while the hook stays mounted, through the same live
    // storage-change path the popup or a revoked permission would trigger.
    act(() => saveSettings({ memosUrl: '' }));
    await waitFor(() => expect(result.current.status).toBe('off'));

    const freshFetch = respondWith(200, {});
    vi.stubGlobal('fetch', freshFetch);

    act(() => result.current.setDraft('should not send'));
    await act(async () => {
      await result.current.archive('memos/1');
      await result.current.submit();
      await result.current.refresh();
    });

    expect(freshFetch).not.toHaveBeenCalled();
  });
});
