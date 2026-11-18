import { vi } from 'vitest';

export interface FakeReply {
  status: number;
  body: unknown;
  /** The `Location` header, for a redirect. */
  location?: string;
}

export const reply = (status: number, body: unknown = {}): FakeReply => ({ status, body });

/** A redirect to `location` — 302 unless the test names another redirect status. */
export const redirectTo = (location: string, status = 302): FakeReply => ({
  status,
  body: {},
  location,
});

/** The Fetch standard's redirect statuses. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** The standard's cap on redirects in one fetch, past which it is a network error. */
const MAX_REDIRECTS = 20;

/**
 * What Memos answers for a missing, expired, revoked or unknown token on an
 * endpoint that requires one: gRPC `Unauthenticated` (code 16), which the
 * gateway serves as HTTP 401.
 */
export const UNAUTHENTICATED: FakeReply = reply(401, {
  code: 16,
  message: 'user not authenticated',
  details: [],
});

/** What the gateway answers for a route this server does not have. */
const NOT_FOUND: FakeReply = reply(404, { code: 5, message: 'Not Found', details: [] });

/**
 * Where a Memos server serves its REST API: `/api/v1` up to 0.30, `/api` from
 * 26.10 on. The JSON on either side is the same.
 */
export type MemosApi = '/api' | '/api/v1';

/**
 * What a 26.10+ server answers for anything under `/api/v1`: 410 Gone, gRPC
 * `FailedPrecondition` (code 12). Measured against 26.11.0, message shortened.
 * Only the release that removed v1 does this — later ones are to answer 404.
 */
const V1_GONE: FakeReply = reply(410, { code: 12, message: 'API v1 has been removed. Use /api/...' });

/** Whether a route table describes a server on the post-26.10 prefix. */
const servesNewApi = (routes: Record<string, unknown>): boolean =>
  Object.keys(routes).some((key) => / \/api\/(?!v1\/)/.test(key));

export interface FakeRequest {
  url: URL;
  init: RequestInit | undefined;
  /** The bearer token the request carried, or `''` when it carried none. */
  token: string;
}

type Handler = (request: FakeRequest) => FakeReply;

/**
 * A `fetch` that answers by method and path, the way a real server does,
 * rather than giving every URL the same response.
 *
 * Keys are `'GET /api/v1/auth/me'`. Anything not routed gets the 404 a real
 * server would send — not a rejection, which the client would read as a
 * network failure and so hide a request to the wrong URL. A table with routes
 * on the new `/api` prefix is a 26.10+ server, so an unrouted `/api/v1` path
 * gets that release's 410 instead.
 *
 * Routes match on the path alone, so a handler that cares which host it was
 * asked on reads `url.host`.
 *
 * A reply carrying a `location` is a redirect, handled the way the Fetch
 * standard's `redirect` modes do: `'error'` rejects with the TypeError a
 * network error becomes, `'manual'` resolves to the opaque-redirect response
 * (status 0, not ok), and `'follow'` (the default) asks the routes again at the
 * new URL — without `Authorization` once the hop leaves the origin, which the
 * standard's HTTP-redirect fetch removes. Followed hops reach the handlers, not
 * this mock's call log, since a real redirect is not a second `fetch` call.
 */
export const routeFetch = (routes: Record<string, Handler>) => {
  const answer = (url: URL, init: RequestInit | undefined, hops: number): Promise<unknown> => {
    const method = init?.method ?? 'GET';
    const handler = routes[`${method} ${url.pathname}`];
    const authorization = new Headers(init?.headers).get('Authorization') ?? '';
    const token = authorization.replace(/^Bearer\s*/, '');

    const unrouted =
      servesNewApi(routes) && url.pathname.startsWith('/api/v1/') ? V1_GONE : NOT_FOUND;
    const { status, body, location } = handler ? handler({ url, init, token }) : unrouted;

    if (REDIRECT_STATUSES.has(status) && location !== undefined) {
      const mode = init?.redirect ?? 'follow';
      if (mode === 'error' || hops >= MAX_REDIRECTS) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      if (mode === 'manual') {
        return Promise.resolve({ ok: false, status: 0, type: 'opaqueredirect' });
      }
      const next = new URL(location, url);
      const headers = new Headers(init?.headers);
      if (next.origin !== url.origin) headers.delete('Authorization');
      return answer(next, { ...init, headers }, hops + 1);
    }

    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  };

  return vi.fn((input: string, init?: RequestInit) => answer(new URL(input), init, 0));
};

/**
 * The two endpoints Connect calls, as Memos serves them on `api` — v0.30's
 * `/api/v1` unless the test asks for a 26.10+ server.
 *
 * The asymmetry is the whole point. `instance/profile` is public: it answers
 * 200 for any token, a wrong one or none at all, so it can never prove a token.
 * `auth/me` is not: it answers 401 unless the token is one this server issued,
 * and for one it did, names the account it belongs to.
 *
 * `tokens` maps each token the server accepts to its user's resource name.
 */
export const memosConnectRoutes = ({
  api = '/api/v1',
  version = api === '/api' ? '26.11.0' : '0.30.0',
  tokens = {},
}: {
  api?: MemosApi;
  version?: string;
  tokens?: Record<string, string>;
} = {}): Record<string, Handler> => ({
  [`GET ${api}/instance/profile`]: () => reply(200, { version, commit: 'abc123' }),
  [`GET ${api}/auth/me`]: ({ token }) =>
    Object.hasOwn(tokens, token)
      ? reply(200, { user: { name: tokens[token], username: 'alex', role: 'HOST' } })
      : UNAUTHENTICATED,
});

/**
 * `ListMemos` as Memos serves it on `api` — public, like `instance/profile`.
 *
 * A caller whose token the server accepts gets `memos`. Any other caller,
 * including one whose token has expired, still gets 200 — with only the memos
 * marked `visibility: 'PUBLIC'`. That is what once made an expired token look
 * like an account with nothing in it, so the fake must not answer 401 here.
 */
export const memosListRoute = ({
  api = '/api/v1',
  tokens = {},
  memos = [],
}: {
  api?: MemosApi;
  tokens?: Record<string, string>;
  memos?: Record<string, unknown>[];
} = {}): Record<string, Handler> => ({
  [`GET ${api}/memos`]: ({ token }) =>
    reply(200, {
      memos: Object.hasOwn(tokens, token)
        ? memos
        : memos.filter((memo) => memo.visibility === 'PUBLIC'),
      nextPageToken: '',
    }),
});
