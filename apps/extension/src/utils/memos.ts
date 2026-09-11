/**
 * The Memos REST API this adapter is written against.
 *
 * One version rather than a tolerated range: Memos has moved this surface
 * repeatedly — `rowStatus` became `state`, the CEL filter syntax was reworked,
 * and in 0.30 `workspace_service` was renamed to `instance_service` outright.
 * A dual-shape parser would be guesswork against versions nobody runs.
 */
export const MIN_MEMOS_VERSION = '0.30.0';

const MIN_PARTS = [0, 30, 0] as const;

export interface MemoItem {
  /** Resource name, `memos/{uid}` — what update addresses. */
  name: string;
  content: string;
  /** Server-rendered short form. First-class field on `Memo`; never computed here. */
  snippet: string;
  /** Server-derived. Memos parses `#tag` out of content itself. */
  tags: string[];
  createTime: string;
  pinned: boolean;
}

/**
 * The instance's API base, or null if the input cannot be one.
 *
 * HTTPS only: the new tab page is a secure context, so a plain-HTTP instance
 * would be mixed-content blocked. Rejecting here turns that into a message in
 * the popup instead of a silent failure on the dashboard.
 */
export const normalizeBaseUrl = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;

  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
};

/**
 * The match pattern for `chrome.permissions.request`.
 *
 * Always the whole origin, even for an instance hosted under a subpath: Chrome
 * grants host access per origin, and a pattern without a path is rejected
 * outright.
 */
export const originPattern = (baseUrl: string): string => `${new URL(baseUrl).origin}/*`;

/**
 * Whether this server is new enough.
 *
 * A floor rather than an exact pin: refusing a future release would break on
 * the next upstream version, and if the shape does change, the probe's list
 * call fails with a clear error anyway. A malformed string is refused rather
 * than coerced — `Number('')` is 0, and zeroes would read as "very old".
 */
export const isSupportedVersion = (version: unknown): boolean => {
  if (typeof version !== 'string') return false;

  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return false;

  const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== MIN_PARTS[i]) return parts[i] > MIN_PARTS[i];
  }
  return true;
};

/**
 * The memo body to send, with the active filter's tag appended.
 *
 * Without this, a memo written while filtered to `#todo` would vanish from the
 * view the moment it was submitted.
 */
export const composeContent = (text: string, tag: string | null): string => {
  const body = text.trim();
  if (!tag || !body) return body;

  // Whole word, case-insensitive: `#todolist` must not count as `#todo`.
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`#${escaped}(?![\\w-])`, 'i').test(body)) return body;

  return `${body} #${tag}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The memos out of a `ListMemos` response, or null if the payload is not one.
 *
 * Null rather than a throw, so `memosClient` can fold a malformed body into the
 * same `server` failure as a 500 instead of exploding inside a render.
 */
export const parseMemoList = (payload: unknown): MemoItem[] | null => {
  if (!isRecord(payload) || !Array.isArray(payload.memos)) return null;

  const memos: MemoItem[] = [];
  for (const entry of payload.memos) {
    if (!isRecord(entry)) return null;
    if (typeof entry.name !== 'string' || typeof entry.content !== 'string') return null;

    memos.push({
      name: entry.name,
      content: entry.content,
      snippet: typeof entry.snippet === 'string' && entry.snippet ? entry.snippet : entry.content,
      tags: Array.isArray(entry.tags) ? entry.tags.filter((t): t is string => typeof t === 'string') : [],
      createTime: typeof entry.createTime === 'string' ? entry.createTime : '',
      pinned: entry.pinned === true,
    });
  }
  return memos;
};

/** Every tag present in the fetched set, once each, sorted. Drives the chips. */
export const tagsOf = (memos: MemoItem[]): string[] =>
  [...new Set(memos.flatMap((memo) => memo.tags))].sort();

export const filterByTag = (memos: MemoItem[], tag: string | null): MemoItem[] =>
  tag ? memos.filter((memo) => memo.tags.includes(tag)) : memos;
