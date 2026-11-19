/**
 * The Memos REST API this adapter is written against.
 *
 * One version rather than a tolerated range: Memos has moved this surface
 * repeatedly — `rowStatus` became `state`, the CEL filter syntax was reworked,
 * and in 0.30 `workspace_service` was renamed to `instance_service` outright.
 * A dual-shape parser would be guesswork against versions nobody runs.
 *
 * The one later move this does follow is 26.10's, because it changed where the
 * routes live (`/api/v1/...` became `/api/...`) and not what they answer: the
 * client looks the prefix up per server rather than parsing anything twice.
 */
export const MIN_MEMOS_VERSION = '0.30.0';

const MIN_PARTS = [0, 30, 0] as const;

export interface MemoItem {
  /** Resource name, `memos/{uid}` — what update addresses. */
  name: string;
  /**
   * The author's resource name, `users/{id}` — the same format as the `name`
   * `auth/me` returns, which is what makes the two comparable. Empty when the
   * server did not send one, so it matches no user.
   */
  creator: string;
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
 *
 * Typed `unknown`, not `string`: callers read this out of `chrome.storage.sync`,
 * which is untyped at the boundary, so a hand-edited or corrupt stored value is
 * not guaranteed to be a string. Guarding here rather than at each call site
 * protects every present and future caller the way `clampDim` and
 * `sanitizeHiddenWidgets` already guard their own inputs.
 */
export const normalizeBaseUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
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
 * The tag the widget opens on, as `Memo.tags` spells it: trimmed, and without
 * the one leading `#` a user naturally types.
 *
 * Typed `unknown` for the reason `normalizeBaseUrl` is: this is read out of
 * `chrome.storage.sync` and out of backup files, and a non-string reaching
 * `composeContent` throws inside `submit` after the composer has been
 * disabled, which leaves it disabled.
 */
export const sanitizeMemosTag = (value: unknown): string =>
  typeof value === 'string' ? value.trim().replace(/^#/, '') : '';

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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The memo body to send, with the active filter's tag appended.
 *
 * Without this, a memo written while filtered to `#todo` would vanish from the
 * view the moment it was submitted.
 */
export const composeContent = (text: string, tag: string | null): string => {
  const body = text.trim();
  if (!tag || !body) return body;

  // Whole word, case-insensitive, with the same boundary `stripTags` uses:
  // `#todolist` must not count as `#todo`, and `\w` would not cover an
  // accented letter, so `#teend` would be found inside `#teendő`.
  if (new RegExp(`#${escapeRegExp(tag)}(?![\\p{L}\\p{N}_/-])`, 'iu').test(body)) return body;

  return `${body} #${tag}`;
};

/**
 * A memo's text with its tags taken out, for display next to tag chips.
 *
 * Only the tags the server listed are removed — `Memo.tags` is parsed out of
 * the content by Memos itself, so a `#` inside a link, in code, or anywhere
 * else Memos did not read as a tag is left alone rather than guessed at.
 *
 * A tag ends where a letter, digit, `_`, `/` or `-` would continue it. `\w` is
 * not enough for that: it does not cover accented letters, so `#teend` would
 * match at the start of `#teendő`. Case-insensitive, because Memos keeps only
 * the first spelling of a tag it meets and the text may hold another.
 */
export const stripTags = (text: string, tags: string[]): string => {
  const longestFirst = tags.filter(Boolean).sort((a, b) => b.length - a.length);

  let result = text;
  for (const tag of longestFirst) {
    result = result.replace(new RegExp(`#${escapeRegExp(tag)}(?![\\p{L}\\p{N}_/-])`, 'giu'), '');
  }
  return result.replace(/\s+/g, ' ').trim();
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
      creator: typeof entry.creator === 'string' ? entry.creator : '',
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

/**
 * A row's tags worth showing beside it.
 *
 * The tag the list is filtered to is left out: every row carries it, so a chip
 * for it on each one repeats what the filter already says.
 */
export const tagsExcept = (tags: string[], exclude: string | null): string[] =>
  exclude ? tags.filter((tag) => tag !== exclude) : tags;

/**
 * A short name for a memo, for the controls that act on it: its text without
 * the tags, or the tags alone when there is nothing else.
 */
export const memoLabel = (memo: MemoItem): string =>
  stripTags(memo.snippet, memo.tags) || memo.tags.map((tag) => `#${tag}`).join(' ');

/**
 * A memo just archived, still offered for undo in the slot it left.
 *
 * `index` is a position in the rendered list — live memos and these rows
 * together — not in the live list alone. Kept in that space, positions stay
 * right whichever order rows are archived in: archiving the second row and
 * then the first records 1 and then 0, and inserting by ascending index puts
 * both back where they were.
 */
export interface ArchivedRow {
  memo: MemoItem;
  index: number;
  /** True while the Undo request is in flight. */
  restoring: boolean;
}

export type MemoRow = { kind: 'memo'; memo: MemoItem } | { kind: 'archived'; row: ArchivedRow };

/** The list as rendered: the live memos, with each archived row back in its own slot. */
export const withArchivedRows = (memos: MemoItem[], archived: ArchivedRow[]): MemoRow[] => {
  const rows: MemoRow[] = memos.map((memo) => ({ kind: 'memo', memo }));
  for (const row of [...archived].sort((a, b) => a.index - b.index)) {
    rows.splice(Math.min(row.index, rows.length), 0, { kind: 'archived', row });
  }
  return rows;
};

/** The rendered slot `name` occupies, live or archived, or -1. */
export const rowIndexOf = (memos: MemoItem[], archived: ArchivedRow[], name: string): number =>
  withArchivedRows(memos, archived).findIndex((row) =>
    row.kind === 'memo' ? row.memo.name === name : row.row.memo.name === name,
  );

/**
 * Drops an archived row whose slot is to close — its undo ran out, or failed.
 * The rows below it move up one, as the rendered list does.
 */
export const withoutArchivedRow = (archived: ArchivedRow[], name: string): ArchivedRow[] => {
  const gone = archived.find((row) => row.memo.name === name);
  if (!gone) return archived;
  return archived
    .filter((row) => row !== gone)
    .map((row) => (row.index > gone.index ? { ...row, index: row.index - 1 } : row));
};

/**
 * Turns an archived row back into a live memo in the same slot: the live list
 * it belongs in, and the archived rows left. Their indices stand, since the
 * slot stays filled.
 */
export const restoreArchivedRow = (
  memos: MemoItem[],
  archived: ArchivedRow[],
  name: string,
): { memos: MemoItem[]; archived: ArchivedRow[] } => {
  const next: MemoItem[] = [];
  for (const row of withArchivedRows(memos, archived)) {
    if (row.kind === 'memo') next.push(row.memo);
    else if (row.row.memo.name === name) next.push(row.row.memo);
  }
  return { memos: next, archived: archived.filter((row) => row.memo.name !== name) };
};
