import { type MemoItem, parseMemoList } from './memos';

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
const TOKEN_KEY = 'memos_token';
const USER_KEY = 'memos_user';
const CACHE_KEY = 'memos_cache';
const DRAFT_KEY = 'memos_draft';

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

const readString = async (key: string): Promise<string> => {
  const value = await readLocal(key);
  return typeof value === 'string' ? value : '';
};

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
 * Validated on the way out through the same parser the client uses: a cache
 * written by an older build must not reach the renderer. Falling back to an
 * empty list is safe, because a refresh is already in flight when this is read.
 */
export const getCachedMemos = async (): Promise<MemoItem[]> =>
  parseMemoList(await readLocal(CACHE_KEY)) ?? [];

export const setCachedMemos = (memos: MemoItem[]): Promise<void> =>
  writeLocal(CACHE_KEY, { memos });

/**
 * Text that was typed but never landed on the server.
 *
 * One draft, not a queue: the write is synchronous and user-initiated, so
 * re-sending is a deliberate click. This exists only so that closing the tab
 * after a failed submit does not throw the text away.
 */
export const getDraft = (): Promise<string> => readString(DRAFT_KEY);

export const setDraft = (text: string): Promise<void> => writeLocal(DRAFT_KEY, text);

export const clearDraft = (): Promise<void> =>
  new Promise((resolve) => chrome.storage.local.remove([DRAFT_KEY], () => resolve()));
