import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memosConnectRoutes, memosListRoute, reply, routeFetch } from '../test/memosFetch';
import type * as Client from './memosClient';

// Imported per test: the client remembers each server's API prefix for the
// life of the page, and every test is a fresh page.
let archiveMemo: typeof Client.archiveMemo;
let createMemo: typeof Client.createMemo;
let getCurrentUser: typeof Client.getCurrentUser;
let listMemos: typeof Client.listMemos;
let MEMOS_TIMEOUT_MS: typeof Client.MEMOS_TIMEOUT_MS;
let probe: typeof Client.probe;
let readJson: typeof Client.readJson;

beforeEach(async () => {
  ({ archiveMemo, createMemo, getCurrentUser, listMemos, MEMOS_TIMEOUT_MS, probe, readJson } =
    await import('./memosClient'));
});

const credentials = { baseUrl: 'https://memo.example.com', token: 'memos_pat_x' };

/** Every URL a fetch mock was called with, in order. */
const urls = (fetchMock: { mock: { calls: unknown[][] } }) =>
  fetchMock.mock.calls.map(([input]) => String(input));

describe('probe', () => {
  beforeEach(() => vi.unstubAllGlobals());

  /** A v0.30 server that issued `memos_pat_x` to `users/1`, and no other token. */
  const server = () =>
    routeFetch(memosConnectRoutes({ tokens: { memos_pat_x: 'users/1' } }));

  it('returns the version and the account the token belongs to', async () => {
    vi.stubGlobal('fetch', server());
    await expect(probe(credentials)).resolves.toEqual({
      ok: true,
      value: { version: '0.30.0', user: 'users/1' },
    });
  });

  it('sends the bearer token to the instance profile and the current-user endpoints', async () => {
    const fetchMock = server();
    vi.stubGlobal('fetch', fetchMock);
    await probe(credentials);
    expect(fetchMock).toHaveBeenCalledWith('https://memo.example.com/api/v1/instance/profile', {
      headers: { Authorization: 'Bearer memos_pat_x' },
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenCalledWith('https://memo.example.com/api/v1/auth/me', {
      headers: { Authorization: 'Bearer memos_pat_x' },
      signal: expect.any(AbortSignal),
    });
  });

  it('refuses a server below the floor', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch(memosConnectRoutes({ version: '0.29.4', tokens: { memos_pat_x: 'users/1' } })),
    );
    await expect(probe(credentials)).resolves.toEqual({ ok: false, reason: 'version' });
  });

  // Pre-0.30 the endpoint was /api/v1/workspace/profile, so a 404 here is not a
  // missing route — it is an old server, and must reach the user as "upgrade"
  // rather than as a generic failure. A server with none of the v0.30 routes
  // 404s on every one of them.
  it('reads a 404 as an unsupported server, not a server error', async () => {
    vi.stubGlobal('fetch', routeFetch({}));
    await expect(probe(credentials)).resolves.toEqual({ ok: false, reason: 'version' });
  });

  // The profile endpoint is public — it answers 200 for any token — so it can
  // never be what rejects one. Only `auth/me` does.
  it('reports a token the server did not issue as auth, although the profile answers', async () => {
    const fetchMock = routeFetch(memosConnectRoutes({ tokens: { memos_pat_real: 'users/1' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(probe(credentials)).resolves.toEqual({ ok: false, reason: 'auth' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://memo.example.com/api/v1/instance/profile',
      expect.anything(),
    );
  });

  it('reports an empty token as auth', async () => {
    vi.stubGlobal('fetch', server());
    await expect(probe({ ...credentials, token: '' })).resolves.toEqual({
      ok: false,
      reason: 'auth',
    });
  });

  it('reports any other failure of the current-user endpoint as a server error', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        ...memosConnectRoutes({ tokens: { memos_pat_x: 'users/1' } }),
        'GET /api/v1/auth/me': () => reply(500, { code: 13, message: 'internal', details: [] }),
      }),
    );
    await expect(probe(credentials)).resolves.toEqual({ ok: false, reason: 'server' });
  });

  // The name is what the widget later matches `Memo.creator` against, so a
  // body that does not carry a usable one cannot count as a connection.
  it.each([
    ['no user', {}],
    ['a user without a name', { user: {} }],
    ['a non-string name', { user: { name: 42 } }],
    ['an empty name', { user: { name: '' } }],
    ['a name that is not a user resource', { user: { name: 'memos/1' } }],
    ['a bare users/ prefix', { user: { name: 'users/' } }],
  ])('reports a current user with %s as a server error', async (_label, body) => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        ...memosConnectRoutes({ tokens: { memos_pat_x: 'users/1' } }),
        'GET /api/v1/auth/me': () => reply(200, body),
      }),
    );
    await expect(probe(credentials)).resolves.toEqual({ ok: false, reason: 'server' });
  });

  it('reports a thrown fetch as network', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(probe(credentials)).resolves.toEqual({ ok: false, reason: 'network' });
  });
});

