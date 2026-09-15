import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memosConnectRoutes, reply, routeFetch } from '../test/memosFetch';
import { archiveMemo, createMemo, listMemos, probe, readJson } from './memosClient';

const credentials = { baseUrl: 'https://memo.example.com', token: 'memos_pat_x' };

const respondWith = (status: number, body: unknown) =>
  vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );

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
    });
    expect(fetchMock).toHaveBeenCalledWith('https://memo.example.com/api/v1/auth/me', {
      headers: { Authorization: 'Bearer memos_pat_x' },
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

describe('listMemos', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('asks only for normal-state memos', async () => {
    const fetchMock = respondWith(200, { memos: [] });
    vi.stubGlobal('fetch', fetchMock);
    await listMemos(credentials);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(
      'https://memo.example.com/api/v1/memos?pageSize=200&state=NORMAL',
    );
  });

  it('returns parsed memos', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith(200, { memos: [{ name: 'memos/1', content: 'a #todo', tags: ['todo'] }] }),
    );
    const result = await listMemos(credentials);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.value[0].name).toBe('memos/1');
  });

  it('reports a malformed body as a server error', async () => {
    vi.stubGlobal('fetch', respondWith(200, { nope: true }));
    await expect(listMemos(credentials)).resolves.toEqual({ ok: false, reason: 'server' });
  });

  it('reports a 500 as a server error', async () => {
    vi.stubGlobal('fetch', respondWith(500, {}));
    await expect(listMemos(credentials)).resolves.toEqual({ ok: false, reason: 'server' });
  });
});

describe('createMemo', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('posts the content and returns the created memo', async () => {
    const fetchMock = respondWith(200, { name: 'memos/new', content: 'a #todo', tags: ['todo'] });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createMemo(credentials, 'a #todo');

    expect(fetchMock).toHaveBeenCalledWith('https://memo.example.com/api/v1/memos', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer memos_pat_x',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: 'a #todo', visibility: 'PRIVATE' }),
    });
    expect(result).toMatchObject({ ok: true, value: { name: 'memos/new' } });
  });

  it('reports a rejected write as a server error', async () => {
    vi.stubGlobal('fetch', respondWith(400, {}));
    await expect(createMemo(credentials, 'a')).resolves.toEqual({ ok: false, reason: 'server' });
  });
});

describe('archiveMemo', () => {
  beforeEach(() => vi.unstubAllGlobals());

  // The resource name already carries the `memos/` prefix, so the URL must not
  // add a second one.
  it('patches the resource name with an updateMask', async () => {
    const fetchMock = respondWith(200, {});
    vi.stubGlobal('fetch', fetchMock);

    await archiveMemo(credentials, 'memos/abc');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://memo.example.com/api/v1/memos/abc?updateMask=state',
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer memos_pat_x',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state: 'ARCHIVED' }),
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

describe('readJson', () => {
  it('reports a json() rejection as a server error', async () => {
    const response = {
      json: vi.fn(() => Promise.reject(new Error('JSON parse error'))),
    } as unknown as Response;

    const result = await readJson(response);
    expect(result).toEqual({ ok: false, reason: 'server' });
  });
});
