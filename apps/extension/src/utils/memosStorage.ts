import { type MemoItem, parseMemoList } from './memos';
import type { MemosFailureReason } from './memosClient';

/**
 * Everything the widget keeps on this machine only.
 *
 * The access token is here rather than in `HubSettings` on purpose:
 * `settingsBackup.RULES` is a mapped type over `keyof HubSettings` and
 * `buildBackup` serialises that whole object into a file the user may share, so
 * a token living there would have to be excluded by hand. Out here, exporting
 * it is impossible at the type level.
 *
 * The connected account's name is local for the token's reason: it describes
 * that token, and another machine may hold a token for a different account.
 *
 * The cache and the draft are local for a plainer reason: neither is a
 * preference, and `chrome.storage.sync` has a byte quota to protect.
 */
const SERVER_KEY = 'memos_server';
const TOKEN_KEY = 'memos_token';
const USER_KEY = 'memos_user';
const CACHE_KEY = 'memos_cache';
const CHECK_KEY = 'memos_check';
const DRAFT_KEY = 'memos_draft';

const FAILURE_REASONS: readonly MemosFailureReason[] = [
  'auth',
  'permission',
  'version',
  'network',
  'server',
];

declare const chrome: {
  storage: {
    local: {
      get: (keys: string[], cb: (items: Record<string, unknown>) => void) => void;
      set: (items: Record<string, unknown>, cb?: () => void) => void;
      remove: (keys: string[], cb?: () => void) => void;
    };
  };
};

const readLocal = (key: string): Promise<unknown> =>
  new Promise((resolve) => chrome.storage.local.get([key], (items) => resolve(items[key])));

const writeLocal = (key: string, value: unknown): Promise<void> =>
  new Promise((resolve) => chrome.storage.local.set({ [key]: value }, () => resolve()));

const removeLocal = (keys: string[]): Promise<void> =>
  new Promise((resolve) => chrome.storage.local.remove(keys, () => resolve()));

const readString = async (key: string): Promise<string> => {
  const value = await readLocal(key);
  return typeof value === 'string' ? value : '';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The server the stored token belongs to.
 *
 * A token is a credential for one host, and the two are stored together for
 * that reason. Connect writes the token to local storage before it writes the
 * URL to sync, so an already-open tab learns of a new token first; pairing that
 * token with the URL the tab still holds would send the new server's credential
 * to the old host. The widget asks nothing until this and `memosUrl` agree.
 */
export const getConnectedServer = (): Promise<string> => readString(SERVER_KEY);

export const setConnectedServer = (baseUrl: string): Promise<void> =>
  writeLocal(SERVER_KEY, baseUrl);

export const getToken = (): Promise<string> => readString(TOKEN_KEY);

export const setToken = (token: string): Promise<void> => writeLocal(TOKEN_KEY, token);

/**
 * The resource name (`users/{id}`) of the account the token belongs to, as
 * Connect read it from `auth/me`.
 *
 * `ListMemos` also returns other users' public and protected memos, so this is
 * what the widget keeps its list to — its own rows, and only those, carry an
 * archive control.
 */
export const getUser = (): Promise<string> => readString(USER_KEY);

export const setUser = (name: string): Promise<void> => writeLocal(USER_KEY, name);

/**
 * The last list the server gave us, so the page renders before the network
 * answers — or without it at all, which is what most days look like when the
 * server is not reachable.
 *
 * Stored with the server it came from, and read back only for that server: the
 * server URL syncs between machines and this cache does not, so after another
 * machine switches servers the list held here belongs to the old one.
 *
 * Validated on the way out through the same parser the client uses: a cache
 * written by an older build must not reach the renderer. Falling back to an
 * empty list is safe, because the widget then asks the server.
 */
export const getCachedMemos = async (baseUrl: string): Promise<MemoItem[]> => {
  const stored = await readLocal(CACHE_KEY);
  if (!isRecord(stored) || stored.baseUrl !== baseUrl) return [];
  return parseMemoList(stored) ?? [];
};

export const setCachedMemos = (baseUrl: string, memos: MemoItem[]): Promise<void> =>
  writeLocal(CACHE_KEY, { baseUrl, memos });

/**
 * When the widget last asked the server, and what came of it.
 *
 * A new tab does not ask again before `nextAt`: every tab would otherwise cost
 * two requests, and people open a lot of tabs. `failure` is kept so a tab that
 * skips the request still shows why the list it has may be stale.
 */
export interface MemosCheck {
  baseUrl: string;
  /** Epoch milliseconds before which a new tab uses the cache without asking. */
  nextAt: number;
  /** What the last attempt failed with, or null when it succeeded. */
  failure: MemosFailureReason | null;
}

/** The last check against this server, or null — including for one against another server. */
export const getCheck = async (baseUrl: string): Promise<MemosCheck | null> => {
  const stored = await readLocal(CHECK_KEY);
  if (!isRecord(stored) || stored.baseUrl !== baseUrl) return null;
  if (typeof stored.nextAt !== 'number' || !Number.isFinite(stored.nextAt)) return null;

  const { failure } = stored;
  if (failure !== null && !FAILURE_REASONS.includes(failure as MemosFailureReason)) return null;

  return { baseUrl, nextAt: stored.nextAt, failure: failure as MemosFailureReason | null };
};

export const setCheck = (check: MemosCheck): Promise<void> => writeLocal(CHECK_KEY, check);

/**
 * Forgets what one server said, for a switch to another.
 *
 * Keeps the draft — text the user typed, not the server's data — and the token
 * and account, which the new connection overwrites straight after.
 */
export const clearServerData = (): Promise<void> => removeLocal([CACHE_KEY, CHECK_KEY]);

/** Forgets everything the widget stored on this machine, for a disconnect. */
export const clearAllMemosData = (): Promise<void> =>
  removeLocal([SERVER_KEY, TOKEN_KEY, USER_KEY, CACHE_KEY, CHECK_KEY, DRAFT_KEY]);

/**
 * Text that was typed but never landed on the server.
 *
 * One draft, not a queue: the write is synchronous and user-initiated, so
 * re-sending is a deliberate click. This exists only so that closing the tab
 * after a failed submit does not throw the text away.
 */
export const getDraft = (): Promise<string> => readString(DRAFT_KEY);

export const setDraft = (text: string): Promise<void> => writeLocal(DRAFT_KEY, text);

export const clearDraft = (): Promise<void> => removeLocal([DRAFT_KEY]);
