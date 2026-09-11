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

/**
 * The server's version.
 *
 * A 404 means an instance older than 0.30, where this route was still
 * `/api/v1/workspace/profile` — so it maps to `version`, not to `server`. That
 * is what turns an old instance into an upgrade message rather than a shrug.
 */
export const probe = async ({ baseUrl, token }: MemosCredentials): Promise<MemosResult<string>> => {
  let response: Response;
  try {
    response = (await fetch(`${baseUrl}/api/v1/instance/profile`, {
      headers: authHeader(token),
    })) as Response;
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (response.status === 404) return { ok: false, reason: 'version' };
  if (!response.ok) return { ok: false, reason: reasonFor(response.status) };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'server' };
  }

  const version = (payload as { version?: unknown } | null)?.version;
  if (!isSupportedVersion(version)) return { ok: false, reason: 'version' };

  return { ok: true, value: version as string };
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
  let response: Response;
  try {
    response = (await fetch(`${baseUrl}/api/v1/memos?pageSize=${PAGE_SIZE}&state=NORMAL`, {
      headers: authHeader(token),
    })) as Response;
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (!response.ok) return { ok: false, reason: reasonFor(response.status) };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'server' };
  }

  const memos = parseMemoList(payload);
  if (!memos) return { ok: false, reason: 'server' };

  return { ok: true, value: memos };
};

export const createMemo = async (
  { baseUrl, token }: MemosCredentials,
  content: string,
): Promise<MemosResult<MemoItem>> => {
  let response: Response;
  try {
    response = (await fetch(`${baseUrl}/api/v1/memos`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ content, visibility: 'PRIVATE' }),
    })) as Response;
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (!response.ok) return { ok: false, reason: reasonFor(response.status) };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: 'server' };
  }

  // One memo, validated through the same parser as the list so a created memo
  // and a listed one can never differ in shape.
  const parsed = parseMemoList({ memos: [payload] });
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
  let response: Response;
  try {
    response = (await fetch(`${baseUrl}/api/v1/${name}?updateMask=state`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ state: 'ARCHIVED' }),
    })) as Response;
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (!response.ok) return { ok: false, reason: reasonFor(response.status) };

  return { ok: true, value: null };
};
