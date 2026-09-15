import { vi } from 'vitest';

export interface FakeReply {
  status: number;
  body: unknown;
}

export const reply = (status: number, body: unknown = {}): FakeReply => ({ status, body });

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
 * network failure and so hide a request to the wrong URL.
 */
export const routeFetch = (routes: Record<string, Handler>) =>
  vi.fn((input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const handler = routes[`${method} ${url.pathname}`];
    const authorization = new Headers(init?.headers).get('Authorization') ?? '';
    const token = authorization.replace(/^Bearer\s*/, '');

    const { status, body } = handler ? handler({ url, init, token }) : NOT_FOUND;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  });

/**
 * The two endpoints Connect calls, as Memos v0.30 serves them.
 *
 * The asymmetry is the whole point. `instance/profile` is public: it answers
 * 200 for any token, a wrong one or none at all, so it can never prove a token.
 * `auth/me` is not: it answers 401 unless the token is one this server issued,
 * and for one it did, names the account it belongs to.
 *
 * `tokens` maps each token the server accepts to its user's resource name.
 */
export const memosConnectRoutes = ({
  version = '0.30.0',
  tokens = {},
}: {
  version?: string;
  tokens?: Record<string, string>;
} = {}): Record<string, Handler> => ({
  'GET /api/v1/instance/profile': () => reply(200, { version, commit: 'abc123' }),
  'GET /api/v1/auth/me': ({ token }) =>
    Object.hasOwn(tokens, token)
      ? reply(200, { user: { name: tokens[token], username: 'alex', role: 'HOST' } })
      : UNAUTHENTICATED,
});
