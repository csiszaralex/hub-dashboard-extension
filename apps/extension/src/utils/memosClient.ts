import { isSupportedVersion, type MemoItem, parseMemoList } from './memos';

export interface MemosCredentials {
  baseUrl: string;
  token: string;
}

/**
 * Why a call failed, so the caller can tell the four apart.
 *
 * `network` is the common case — every day spent away from the server — and
 * must stay silent on the dashboard. `auth` and `version` are the two the user
 * has to act on, and neither is worth retrying.
 */
export type MemosFailureReason = 'auth' | 'permission' | 'version' | 'network' | 'server';

export type MemosResult<T> = { ok: true; value: T } | { ok: false; reason: MemosFailureReason };

/** One page is the whole working set: the widget shows the newest few, not an archive. */
export const PAGE_SIZE = 200;

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

const jsonHeaders = (token: string) => ({
  ...authHeader(token),
  'Content-Type': 'application/json',
});

const reasonFor = (status: number): MemosFailureReason =>
  status === 401 || status === 403 ? 'auth' : 'server';

type RequestResult = { ok: false; reason: MemosFailureReason } | { ok: true; response: Response };

/**
 * Fetch with unified error handling.
 *
 * Network errors are caught as `network`. Per-status overrides (e.g., 404 →
 * `version`) are applied before the generic non-ok branch. On success, the
 * Response is returned so the caller can decide whether to parse JSON.
 */
const request = async (
  url: string,
  init?: RequestInit,
  overrides?: Record<number, MemosFailureReason>,
): Promise<RequestResult> => {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (overrides && response.status in overrides) {
    return { ok: false, reason: overrides[response.status] };
  }

  if (!response.ok) {
    return { ok: false, reason: reasonFor(response.status) };
  }

  return { ok: true, response };
};

/**
 * Parse a response body as JSON.
 *
 * Kept separate from `request` because some callers (archiveMemo) do not
 * read a body. A .json() rejection is mapped to `server` so failures are
 * consistent with the rest of the client.
 */
export const readJson = async (
  response: Response,
): Promise<{ ok: false; reason: 'server' } | { ok: true; payload: unknown }> => {
  try {
    const payload = await response.json();
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'server' };
  }
};

/** What a successful Connect has proved about the server and the token. */
export interface MemosConnection {
  version: string;
  /** The token's account, as a resource name: `users/{id}`. */
  user: string;
}

/**
 * The server's version, then the account the token belongs to.
 *
 * Two calls, because the first cannot prove the token: `instance/profile` is
 * public and answers 200 for a wrong token or none at all. It is still first,
 * since its 404 is how an instance older than 0.30 presents itself (the route
 * was `/api/v1/workspace/profile` then), and that must map to `version` — an
 * upgrade message — rather than to `server`.
 *
 * `auth/me` is not public: a missing, expired, revoked or unknown token gets
 * 401, which is what makes this the check that a token is real. Its user name
 * is kept, because `ListMemos` returns other users' visible memos too and the
 * widget needs to know which ones are this account's own.
 */
export const probe = async ({
  baseUrl,
  token,
}: MemosCredentials): Promise<MemosResult<MemosConnection>> => {
  const profile = await request(
    `${baseUrl}/api/v1/instance/profile`,
    { headers: authHeader(token) },
    { 404: 'version' },
  );
  if (!profile.ok) return profile;

  const profileJson = await readJson(profile.response);
  if (!profileJson.ok) return profileJson;

  const version = (profileJson.payload as { version?: unknown } | null)?.version;
  if (!isSupportedVersion(version)) return { ok: false, reason: 'version' };

  const me = await request(`${baseUrl}/api/v1/auth/me`, { headers: authHeader(token) });
  if (!me.ok) return me;

  const meJson = await readJson(me.response);
  if (!meJson.ok) return meJson;

  // A name the widget cannot match `Memo.creator` against is not a connection:
  // every memo would be filtered out, and the list would sit silently empty.
  const user = (meJson.payload as { user?: { name?: unknown } | null } | null)?.user?.name;
  if (typeof user !== 'string' || !/^users\/.+/.test(user)) return { ok: false, reason: 'server' };

  return { ok: true, value: { version: version as string, user } };
};

/**
 * The newest memos, archived ones excluded by the request itself.
 *
 * `state` is a first-class list parameter in v0.30, so nothing has to be
 * filtered out afterwards. Tag filtering stays client-side: chips then cost
 * zero requests, which is what matters on a page that opens constantly.
 */
export const listMemos = async ({
  baseUrl,
  token,
}: MemosCredentials): Promise<MemosResult<MemoItem[]>> => {
  const result = await request(`${baseUrl}/api/v1/memos?pageSize=${PAGE_SIZE}&state=NORMAL`, {
    headers: authHeader(token),
  });

  if (!result.ok) return result;

  const json = await readJson(result.response);
  if (!json.ok) return json;

  const memos = parseMemoList(json.payload);
  if (!memos) return { ok: false, reason: 'server' };

  return { ok: true, value: memos };
};

export const createMemo = async (
  { baseUrl, token }: MemosCredentials,
  content: string,
): Promise<MemosResult<MemoItem>> => {
  const result = await request(`${baseUrl}/api/v1/memos`, {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ content, visibility: 'PRIVATE' }),
  });

  if (!result.ok) return result;

  const json = await readJson(result.response);
  if (!json.ok) return json;

  // One memo, validated through the same parser as the list so a created memo
  // and a listed one can never differ in shape.
  const parsed = parseMemoList({ memos: [json.payload] });
  if (!parsed || parsed.length !== 1) return { ok: false, reason: 'server' };

  return { ok: true, value: parsed[0] };
};

/**
 * Marks a memo done.
 *
 * Archive rather than delete: reversible, leaves the content untouched, and a
 * misclick on the new tab page costs nothing. `name` already carries the
 * `memos/` prefix — it is the resource name, not a bare id.
 */
export const archiveMemo = async (
  { baseUrl, token }: MemosCredentials,
  name: string,
): Promise<MemosResult<null>> => {
  const result = await request(`${baseUrl}/api/v1/${name}?updateMask=state`, {
    method: 'PATCH',
    headers: jsonHeaders(token),
    body: JSON.stringify({ state: 'ARCHIVED' }),
  });

  if (!result.ok) return result;

  return { ok: true, value: null };
};