describe('getCurrentUser', () => {
  beforeEach(() => vi.unstubAllGlobals());

  // The widget calls this on every refresh to prove the stored token still
  // works, so it must not also pay for the version check Connect needs. The
  // page's one prefix lookup is the only other request.
  it('returns the account the token belongs to, from auth/me alone', async () => {
    const fetchMock = routeFetch(memosConnectRoutes({ tokens: { memos_pat_x: 'users/1' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCurrentUser(credentials)).resolves.toEqual({ ok: true, value: 'users/1' });
    expect(urls(fetchMock)).toEqual([
      'https://memo.example.com/api/instance/profile',
      'https://memo.example.com/api/v1/auth/me',
    ]);
  });

  // An expired or revoked token looks exactly like one the server never issued.
  it('reports a token the server no longer accepts as auth', async () => {
    vi.stubGlobal('fetch', routeFetch(memosConnectRoutes({ tokens: { memos_pat_new: 'users/1' } })));
    await expect(getCurrentUser(credentials)).resolves.toEqual({ ok: false, reason: 'auth' });
  });

  // A server downgraded below 0.30 has no `auth/me` at all. Reading that as a
  // generic server error would tell the user to look at their server's logs
  // for what is really an upgrade.
  it('reads a 404 as an unsupported server', async () => {
    vi.stubGlobal('fetch', routeFetch({}));
    await expect(getCurrentUser(credentials)).resolves.toEqual({ ok: false, reason: 'version' });
  });

  it('reports a body without a usable user name as a server error', async () => {
    vi.stubGlobal('fetch', routeFetch({ 'GET /api/v1/auth/me': () => reply(200, { user: {} }) }));
    await expect(getCurrentUser(credentials)).resolves.toEqual({ ok: false, reason: 'server' });
  });

  it('reports a thrown fetch as network', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(getCurrentUser(credentials)).resolves.toEqual({ ok: false, reason: 'network' });
  });
});

describe('listMemos', () => {
  beforeEach(() => vi.unstubAllGlobals());

  const listing = (body: unknown, status = 200) =>
    routeFetch({
      ...memosConnectRoutes({ api: '/api' }),
      'GET /api/memos': () => reply(status, body),
    });

  it('asks only for normal-state memos', async () => {
    const fetchMock = listing({ memos: [] });
    vi.stubGlobal('fetch', fetchMock);
    await listMemos(credentials);
    expect(urls(fetchMock)).toContain(
      'https://memo.example.com/api/memos?pageSize=200&state=NORMAL',
    );
  });

  it('returns parsed memos', async () => {
    vi.stubGlobal(
      'fetch',
      listing({ memos: [{ name: 'memos/1', content: 'a #todo', tags: ['todo'] }] }),
    );
    const result = await listMemos(credentials);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.value[0].name).toBe('memos/1');
  });

  it('reports a malformed body as a server error', async () => {
    vi.stubGlobal('fetch', listing({ nope: true }));
    await expect(listMemos(credentials)).resolves.toEqual({ ok: false, reason: 'server' });
  });

  it('reports a 500 as a server error', async () => {
    vi.stubGlobal('fetch', listing({}, 500));
    await expect(listMemos(credentials)).resolves.toEqual({ ok: false, reason: 'server' });
  });
});

describe('createMemo', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('posts the content and returns the created memo', async () => {
    const fetchMock = routeFetch({
      ...memosConnectRoutes({ api: '/api' }),
      'POST /api/memos': () =>
        reply(200, { name: 'memos/new', content: 'a #todo', tags: ['todo'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createMemo(credentials, 'a #todo');

    expect(fetchMock).toHaveBeenCalledWith('https://memo.example.com/api/memos', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer memos_pat_x',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: 'a #todo', visibility: 'PRIVATE' }),
      signal: expect.any(AbortSignal),
    });
    expect(result).toMatchObject({ ok: true, value: { name: 'memos/new' } });
  });

  it('reports a rejected write as a server error', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({ ...memosConnectRoutes({ api: '/api' }), 'POST /api/memos': () => reply(400) }),
    );
    await expect(createMemo(credentials, 'a')).resolves.toEqual({ ok: false, reason: 'server' });
  });
});

describe('archiveMemo', () => {
  beforeEach(() => vi.unstubAllGlobals());

  // The resource name already carries the `memos/` prefix, so the URL must not
  // add a second one.
  it('patches the resource name with an updateMask', async () => {
    const fetchMock = routeFetch({
      ...memosConnectRoutes({ api: '/api' }),
      'PATCH /api/memos/abc': () => reply(200),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(archiveMemo(credentials, 'memos/abc')).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://memo.example.com/api/memos/abc?updateMask=state',
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer memos_pat_x',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state: 'ARCHIVED' }),
        signal: expect.any(AbortSignal),
      },
    );
  });

  it('reports a thrown fetch as network', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(archiveMemo(credentials, 'memos/abc')).resolves.toEqual({
      ok: false,
      reason: 'network',
    });
  });
});

describe('API prefix', () => {
  beforeEach(() => vi.unstubAllGlobals());

  const tokens = { memos_pat_x: 'users/1' };

  /** A 26.10+ server: everything under /api, and 410 for anything under /api/v1. */
  const currentServer = () =>
    routeFetch({
      ...memosConnectRoutes({ api: '/api', tokens }),
      ...memosListRoute({ api: '/api', tokens }),
      'POST /api/memos': () => reply(200, { name: 'memos/new', content: 'a' }),
      'PATCH /api/memos/abc': () => reply(200),
    });

  /** A 0.30 server: everything under /api/v1, and 404 for the rest. */
  const legacyServer = () =>
    routeFetch({ ...memosConnectRoutes({ tokens }), ...memosListRoute({ tokens }) });

  // 26.10 moved every route from /api/v1 to /api and answers the old prefix
  // with 410. Nothing may still be sent there.
  it('talks to a 26.10+ server under /api only', async () => {
    const fetchMock = currentServer();
    vi.stubGlobal('fetch', fetchMock);

    await expect(probe(credentials)).resolves.toEqual({
      ok: true,
      value: { version: '26.11.0', user: 'users/1' },
    });
    await expect(listMemos(credentials)).resolves.toMatchObject({ ok: true });
    await expect(createMemo(credentials, 'a')).resolves.toMatchObject({ ok: true });
    await expect(archiveMemo(credentials, 'memos/abc')).resolves.toMatchObject({ ok: true });

    expect(urls(fetchMock).filter((url) => url.includes('/api/v1/'))).toEqual([]);
  });

  // A 0.30 server has nothing under /api but v1, so its 404 on the new
  // profile route is the sign to use the old prefix, not a failure.
  it('falls back to /api/v1 on a server that 404s the new profile route', async () => {
    const fetchMock = legacyServer();
    vi.stubGlobal('fetch', fetchMock);

    await expect(probe(credentials)).resolves.toEqual({
      ok: true,
      value: { version: '0.30.0', user: 'users/1' },
    });
    await expect(listMemos(credentials)).resolves.toMatchObject({ ok: true });

    expect(urls(fetchMock)).toEqual([
      'https://memo.example.com/api/instance/profile',
      'https://memo.example.com/api/v1/instance/profile',
      'https://memo.example.com/api/v1/auth/me',
      'https://memo.example.com/api/v1/memos?pageSize=200&state=NORMAL',
    ]);
  });

  // A refresh sends `auth/me` and the list together; they must share one
  // lookup rather than each paying for its own.
  it('looks the prefix up once for calls made together', async () => {
    const fetchMock = currentServer();
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([getCurrentUser(credentials), listMemos(credentials)]);
    await listMemos(credentials);

    expect(urls(fetchMock).filter((url) => url.endsWith('/instance/profile'))).toHaveLength(1);
  });

  it('keeps the prefix per server', async () => {
    const current = currentServer();
    const legacy = legacyServer();
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
      input.startsWith('https://old.example.com/') ? legacy(input, init) : current(input, init),
    );

    await expect(listMemos({ ...credentials, baseUrl: 'https://old.example.com' })).resolves
      .toMatchObject({ ok: true });
    await expect(listMemos(credentials)).resolves.toMatchObject({ ok: true });

    expect(urls(legacy)).toContain(
      'https://old.example.com/api/v1/memos?pageSize=200&state=NORMAL',
    );
    expect(urls(current)).toContain(
      'https://memo.example.com/api/memos?pageSize=200&state=NORMAL',
    );
  });

  // Offline is the everyday case. Remembering that lookup's failure would keep
  // the page from reaching the server once it is back.
  it('does not remember a lookup that failed', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(listMemos(credentials)).resolves.toEqual({ ok: false, reason: 'network' });

    vi.stubGlobal('fetch', currentServer());
    await expect(listMemos(credentials)).resolves.toMatchObject({ ok: true });
  });

  // The server can be upgraded under an open tab. Its 410 on v1 means "the API
  // moved", not a broken server: the page looks again and resends once.
  it('looks again and resends once when a v1 route answers 410', async () => {
    vi.stubGlobal('fetch', legacyServer());
    await expect(listMemos(credentials)).resolves.toMatchObject({ ok: true });

    const upgraded = currentServer();
    vi.stubGlobal('fetch', upgraded);

    await expect(listMemos(credentials)).resolves.toMatchObject({ ok: true });
    expect(urls(upgraded)).toEqual([
      'https://memo.example.com/api/v1/memos?pageSize=200&state=NORMAL',
      'https://memo.example.com/api/instance/profile',
      'https://memo.example.com/api/memos?pageSize=200&state=NORMAL',
    ]);
  });

  it('reports a 410 that persists after looking again as a server error', async () => {
    const fetchMock = routeFetch({
      ...memosConnectRoutes({ api: '/api' }),
      'GET /api/memos': () => reply(410),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listMemos(credentials)).resolves.toEqual({ ok: false, reason: 'server' });
    expect(urls(fetchMock).filter((url) => url.includes('/memos?'))).toHaveLength(2);
  });
});

describe('request timeout', () => {
  beforeEach(() => vi.unstubAllGlobals());

  // A LAN host that has gone away does not refuse the connection, it just never
  // answers — and with nothing cached the widget renders nothing until the TCP
  // timeout, which is minutes. Every call gives up after MEMOS_TIMEOUT_MS.
  it('gives every request a signal that aborts after the timeout', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = routeFetch({
      ...memosConnectRoutes({ api: '/api', tokens: { memos_pat_x: 'users/1' } }),
      'GET /api/memos': () => reply(200, { memos: [] }),
      'POST /api/memos': () => reply(200, { name: 'memos/new', content: 'a' }),
      'PATCH /api/memos/abc': () => reply(200, {}),
    });
    vi.stubGlobal('fetch', fetchMock);

    await probe(credentials);
    await listMemos(credentials);
    await createMemo(credentials, 'a');
    await archiveMemo(credentials, 'memos/abc');

    // prefix lookup, profile, auth/me, list, create, archive
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(timeoutSpy).toHaveBeenCalledTimes(6);
    for (const call of timeoutSpy.mock.calls) expect(call).toEqual([MEMOS_TIMEOUT_MS]);
    fetchMock.mock.calls.forEach(([, init], i) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal).toBe(timeoutSpy.mock.results[i].value);
    });
  });

  it('gives up after eight seconds', () => {
    expect(MEMOS_TIMEOUT_MS).toBe(8000);
  });

  // `AbortSignal.timeout` rejects with a `TimeoutError`; an abort from anywhere
  // else with an `AbortError`. Either way nothing came back from the server.
  it.each(['TimeoutError', 'AbortError'])('reports a fetch aborted with %s as network', async (name) => {
    vi.stubGlobal('fetch', () => Promise.reject(new DOMException('signal timed out', name)));
    await expect(listMemos(credentials)).resolves.toEqual({ ok: false, reason: 'network' });
    await expect(probe(credentials)).resolves.toEqual({ ok: false, reason: 'network' });
  });
});

describe('readJson', () => {
  it('reports a json() rejection as a server error', async () => {
    const response = {
      json: vi.fn(() => Promise.reject(new Error('JSON parse error'))),
    } as unknown as Response;

    const result = await readJson(response);
    expect(result).toEqual({ ok: false, reason: 'server' });
  });
});
