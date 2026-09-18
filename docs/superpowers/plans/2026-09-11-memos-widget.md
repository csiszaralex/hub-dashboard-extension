# Memos Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a self-hosted Memos instance on the new tab page — three compact rows that expand into a full panel, where a memo can be composed and an existing one marked done by archiving it.

**Architecture:** The extension talks to the user's Memos server **directly**, never through `apps/api`. Pure logic (`utils/memos.ts`) is separated from I/O (`utils/memosClient.ts`) and from persistence (`utils/memosStorage.ts`); `hooks/useMemos.ts` renders from a `chrome.storage.local` cache first and refreshes behind it. Host access is an **optional** permission requested at runtime for exactly one origin. The service worker is not touched.

**Tech Stack:** React 19, Vite 7 + CRXJS, Manifest V3, Tailwind CSS 4, TypeScript, Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-09-10-memos-widget-design.md`

**Issue:** #22 · **Kaneo:** HUB-10 · **Branch:** `HUB-10-memos-widget`

## Global Constraints

- **Never add a `Co-Authored-By:` trailer or any AI attribution to a commit message.**
- **No issue references in commit messages either** — no `Refs #22`, no `Closes #22`. Kaneo links the work through the branch name (`HUB-10-…`), so a reference in the message is noise that duplicates it.
- Conventional Commits, enforced by commitlint. Scopes: `api | extension | shared | repo | release | ci`. Everything here is `extension` except the last task.
- **Memos v0.30.0 is the floor.** REST field names are lowerCamelCase; a memo's `name` is its resource name, `memos/{uid}`.
- No JSX string literals — `eslint-plugin-i18next` fails the build. Every user-visible string goes in **both** `src/i18n/locales/en.json` and `hu.json`; `src/i18n/validate.ts` fails typecheck if their key structures diverge.
- Settings flow through `useSettings`. Do not add a per-component `chrome.storage` read.
- **The access token must never become a `HubSettings` field.** `settingsBackup.RULES` is a mapped type over `keyof HubSettings` and `buildBackup` serialises the whole object to a user-shareable file.
- HTTPS only. `normalizeBaseUrl` rejects `http://` — the new tab page is a secure context and a plain-HTTP instance would be mixed-content blocked.
- Test doubles must model what the real API **enforces**, not just its happy path. This project has shipped two real-browser bugs past a green suite because a stub was permissive.
- LF line endings. Verify every file you touch.
- Run `pnpm nx run-many -t typecheck lint test` from the repo root before finishing each task. The pre-commit hook runs it anyway.

---

### Task 1: Pure Memos helpers

The whole adapter's vocabulary, with no `fetch` and no `chrome` — so it can be tested directly.

**Files:**
- Create: `apps/extension/src/utils/memos.ts`
- Test: `apps/extension/src/utils/memos.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MemoItem`, `MIN_MEMOS_VERSION`, `normalizeBaseUrl(input: string): string | null`, `originPattern(baseUrl: string): string`, `isSupportedVersion(version: unknown): boolean`, `composeContent(text: string, tag: string | null): string`, `parseMemoList(payload: unknown): MemoItem[] | null`, `tagsOf(memos: MemoItem[]): string[]`, `filterByTag(memos: MemoItem[], tag: string | null): MemoItem[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/extension/src/utils/memos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  composeContent,
  filterByTag,
  isSupportedVersion,
  normalizeBaseUrl,
  originPattern,
  parseMemoList,
  tagsOf,
} from './memos';

describe('normalizeBaseUrl', () => {
  it('keeps an https origin and drops a trailing slash', () => {
    expect(normalizeBaseUrl('https://memo.example.com/')).toBe('https://memo.example.com');
  });

  it('keeps a subpath, because Memos can be hosted under one', () => {
    expect(normalizeBaseUrl('https://example.com/memos/')).toBe('https://example.com/memos');
  });

  it('drops query and hash, which are never part of an API base', () => {
    expect(normalizeBaseUrl('https://memo.example.com/?a=1#b')).toBe('https://memo.example.com');
  });

  // The new tab page is a secure context; an http:// instance is mixed-content
  // blocked, so accepting one here would only move the failure somewhere less
  // explainable.
  it('rejects http', () => {
    expect(normalizeBaseUrl('http://memo.example.com')).toBeNull();
  });

  it('rejects junk', () => {
    expect(normalizeBaseUrl('not a url')).toBeNull();
    expect(normalizeBaseUrl('')).toBeNull();
  });
});

describe('originPattern', () => {
  it('builds a match pattern Chrome accepts', () => {
    expect(originPattern('https://memo.example.com')).toBe('https://memo.example.com/*');
  });

  // A subpath instance still needs the whole origin: Chrome grants host access
  // per origin, and the API lives at /api/v1 regardless of where the UI sits.
  it('widens a subpath to its origin', () => {
    expect(originPattern('https://example.com/memos')).toBe('https://example.com/*');
  });
});

describe('isSupportedVersion', () => {
  it('accepts the floor and anything above it', () => {
    expect(isSupportedVersion('0.30.0')).toBe(true);
    expect(isSupportedVersion('0.30.1')).toBe(true);
    expect(isSupportedVersion('0.31.0')).toBe(true);
    expect(isSupportedVersion('1.0.0')).toBe(true);
  });

  it('refuses anything below it', () => {
    expect(isSupportedVersion('0.29.9')).toBe(false);
    expect(isSupportedVersion('0.9.0')).toBe(false);
  });

  // Refused rather than coerced: `Number('')` is 0, and a version that parses
  // to zeroes would read as "very old" for one input and "fine" for another.
  it('refuses a malformed version instead of coercing it', () => {
    expect(isSupportedVersion('')).toBe(false);
    expect(isSupportedVersion('v-next')).toBe(false);
    expect(isSupportedVersion(undefined)).toBe(false);
    expect(isSupportedVersion(30)).toBe(false);
  });
});

describe('composeContent', () => {
  it('appends the active tag', () => {
    expect(composeContent('call the bank', 'todo')).toBe('call the bank #todo');
  });

  it('does not duplicate a tag the user already typed', () => {
    expect(composeContent('call the bank #todo', 'todo')).toBe('call the bank #todo');
  });

  it('matches the existing tag case-insensitively and on a whole word', () => {
    expect(composeContent('read #TODO', 'todo')).toBe('read #TODO');
    // `#todolist` is a different tag; the memo still needs `#todo`.
    expect(composeContent('read #todolist', 'todo')).toBe('read #todolist #todo');
  });

  it('leaves the text alone when there is no active tag', () => {
    expect(composeContent('  a thought  ', null)).toBe('a thought');
    expect(composeContent('a thought', '')).toBe('a thought');
  });
});

describe('parseMemoList', () => {
  const payload = {
    memos: [
      {
        name: 'memos/abc',
        content: 'call the bank #todo',
        snippet: 'call the bank',
        tags: ['todo'],
        createTime: '2026-09-10T08:00:00Z',
        pinned: false,
      },
    ],
    nextPageToken: '',
  };

  it('reads the v0.30 envelope', () => {
    expect(parseMemoList(payload)).toEqual([
      {
        name: 'memos/abc',
        content: 'call the bank #todo',
        snippet: 'call the bank',
        tags: ['todo'],
        createTime: '2026-09-10T08:00:00Z',
        pinned: false,
      },
    ]);
  });

  it('fills in the optional fields a memo may omit', () => {
    const [memo] = parseMemoList({ memos: [{ name: 'memos/x', content: 'bare' }] }) ?? [];
    expect(memo).toEqual({
      name: 'memos/x',
      content: 'bare',
      snippet: 'bare',
      tags: [],
      createTime: '',
      pinned: false,
    });
  });

  // Returns null rather than throwing, so the client can map it onto its
  // `server` failure reason like any other bad response.
  it('returns null for anything that is not the expected shape', () => {
    expect(parseMemoList(null)).toBeNull();
    expect(parseMemoList({})).toBeNull();
    expect(parseMemoList([])).toBeNull();
    expect(parseMemoList({ memos: [{ content: 'no name' }] })).toBeNull();
  });
});

describe('tagsOf and filterByTag', () => {
  const memos = parseMemoList({
    memos: [
      { name: 'memos/1', content: 'a', tags: ['todo', 'work'] },
      { name: 'memos/2', content: 'b', tags: ['todo'] },
      { name: 'memos/3', content: 'c', tags: [] },
    ],
  })!;

  it('lists every tag once, sorted', () => {
    expect(tagsOf(memos)).toEqual(['todo', 'work']);
  });

  it('filters to one tag', () => {
    expect(filterByTag(memos, 'work').map((m) => m.name)).toEqual(['memos/1']);
  });

  it('returns everything when no tag is active', () => {
    expect(filterByTag(memos, null)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run extension:test -- memos.test.ts`
Expected: FAIL — `Failed to resolve import "./memos"`.

- [ ] **Step 3: Write the implementation**

Create `apps/extension/src/utils/memos.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run extension:test -- memos.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/utils/memos.ts apps/extension/src/utils/memos.test.ts
git commit -m "feat(extension): add pure Memos helpers"
```

---

### Task 2: The Memos network client

Four calls, each returning a discriminated result so the caller can tell an expired token from a server that is merely unreachable.

**Files:**
- Create: `apps/extension/src/utils/memosClient.ts`
- Test: `apps/extension/src/utils/memosClient.test.ts`

**Interfaces:**
- Consumes: `MemoItem`, `isSupportedVersion`, `parseMemoList` from `./memos`.
- Produces: `MemosCredentials { baseUrl: string; token: string }`, `MemosFailureReason = 'auth' | 'permission' | 'version' | 'network' | 'server'`, `MemosResult<T>`, `PAGE_SIZE`, `probe(c): Promise<MemosResult<string>>`, `listMemos(c): Promise<MemosResult<MemoItem[]>>`, `createMemo(c, content): Promise<MemosResult<MemoItem>>`, `archiveMemo(c, name): Promise<MemosResult<null>>`.

- [ ] **Step 1: Write the failing test**

Create `apps/extension/src/utils/memosClient.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveMemo, createMemo, listMemos, probe } from './memosClient';

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

  it('returns the version of a supported server', async () => {
    vi.stubGlobal('fetch', respondWith(200, { version: '0.30.0', commit: 'abc' }));
    await expect(probe(credentials)).resolves.toEqual({ ok: true, value: '0.30.0' });
  });

  it('sends the bearer token to the instance profile endpoint', async () => {
    const fetchMock = respondWith(200, { version: '0.30.0' });
    vi.stubGlobal('fetch', fetchMock);
    await probe(credentials);
    expect(fetchMock).toHaveBeenCalledWith('https://memo.example.com/api/v1/instance/profile', {
      headers: { Authorization: 'Bearer memos_pat_x' },
    });
  });

  it('refuses a server below the floor', async () => {
    vi.stubGlobal('fetch', respondWith(200, { version: '0.29.4' }));
    await expect(probe(credentials)).resolves.toEqual({ ok: false, reason: 'version' });
  });

  // Pre-0.30 the endpoint was /api/v1/workspace/profile, so a 404 here is not a
  // missing route — it is an old server, and must reach the user as "upgrade"
  // rather than as a generic failure.
  it('reads a 404 as an unsupported server, not a server error', async () => {
    vi.stubGlobal('fetch', respondWith(404, {}));
    await expect(probe(credentials)).resolves.toEqual({ ok: false, reason: 'version' });
  });

  it('reports a bad token as auth', async () => {
    vi.stubGlobal('fetch', respondWith(401, {}));
    await expect(probe(credentials)).resolves.toEqual({ ok: false, reason: 'auth' });
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
    expect(fetchMock.mock.calls[0][0]).toBe(
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run extension:test -- memosClient.test.ts`
Expected: FAIL — `Failed to resolve import "./memosClient"`.

- [ ] **Step 3: Write the implementation**

Create `apps/extension/src/utils/memosClient.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run extension:test -- memosClient.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/utils/memosClient.ts apps/extension/src/utils/memosClient.test.ts
git commit -m "feat(extension): add the Memos API client"
```

---

### Task 3: Optional host permission, manifest and stub

The permission is requested at runtime for one origin. The stub has to enforce what Chrome enforces, or the interesting branch never runs in a test.

**Files:**
- Modify: `apps/extension/manifest.json`
- Create: `apps/extension/src/utils/memosPermissions.ts`
- Modify: `apps/extension/src/test/chromeStub.ts`
- Test: `apps/extension/src/utils/memosPermissions.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `hasOriginPermission(pattern: string): Promise<boolean>`, `requestOriginPermission(pattern: string): Promise<boolean>`. Stub control surface gains `grantOrigins(patterns: string[]): void`, `denyPermissionRequests(): void` and `readSync(key: string): unknown`.

- [ ] **Step 1: Declare the optional permission**

In `apps/extension/manifest.json`, add a sibling of `host_permissions` (leave `host_permissions` itself untouched):

```json
  "optional_host_permissions": ["https://*/*"],
```

This is only the permitted set — the popup requests exactly one origin out of it at runtime, so a user who never configures the widget grants nothing.

- [ ] **Step 2: Write the failing test**

Create `apps/extension/src/utils/memosPermissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import { hasOriginPermission, requestOriginPermission } from './memosPermissions';

describe('memosPermissions', () => {
  it('reports an origin that was never granted as absent', async () => {
    installChromeStub();
    await expect(hasOriginPermission('https://memo.example.com/*')).resolves.toBe(false);
  });

  it('reports a granted origin as present', async () => {
    const stub = installChromeStub();
    stub.grantOrigins(['https://memo.example.com/*']);
    await expect(hasOriginPermission('https://memo.example.com/*')).resolves.toBe(true);
  });

  it('grants on request', async () => {
    installChromeStub();
    await expect(requestOriginPermission('https://memo.example.com/*')).resolves.toBe(true);
    await expect(hasOriginPermission('https://memo.example.com/*')).resolves.toBe(true);
  });

  // Chrome shows a prompt and the user can say no. A stub that always granted
  // would mean the refusal path never executes under test.
  it('resolves false when the user refuses, leaving nothing granted', async () => {
    const stub = installChromeStub();
    stub.denyPermissionRequests();
    await expect(requestOriginPermission('https://memo.example.com/*')).resolves.toBe(false);
    await expect(hasOriginPermission('https://memo.example.com/*')).resolves.toBe(false);
  });

  // Chrome rejects a pattern with no path component outright.
  it('rejects a match pattern with no path', async () => {
    installChromeStub();
    await expect(requestOriginPermission('https://memo.example.com')).rejects.toThrow(
      /Invalid value for origin/,
    );
  });

  // Chrome refuses any origin not covered by optional_host_permissions, which
  // is how a typo'd scheme or a forgotten manifest entry surfaces.
  it('rejects an origin outside optional_host_permissions', async () => {
    installChromeStub();
    await expect(requestOriginPermission('http://memo.example.com/*')).rejects.toThrow(
      /must be listed in the extension manifest/,
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm nx run extension:test -- memosPermissions.test.ts`
Expected: FAIL — `Failed to resolve import "./memosPermissions"`.

- [ ] **Step 4: Extend the Chrome stub**

In `apps/extension/src/test/chromeStub.ts`:

Add to the `ChromeStub` interface, after `setAuthToken`:

```ts
  /** Pre-grants optional host permissions, as a returning user would already have. */
  grantOrigins: (patterns: string[]) => void;
  /** Makes the next `permissions.request` resolve false, as a refused prompt does. */
  denyPermissionRequests: () => void;
  /** Current value of a sync storage key — the mirror of `readLocal`. */
  readSync: (key: string) => unknown;
```

Add next to the other module-level state inside `installChromeStub`, beside `let authToken`:

```ts
  const grantedOrigins = new Set<string>();
  let grantPermissionRequests = true;
```

Add this constant next to `LOCAL_QUOTA_BYTES` at module scope:

```ts
/**
 * Mirrors `optional_host_permissions` in `manifest.json`. Chrome refuses to
 * request anything outside it, so the stub must too — otherwise a forgotten
 * manifest entry passes here and fails in every real browser.
 */
const OPTIONAL_HOST_PATTERNS = [/^https:\/\/[^/]+\/\*$/];
```

Add this branch to the `chromeStub` object, after `notifications`:

```ts
    permissions: {
      contains: (options: { origins?: string[] }, cb: (result: boolean) => void) => {
        const wanted = options.origins ?? [];
        const held = wanted.every((origin) => grantedOrigins.has(origin));
        queueMicrotask(() => cb(held));
      },
      /**
       * Chrome validates the pattern before it ever prompts, and rejects an
       * origin that `optional_host_permissions` does not cover. Both throw
       * synchronously — modelling only the prompt would let a bad pattern or a
       * missing manifest entry pass a green test and fail on install.
       *
       * The real API also requires a user gesture. That has no meaning in
       * happy-dom, so it is not modelled; what is modelled is the part a test
       * can get wrong — that the answer may be `false`.
       */
      request: (options: { origins?: string[] }, cb: (granted: boolean) => void) => {
        for (const origin of options.origins ?? []) {
          if (!/^[a-z-]+:\/\/[^/]+\/./.test(origin)) {
            throw new TypeError(
              `Error in invocation of permissions.request(object permissions, optional function callback): Invalid value for origin pattern: ${origin}`,
            );
          }
          if (!OPTIONAL_HOST_PATTERNS.some((pattern) => pattern.test(origin))) {
            throw new Error(
              'Error: Optional permissions must be listed in the extension manifest.',
            );
          }
        }

        if (grantPermissionRequests) {
          for (const origin of options.origins ?? []) grantedOrigins.add(origin);
        }
        queueMicrotask(() => cb(grantPermissionRequests));
      },
    },
```

Add to the returned control object, after `setAuthToken`:

```ts
    grantOrigins: (patterns) => {
      for (const pattern of patterns) grantedOrigins.add(pattern);
    },
    denyPermissionRequests: () => {
      grantPermissionRequests = false;
    },
    readSync: (key) => store.get(key),
```

- [ ] **Step 5: Write the permission wrapper**

Create `apps/extension/src/utils/memosPermissions.ts`:

```ts
/**
 * `chrome.permissions`, promisified.
 *
 * The host is the user's own server, so it cannot be a build-time
 * `host_permissions` entry. `optional_host_permissions` declares the permitted
 * set and exactly one origin out of it is requested at runtime — a user who
 * never configures the widget grants nothing.
 */
declare const chrome: {
  permissions: {
    contains: (options: { origins: string[] }, cb: (result: boolean) => void) => void;
    request: (options: { origins: string[] }, cb: (granted: boolean) => void) => void;
  };
};

export const hasOriginPermission = (pattern: string): Promise<boolean> =>
  new Promise((resolve) => chrome.permissions.contains({ origins: [pattern] }, resolve));

/**
 * Must be called straight out of a click handler: Chrome requires a user
 * gesture, and the gesture does not survive an `await`. That is why the popup
 * has its own Connect button rather than hanging this off the shared Save.
 */
export const requestOriginPermission = (pattern: string): Promise<boolean> =>
  new Promise((resolve) => chrome.permissions.request({ origins: [pattern] }, resolve));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm nx run extension:test -- memosPermissions.test.ts`
Expected: PASS, 6 tests.

Then run the whole suite, because the stub changed under every test that uses it:

Run: `pnpm nx run extension:test`
Expected: PASS, all files.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/manifest.json apps/extension/src/utils/memosPermissions.ts apps/extension/src/utils/memosPermissions.test.ts apps/extension/src/test/chromeStub.ts
git commit -m "feat(extension): request Memos host access at runtime"
```

---

### Task 4: Local storage for token, cache and draft

Everything that must not sync, in one module.

**Files:**
- Create: `apps/extension/src/utils/memosStorage.ts`
- Test: `apps/extension/src/utils/memosStorage.test.ts`

**Interfaces:**
- Consumes: `MemoItem`, `parseMemoList` from `./memos`.
- Produces: `getToken(): Promise<string>`, `setToken(token: string): Promise<void>`, `getCachedMemos(): Promise<MemoItem[]>`, `setCachedMemos(memos: MemoItem[]): Promise<void>`, `getDraft(): Promise<string>`, `setDraft(text: string): Promise<void>`, `clearDraft(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `apps/extension/src/utils/memosStorage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import {
  clearDraft,
  getCachedMemos,
  getDraft,
  getToken,
  setCachedMemos,
  setDraft,
  setToken,
} from './memosStorage';

const memo = {
  name: 'memos/1',
  content: 'a #todo',
  snippet: 'a',
  tags: ['todo'],
  createTime: '2026-09-10T08:00:00Z',
  pinned: false,
};

describe('token', () => {
  it('is empty until one is stored', async () => {
    installChromeStub();
    await expect(getToken()).resolves.toBe('');
  });

  it('round-trips', async () => {
    installChromeStub();
    await setToken('memos_pat_x');
    await expect(getToken()).resolves.toBe('memos_pat_x');
  });

  // The token deliberately lives outside HubSettings, so it must land in the
  // local area — sync would carry it to every machine and into the settings
  // export file.
  it('is written to the local area, not sync', async () => {
    const stub = installChromeStub();
    await setToken('memos_pat_x');
    expect(stub.readLocal('memos_token')).toBe('memos_pat_x');
    expect(stub.syncGetCount()).toBe(0);
  });
});

describe('cached memos', () => {
  it('is empty until something is cached', async () => {
    installChromeStub();
    await expect(getCachedMemos()).resolves.toEqual([]);
  });

  it('round-trips', async () => {
    installChromeStub();
    await setCachedMemos([memo]);
    await expect(getCachedMemos()).resolves.toEqual([memo]);
  });

  // A cache written by an older build, or corrupted by hand, must not reach the
  // renderer — an empty list is always safe, because a refresh is already on
  // its way.
  it('discards a cache that is not a memo list', async () => {
    const stub = installChromeStub();
    stub.seedLocal({ memos_cache: { memos: [{ noName: true }] } });
    await expect(getCachedMemos()).resolves.toEqual([]);
  });
});

describe('draft', () => {
  it('round-trips and clears', async () => {
    installChromeStub();
    await setDraft('half a thought');
    await expect(getDraft()).resolves.toBe('half a thought');
    await clearDraft();
    await expect(getDraft()).resolves.toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run extension:test -- memosStorage.test.ts`
Expected: FAIL — `Failed to resolve import "./memosStorage"`.

- [ ] **Step 3: Write the implementation**

Create `apps/extension/src/utils/memosStorage.ts`:

```ts
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
 * The cache and the draft are local for a plainer reason: neither is a
 * preference, and `chrome.storage.sync` has a byte quota to protect.
 */
const TOKEN_KEY = 'memos_token';
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run extension:test -- memosStorage.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/utils/memosStorage.ts apps/extension/src/utils/memosStorage.test.ts
git commit -m "feat(extension): store the Memos token, cache and draft locally"
```

---

### Task 5: Settings fields

`memosUrl` and `memosTag` join `HubSettings`. The token does not.

**Files:**
- Modify: `apps/extension/src/hooks/useSettings.ts`
- Modify: `apps/extension/src/utils/settingsBackup.ts`
- Test: `apps/extension/src/utils/settingsBackup.test.ts`

**Interfaces:**
- Consumes: `normalizeBaseUrl` from `./memos`.
- Produces: `HubSettings.memosUrl: string` (normalised HTTPS base, `''` when unset) and `HubSettings.memosTag: string` (bare tag, no `#`, `''` means unfiltered).

- [ ] **Step 1: Write the failing test**

Append to `apps/extension/src/utils/settingsBackup.test.ts`:

```ts
describe('memos settings', () => {
  it('restores a valid https base url', () => {
    const file = JSON.stringify({
      version: 1,
      settings: { memosUrl: 'https://memo.example.com/', memosTag: 'todo' },
    });
    expect(parseBackup(file)).toEqual({ memosUrl: 'https://memo.example.com', memosTag: 'todo' });
  });

  // Dropped rather than reset: the file is the untrustworthy party, not the
  // configuration the user already has.
  it('drops a non-https base url', () => {
    const file = JSON.stringify({ version: 1, settings: { memosUrl: 'http://memo.example.com' } });
    expect(parseBackup(file)).toEqual({});
  });

  // The token lives outside HubSettings precisely so it cannot be written to a
  // backup file. A file that carries one anyway must not put it back.
  it('ignores a token smuggled into a backup file', () => {
    const file = JSON.stringify({
      version: 1,
      settings: { memosUrl: 'https://memo.example.com', memosToken: 'memos_pat_leaked' },
    });
    expect(parseBackup(file)).toEqual({ memosUrl: 'https://memo.example.com' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run extension:test -- settingsBackup.test.ts`
Expected: FAIL — the three new tests return `{}` or leave the keys out, because `RULES` has no entry for them.

- [ ] **Step 3: Add the fields to the settings store**

In `apps/extension/src/hooks/useSettings.ts`:

Add the import:

```ts
import { normalizeBaseUrl } from '../utils/memos';
```

Add to the `HubSettings` interface, after `customQuotes`:

```ts
  /** The user's own Memos instance, normalised. Empty until they connect one. */
  memosUrl: string;
  /** Tag the widget opens on, without the `#`. Empty means unfiltered. */
  memosTag: string;
```

Add to `DEFAULT_SETTINGS`, after `customQuotes: []`:

```ts
  memosUrl: '',
  memosTag: '',
```

Add this line to **both** `merge` and `applyChanges`, next to the other sanitisers:

```ts
  next.memosUrl = normalizeBaseUrl(next.memosUrl) ?? '';
```

- [ ] **Step 4: Add the backup rules**

In `apps/extension/src/utils/settingsBackup.ts`, add the import:

```ts
import { normalizeBaseUrl } from './memos';
```

Add to `RULES`, after `customQuotes`:

```ts
  // Validated as an https base, not merely as a string: this is the one setting
  // that decides where the extension sends the user's notes.
  memosUrl: (value) => (typeof value === 'string' ? (normalizeBaseUrl(value) ?? undefined) : undefined),

  // The tag is free text, but only ever a bare tag — a leading `#` would be
  // matched against `Memo.tags`, which never carries one.
  memosTag: (value) => (typeof value === 'string' ? value.trim().replace(/^#/, '') : undefined),
```

There is deliberately **no** rule for a token: it is not a `HubSettings` field, so `RULE_KEYS` never looks at one and a token in a backup file is dropped on the floor.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm nx run extension:test -- settingsBackup.test.ts`
Expected: PASS.

Then run the suite, since `HubSettings` gained two required fields that test fixtures may construct:

Run: `pnpm nx run extension:typecheck && pnpm nx run extension:test`
Expected: PASS. If a test fixture fails to typecheck, add `memosUrl: ''` and `memosTag: ''` to it.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/hooks/useSettings.ts apps/extension/src/utils/settingsBackup.ts apps/extension/src/utils/settingsBackup.test.ts
git commit -m "feat(extension): add the Memos server settings"
```

---

### Task 6: The `useMemos` hook

Cache first, network behind it, and the two actions.

**Files:**
- Create: `apps/extension/src/hooks/useMemos.ts`
- Test: `apps/extension/src/hooks/useMemos.test.tsx`

**Interfaces:**
- Consumes: `useSettings` (`memosUrl`, `memosTag`), `filterByTag`, `originPattern`, `tagsOf`, `type MemoItem` from `../utils/memos`, `archiveMemo`, `createMemo`, `listMemos`, `type MemosFailureReason` from `../utils/memosClient`, `hasOriginPermission` from `../utils/memosPermissions`, and all of `../utils/memosStorage`.
- Produces: `useMemos()` returning `{ status, failure, memos, tags, activeTag, setActiveTag, draft, setDraft, submit, submitting, archive }` as typed below.

- [ ] **Step 1: Write the failing test**

Create `apps/extension/src/hooks/useMemos.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';

const listPayload = {
  memos: [
    { name: 'memos/1', content: 'call the bank #todo', tags: ['todo'] },
    { name: 'memos/2', content: 'read the paper #read', tags: ['read'] },
  ],
};

const seedConfigured = () => {
  const stub = installChromeStub();
  stub.seedSync({ memosUrl: 'https://memo.example.com', memosTag: 'todo' });
  stub.seedLocal({ memos_token: 'memos_pat_x' });
  stub.grantOrigins(['https://memo.example.com/*']);
  return stub;
};

const respondWith = (status: number, body: unknown) =>
  vi.fn(() =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }),
  );

describe('useMemos', () => {
  it('is unconfigured when no server is set', async () => {
    installChromeStub();
    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('unconfigured'));
  });

  // A configured server whose permission was revoked in chrome://extensions is
  // not a network failure — nothing should be fetched at all.
  it('is unconfigured when the host permission was revoked', async () => {
    const stub = installChromeStub();
    stub.seedSync({ memosUrl: 'https://memo.example.com' });
    stub.seedLocal({ memos_token: 'memos_pat_x' });
    const fetchMock = respondWith(200, listPayload);
    vi.stubGlobal('fetch', fetchMock);

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.status).toBe('unconfigured'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('filters to the configured base tag', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']);
    expect(result.current.tags).toEqual(['read', 'todo']);
  });

  it('re-filters when a chip is picked', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.setActiveTag(null));
    expect(result.current.memos).toHaveLength(2);
  });

  // The whole point of the cache: the page renders what it had, and the failure
  // stays quiet rather than blanking the widget.
  it('renders the cache and reports the failure when the server is unreachable', async () => {
    const stub = seedConfigured();
    stub.seedLocal({ memos_cache: listPayload });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());

    await waitFor(() => expect(result.current.failure).toBe('network'));
    expect(result.current.status).toBe('ready');
    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']);
  });

  it('archives optimistically and keeps it gone on success', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    vi.stubGlobal('fetch', respondWith(200, {}));
    await act(async () => {
      await result.current.archive('memos/1');
    });

    expect(result.current.memos).toHaveLength(0);
  });

  // Safe to be optimistic only because it can be put back.
  it('restores the row when archiving fails', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    vi.stubGlobal('fetch', respondWith(500, {}));
    await act(async () => {
      await result.current.archive('memos/1');
    });

    expect(result.current.memos.map((m) => m.name)).toEqual(['memos/1']);
    expect(result.current.failure).toBe('server');
  });

  it('appends the active tag on submit and clears the draft', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const created = respondWith(200, { name: 'memos/3', content: 'new one #todo', tags: ['todo'] });
    vi.stubGlobal('fetch', created);

    act(() => result.current.setDraft('new one'));
    await act(async () => {
      await result.current.submit();
    });

    expect(JSON.parse(created.mock.calls[0][1].body).content).toBe('new one #todo');
    expect(result.current.draft).toBe('');
    expect(result.current.memos.map((m) => m.name)).toContain('memos/3');
  });

  // The one real data-loss path: text typed, send failed, tab closed.
  it('keeps the draft in local storage when the submit fails', async () => {
    const stub = seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, listPayload));

    const { useMemos } = await import('./useMemos');
    const { result } = renderHook(() => useMemos());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    vi.stubGlobal('fetch', respondWith(500, {}));
    act(() => result.current.setDraft('do not lose me'));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.draft).toBe('do not lose me');
    await waitFor(() => expect(stub.readLocal('memos_draft')).toBe('do not lose me'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run extension:test -- useMemos.test.tsx`
Expected: FAIL — `Failed to resolve import "./useMemos"`.

- [ ] **Step 3: Write the implementation**

Create `apps/extension/src/hooks/useMemos.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { composeContent, filterByTag, type MemoItem, originPattern, tagsOf } from '../utils/memos';
import {
  archiveMemo,
  createMemo,
  listMemos,
  type MemosCredentials,
  type MemosFailureReason,
} from '../utils/memosClient';
import { hasOriginPermission } from '../utils/memosPermissions';
import {
  clearDraft,
  getCachedMemos,
  getDraft,
  getToken,
  setCachedMemos,
  setDraft as persistDraft,
} from '../utils/memosStorage';
import { useSettings } from './useSettings';

export type MemosStatus = 'loading' | 'unconfigured' | 'ready';

/**
 * The Memos widget's data.
 *
 * **Call this once per page.** Like `useQuote` it is not a shared store: each
 * caller keeps its own list, its own active tag and its own draft, so two
 * instances would fetch twice and then disagree the moment either one archived
 * something. `MemosWidget` owns it and passes the result into the panel.
 *
 * Cache first, network behind it. The new tab page must render before the
 * user's own server answers — and on most days, when that server is not
 * reachable at all, the cache is the only thing it will ever have.
 */
export const useMemos = () => {
  const { settings, isLoaded } = useSettings();
  const { memosUrl, memosTag } = settings;

  const [all, setAll] = useState<MemoItem[]>([]);
  const [status, setStatus] = useState<MemosStatus>('loading');
  const [failure, setFailure] = useState<MemosFailureReason | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [draft, setDraftState] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Read inside the callbacks rather than captured into them: the token lives
  // outside the settings store, so it is not on any render's props.
  const credentials = useRef<MemosCredentials | null>(null);

  // A new tab opens on the configured tag, whatever chip the last one ended on.
  useEffect(() => {
    setActiveTag(memosTag || null);
  }, [memosTag]);

  useEffect(() => {
    if (!isLoaded) return;

    let cancelled = false;

    const load = async () => {
      if (!memosUrl) {
        if (!cancelled) setStatus('unconfigured');
        return;
      }

      // Show whatever the last visit stored before anything is asked of the
      // network. One tick, not a round trip.
      const [cached, savedDraft] = await Promise.all([getCachedMemos(), getDraft()]);
      if (cancelled) return;
      if (cached.length > 0) {
        setAll(cached);
        setStatus('ready');
      }
      if (savedDraft) setDraftState(savedDraft);

      // A revoked permission or a token that never made it to this machine is
      // not a network failure — there is nothing to fetch and nothing to
      // apologise for. Send the user to the popup instead.
      const [granted, token] = await Promise.all([
        hasOriginPermission(originPattern(memosUrl)),
        getToken(),
      ]);
      if (cancelled) return;
      if (!granted || !token) {
        setStatus('unconfigured');
        return;
      }

      credentials.current = { baseUrl: memosUrl, token };
      const result = await listMemos(credentials.current);
      if (cancelled) return;

      if (!result.ok) {
        setFailure(result.reason);
        // Stay on the cache if there is one; otherwise there is simply nothing
        // to show, which the widget renders as its empty state.
        setStatus('ready');
        return;
      }

      setFailure(null);
      setAll(result.value);
      setStatus('ready');
      void setCachedMemos(result.value);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, memosUrl]);

  const setDraft = useCallback((text: string) => {
    setDraftState(text);
  }, []);

  /**
   * Archives optimistically: the row goes at once and comes back if the server
   * refuses. Safe precisely because archiving is reversible — the worst case
   * here is a row that reappears, not a note that is gone.
   */
  const archive = useCallback(async (name: string) => {
    if (!credentials.current) return;

    const previous = all;
    const next = all.filter((memo) => memo.name !== name);
    setAll(next);

    const result = await archiveMemo(credentials.current, name);
    if (result.ok) {
      setFailure(null);
      void setCachedMemos(next);
      return;
    }

    setAll(previous);
    setFailure(result.reason);
  }, [all]);

  /**
   * Not optimistic: the id and timestamps come from the server, and a phantom
   * row that duplicates half a second later is worse than a brief wait. A
   * failed send keeps its text on screen *and* in local storage, so closing the
   * tab does not throw it away.
   */
  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || !credentials.current || submitting) return;

    setSubmitting(true);
    const result = await createMemo(credentials.current, composeContent(text, activeTag));
    setSubmitting(false);

    if (!result.ok) {
      setFailure(result.reason);
      void persistDraft(draft);
      return;
    }

    setFailure(null);
    setDraftState('');
    void clearDraft();
    setAll((current) => {
      const next = [result.value, ...current];
      void setCachedMemos(next);
      return next;
    });
  }, [activeTag, draft, submitting]);

  return {
    status,
    /** Why the last call failed, or null when it did not. */
    failure,
    /** Already narrowed to `activeTag`. */
    memos: filterByTag(all, activeTag),
    /** Every tag in the fetched set — the chips. */
    tags: tagsOf(all),
    activeTag,
    setActiveTag,
    draft,
    setDraft,
    submit,
    submitting,
    archive,
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run extension:test -- useMemos.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/hooks/useMemos.ts apps/extension/src/hooks/useMemos.test.tsx
git commit -m "feat(extension): add the useMemos hook"
```

---

### Task 7: The widget and its panel

Three compact rows in the bottom-left, expanding in place into the full panel.

**Files:**
- Create: `apps/extension/src/components/MemosWidget.tsx`
- Create: `apps/extension/src/components/MemosPanel.tsx`
- Modify: `apps/extension/src/widgets.ts`
- Modify: `apps/extension/src/App.tsx`
- Modify: `apps/extension/src/i18n/locales/en.json`
- Modify: `apps/extension/src/i18n/locales/hu.json`
- Test: `apps/extension/src/components/MemosWidget.test.tsx`

**Interfaces:**
- Consumes: `useMemos` from `../hooks/useMemos`.
- Produces: `MemosWidget` (no props), `MemosPanel` (props typed below), and the widget id `'memos'`.

- [ ] **Step 1: Add the widget id**

In `apps/extension/src/widgets.ts`, add `'memos'` to `WIDGET_IDS` after `'pomodoro'`:

```ts
  'pomodoro',
  'memos',
] as const;
```

- [ ] **Step 2: Add the translations**

In `apps/extension/src/i18n/locales/en.json`, add `"memos": "Memos"` to the existing `widgets` block, and add a new top-level block:

```json
  "memos": {
    "title": "Memos",
    "empty": "Nothing here",
    "all": "All",
    "placeholder": "New memo…",
    "submit": "Add",
    "submitting": "Adding…",
    "done": "Mark done",
    "more": "+{{count}} more",
    "collapse": "Collapse",
    "unconfigured": "Connect your Memos server in settings",
    "errorAuth": "Your Memos token is invalid or has expired",
    "errorPermission": "Reconnect your Memos server in settings",
    "errorVersion": "Upgrade the server to Memos 0.30.0 or newer",
    "errorNetwork": "Showing cached memos",
    "errorServer": "The Memos server returned an error"
  },
```

In `apps/extension/src/i18n/locales/hu.json`, add `"memos": "Memos"` to its `widgets` block, and the matching block:

```json
  "memos": {
    "title": "Memos",
    "empty": "Nincs itt semmi",
    "all": "Mind",
    "placeholder": "Új jegyzet…",
    "submit": "Hozzáad",
    "submitting": "Küldés…",
    "done": "Kész",
    "more": "+{{count}} további",
    "collapse": "Összecsuk",
    "unconfigured": "Csatlakoztasd a Memos szerveredet a beállításokban",
    "errorAuth": "A Memos tokened érvénytelen vagy lejárt",
    "errorPermission": "Csatlakozz újra a Memos szerverhez a beállításokban",
    "errorVersion": "Frissítsd a szervert Memos 0.30.0-ra vagy újabbra",
    "errorNetwork": "Tárolt jegyzetek láthatók",
    "errorServer": "A Memos szerver hibát adott vissza"
  },
```

Key order does not matter to `validate.ts`, but the key **structures** must match exactly.

- [ ] **Step 3: Write the failing test**

Create `apps/extension/src/components/MemosWidget.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';

const payload = {
  memos: [
    { name: 'memos/1', content: 'one #todo', snippet: 'one', tags: ['todo'] },
    { name: 'memos/2', content: 'two #todo', snippet: 'two', tags: ['todo'] },
    { name: 'memos/3', content: 'three #todo', snippet: 'three', tags: ['todo'] },
    { name: 'memos/4', content: 'four #todo', snippet: 'four', tags: ['todo'] },
  ],
};

const seedConfigured = () => {
  const stub = installChromeStub();
  stub.seedSync({ memosUrl: 'https://memo.example.com', memosTag: 'todo' });
  stub.seedLocal({ memos_token: 'memos_pat_x' });
  stub.grantOrigins(['https://memo.example.com/*']);
  return stub;
};

const respondWith = (status: number, body: unknown) =>
  vi.fn(() =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }),
  );

/**
 * `src/test/setup.ts` calls `vi.resetModules()` before every test, so i18n has
 * to be initialised inside the test — otherwise `t()` returns raw keys and
 * every assertion below looks for text that was never rendered. This is the
 * same `load` shape `QuoteWidget.test.tsx` uses.
 */
const load = async () => {
  await import('../i18n/i18n');
  return (await import('./MemosWidget')).MemosWidget;
};

describe('MemosWidget', () => {
  it('shows three rows and a count of the rest', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, payload));
    const MemosWidget = await load();

    render(<MemosWidget />);

    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());
    expect(screen.getByText('three')).toBeTruthy();
    expect(screen.queryByText('four')).toBeNull();
    expect(screen.getByText('+1 more')).toBeTruthy();
  });

  // The whole reason for a compact view: ticking the top item off must not
  // cost an expand first.
  it('archives straight from a compact row', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, payload));
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());

    vi.stubGlobal('fetch', respondWith(200, {}));
    fireEvent.click(screen.getAllByTitle('Mark done')[0]);

    await waitFor(() => expect(screen.queryByText('one')).toBeNull());
  });

  it('expands into the panel and shows the composer', async () => {
    seedConfigured();
    vi.stubGlobal('fetch', respondWith(200, payload));
    const MemosWidget = await load();

    render(<MemosWidget />);
    await waitFor(() => expect(screen.getByText('one')).toBeTruthy());

    fireEvent.click(screen.getByText('+1 more'));

    expect(screen.getByPlaceholderText('New memo…')).toBeTruthy();
    expect(screen.getByText('four')).toBeTruthy();
  });

  it('points the user at settings when nothing is configured', async () => {
    installChromeStub();
    const MemosWidget = await load();

    render(<MemosWidget />);

    await waitFor(() =>
      expect(screen.getByText('Connect your Memos server in settings')).toBeTruthy(),
    );
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm nx run extension:test -- MemosWidget.test.tsx`
Expected: FAIL — `Failed to resolve import "./MemosWidget"`.

- [ ] **Step 5: Write the panel**

Create `apps/extension/src/components/MemosPanel.tsx`:

```tsx
import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MemoItem } from '../utils/memos';

export function MemosPanel({
  memos,
  tags,
  activeTag,
  onTagChange,
  onArchive,
  draft,
  onDraftChange,
  onSubmit,
  submitting,
  onCollapse,
}: {
  memos: MemoItem[];
  tags: string[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
  onArchive: (name: string) => void;
  draft: string;
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  onCollapse: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className='w-80 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5'>
        <span className='text-xs font-bold text-white/70 uppercase tracking-widest'>
          {t('memos.title')}
        </span>
        <button
          onClick={onCollapse}
          className='text-white/40 hover:text-white transition-colors'
          title={t('memos.collapse')}
        >
          <X className='w-3.5 h-3.5' />
        </button>
      </div>

      {tags.length > 0 && (
        <div className='flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-white/5'>
          <button
            onClick={() => onTagChange(null)}
            className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
              activeTag === null ? 'bg-white text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
          >
            {t('memos.all')}
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => onTagChange(tag)}
              className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                activeTag === tag ? 'bg-white text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'
              }`}
            >
              {`#${tag}`}
            </button>
          ))}
        </div>
      )}

      <div className='max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent'>
        {memos.length === 0 ? (
          <p className='px-4 py-6 text-center text-xs text-white/30'>{t('memos.empty')}</p>
        ) : (
          memos.map((memo) => (
            <div
              key={memo.name}
              className='group flex items-start gap-2 px-4 py-2 hover:bg-white/5 transition-colors'
            >
              <button
                onClick={() => onArchive(memo.name)}
                title={t('memos.done')}
                className='mt-0.5 shrink-0 w-4 h-4 rounded border border-white/25 flex items-center justify-center text-transparent hover:text-black hover:bg-white hover:border-white transition-colors'
              >
                <Check className='w-3 h-3' />
              </button>
              <span className='text-sm text-white/80 leading-snug wrap-break-word min-w-0'>
                {memo.snippet}
              </span>
            </div>
          ))
        )}
      </div>

      {/*
        The composer stays disabled until the server confirms: the id and
        timestamps come from it, and a phantom row that duplicates a moment
        later is worse than a short wait.
      */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className='flex items-center gap-2 px-3 py-2.5 border-t border-white/5 bg-white/5'
      >
        {activeTag && (
          <span className='shrink-0 px-1.5 py-0.5 rounded bg-white/15 text-[10px] text-white/70'>
            {`#${activeTag}`}
          </span>
        )}
        <input
          type='text'
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={t('memos.placeholder')}
          disabled={submitting}
          className='flex-1 min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-white/25 disabled:opacity-50'
        />
        <button
          type='submit'
          disabled={submitting || !draft.trim()}
          className='shrink-0 text-[10px] font-semibold uppercase tracking-wide text-white/60 hover:text-white disabled:opacity-30 transition-colors'
        >
          {submitting ? t('memos.submitting') : t('memos.submit')}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Write the widget**

Create `apps/extension/src/components/MemosWidget.tsx`:

```tsx
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMemos } from '../hooks/useMemos';
import { MemosPanel } from './MemosPanel';

/** How many rows the compact view shows before it starts counting. */
const COMPACT_ROWS = 3;

/**
 * The Memos widget.
 *
 * Compact by default — a few borderless lines that do not compete with the
 * wallpaper — and the full panel in the same spot once expanded. Each compact
 * row carries its own archive control: ticking the top item off is the reason
 * the widget exists and must not cost an expand first.
 */
export function MemosWidget() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const {
    status,
    failure,
    memos,
    tags,
    activeTag,
    setActiveTag,
    draft,
    setDraft,
    submit,
    submitting,
    archive,
  } = useMemos();

  if (status === 'loading') return null;

  const wrapper = 'absolute bottom-20 left-8 z-20 flex flex-col items-start gap-2';

  if (status === 'unconfigured') {
    return (
      <div className={wrapper}>
        <p className='text-xs text-white/35 max-w-56'>{t('memos.unconfigured')}</p>
      </div>
    );
  }

  if (expanded) {
    return (
      <div className={wrapper}>
        <MemosPanel
          memos={memos}
          tags={tags}
          activeTag={activeTag}
          onTagChange={setActiveTag}
          onArchive={(name) => void archive(name)}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={() => void submit()}
          submitting={submitting}
          onCollapse={() => setExpanded(false)}
        />
      </div>
    );
  }

  const visible = memos.slice(0, COMPACT_ROWS);
  const hidden = memos.length - visible.length;

  return (
    // A fixed minimum height so the compact view does not grow into place: the
    // cache arrives a tick after first paint, and a widget that pushes the
    // corner around on every new tab reads as a glitch.
    <div className={`${wrapper} min-h-24 w-64`}>
      {visible.length === 0 ? (
        <p className='text-xs text-white/30'>{t('memos.empty')}</p>
      ) : (
        visible.map((memo) => (
          <div key={memo.name} className='group flex items-start gap-2 min-w-0 w-full'>
            <button
              onClick={() => void archive(memo.name)}
              title={t('memos.done')}
              className='mt-0.5 shrink-0 w-4 h-4 rounded border border-white/25 flex items-center justify-center text-transparent hover:text-black hover:bg-white hover:border-white transition-colors'
            >
              <Check className='w-3 h-3' />
            </button>
            <button
              onClick={() => setExpanded(true)}
              className='text-left text-sm text-white/70 hover:text-white transition-colors truncate min-w-0 flex-1'
            >
              {memo.snippet}
            </button>
          </div>
        ))
      )}

      <button
        onClick={() => setExpanded(true)}
        className='text-[10px] text-white/35 hover:text-white/70 transition-colors'
      >
        {hidden > 0 ? t('memos.more', { count: hidden }) : t('memos.title')}
      </button>

      {/*
        `network` is the common case — every day spent away from the server —
        so it is a faint line rather than an error. The cache is already on
        screen above it.
      */}
      {failure && (
        <p className='text-[10px] text-white/30'>
          {t(`memos.error${failure.charAt(0).toUpperCase()}${failure.slice(1)}` as const)}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Mount it**

In `apps/extension/src/App.tsx`, add the import next to the other component imports:

```ts
import { MemosWidget } from './components/MemosWidget';
```

and mount it next to `QuickNote`, after the `showWidget('note')` line:

```tsx
        {showWidget('memos') && <MemosWidget />}
```

The bottom-left corner is free: the calendar is top-left, the weather top-right, the quote bottom-centre and the quick note bottom-right. `bottom-20` clears the photo-credit row at `bottom-4`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm nx run extension:test -- MemosWidget.test.tsx`
Expected: PASS, 4 tests.

Then the full check, because `WIDGET_IDS` grew and the locale files changed:

Run: `pnpm nx run-many -t typecheck lint test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/extension/src/components/MemosWidget.tsx apps/extension/src/components/MemosPanel.tsx apps/extension/src/components/MemosWidget.test.tsx apps/extension/src/widgets.ts apps/extension/src/App.tsx apps/extension/src/i18n/locales/en.json apps/extension/src/i18n/locales/hu.json
git commit -m "feat(extension): add the Memos widget"
```

---

### Task 8: The popup's Memos tab

URL, token, default tag, and a Connect button that proves all three before saving any of them.

**Files:**
- Create: `apps/extension/src/popup/MemosSection.tsx`
- Modify: `apps/extension/src/popup/TabNav.tsx`
- Modify: `apps/extension/src/popup/PopupForm.tsx`
- Modify: `apps/extension/src/i18n/locales/en.json`
- Modify: `apps/extension/src/i18n/locales/hu.json`
- Test: `apps/extension/src/popup/MemosSection.test.tsx`

**Interfaces:**
- Consumes: `normalizeBaseUrl`, `originPattern` from `../utils/memos`; `probe` from `../utils/memosClient`; `requestOriginPermission` from `../utils/memosPermissions`; `getToken`, `setToken` from `../utils/memosStorage`; `saveSettings` from `../hooks/useSettings`; `Field`, `inputCls` from `./Field`.
- Produces: `MemosSection({ url, tag, onUrlChange, onTagChange })`, and `TabId` gains `'memos'`.

- [ ] **Step 1: Add the translations**

In `apps/extension/src/i18n/locales/en.json`, add to the `popup` block:

```json
    "tabMemos": "Memos",
    "memosUrl": "Server URL",
    "memosUrlHint": "Your own Memos instance. HTTPS only.",
    "memosToken": "Access token",
    "memosTokenHint": "Settings → Access Tokens in Memos. Stored on this device only, and never included in a settings export.",
    "memosTag": "Default tag",
    "memosTagHint": "The tag every new tab opens on. Leave empty to show the newest memos.",
    "memosConnect": "Connect",
    "memosConnecting": "Connecting…",
    "memosConnected": "Connected to Memos {{version}}",
    "memosErrorUrl": "That is not an https URL",
    "memosErrorPermission": "Chrome was not given access to that server",
    "memosErrorAuth": "The server rejected that token",
    "memosErrorVersion": "Memos 0.30.0 or newer is required",
    "memosErrorNetwork": "Could not reach that server",
    "memosErrorServer": "The server returned an error",
```

In `hu.json`, the same keys:

```json
    "tabMemos": "Memos",
    "memosUrl": "Szerver URL",
    "memosUrlHint": "A saját Memos példányod. Csak HTTPS.",
    "memosToken": "Hozzáférési token",
    "memosTokenHint": "Memos → Beállítások → Access Tokens. Csak ezen a gépen tárolódik, és sosem kerül bele a beállítás-exportba.",
    "memosTag": "Alapértelmezett címke",
    "memosTagHint": "Ezzel a címkével nyit minden új lap. Üresen hagyva a legfrissebb jegyzetek látszanak.",
    "memosConnect": "Csatlakozás",
    "memosConnecting": "Csatlakozás…",
    "memosConnected": "Csatlakozva — Memos {{version}}",
    "memosErrorUrl": "Ez nem egy https URL",
    "memosErrorPermission": "A Chrome nem kapott hozzáférést ahhoz a szerverhez",
    "memosErrorAuth": "A szerver elutasította ezt a tokent",
    "memosErrorVersion": "Memos 0.30.0 vagy újabb szükséges",
    "memosErrorNetwork": "A szerver nem érhető el",
    "memosErrorServer": "A szerver hibát adott vissza",
```

- [ ] **Step 2: Write the failing test**

Create `apps/extension/src/popup/MemosSection.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from '../test/chromeStub';

const respondWith = (status: number, body: unknown) =>
  vi.fn(() =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }),
  );

/** i18n inside the test, for the reason `MemosWidget.test.tsx` spells out. */
const renderSection = async (url = '') => {
  await import('../i18n/i18n');
  const { MemosSection } = await import('./MemosSection');
  const onUrlChange = vi.fn();
  render(<MemosSection url={url} tag='' onUrlChange={onUrlChange} onTagChange={vi.fn()} />);
  return { onUrlChange };
};

const typeToken = (value: string) =>
  fireEvent.change(screen.getByLabelText('Access token'), { target: { value } });

describe('MemosSection', () => {
  it('refuses a non-https url without asking Chrome for anything', async () => {
    installChromeStub();
    const fetchMock = respondWith(200, {});
    vi.stubGlobal('fetch', fetchMock);

    const { onUrlChange } = await renderSection('http://memo.example.com');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('That is not an https URL')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onUrlChange).not.toHaveBeenCalled();
  });

  it('saves the url only after the permission and the probe both succeed', async () => {
    const stub = installChromeStub();
    vi.stubGlobal('fetch', respondWith(200, { version: '0.30.0' }));

    const { onUrlChange } = await renderSection('https://memo.example.com');
    typeToken('memos_pat_x');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('Connected to Memos 0.30.0')).toBeTruthy());
    expect(onUrlChange).toHaveBeenCalledWith('https://memo.example.com');
    expect(stub.readLocal('memos_token')).toBe('memos_pat_x');
    // Connect persists the URL itself. Leaving it to the form's Save would let
    // someone connect, close the popup, and keep a token with no server.
    await waitFor(() => expect(stub.readSync('memosUrl')).toBe('https://memo.example.com'));
  });

  // A refused prompt must not leave a half-configured widget behind.
  it('saves nothing when the user refuses the permission prompt', async () => {
    const stub = installChromeStub();
    stub.denyPermissionRequests();
    const fetchMock = respondWith(200, { version: '0.30.0' });
    vi.stubGlobal('fetch', fetchMock);

    const { onUrlChange } = await renderSection('https://memo.example.com');
    typeToken('memos_pat_x');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() =>
      expect(screen.getByText('Chrome was not given access to that server')).toBeTruthy(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onUrlChange).not.toHaveBeenCalled();
    expect(stub.readLocal('memos_token')).toBeUndefined();
    expect(stub.readSync('memosUrl')).toBeUndefined();
  });

  it('reports an old server as a version problem and saves nothing', async () => {
    const stub = installChromeStub();
    vi.stubGlobal('fetch', respondWith(404, {}));

    const { onUrlChange } = await renderSection('https://memo.example.com');
    typeToken('memos_pat_x');
    fireEvent.click(screen.getByText('Connect'));

    await waitFor(() => expect(screen.getByText('Memos 0.30.0 or newer is required')).toBeTruthy());
    expect(onUrlChange).not.toHaveBeenCalled();
    expect(stub.readLocal('memos_token')).toBeUndefined();
    expect(stub.readSync('memosUrl')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm nx run extension:test -- MemosSection.test.tsx`
Expected: FAIL — `Failed to resolve import "./MemosSection"`.

- [ ] **Step 4: Write the section**

Create `apps/extension/src/popup/MemosSection.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { saveSettings } from '../hooks/useSettings';
import { normalizeBaseUrl, originPattern } from '../utils/memos';
import { probe } from '../utils/memosClient';
import { requestOriginPermission } from '../utils/memosPermissions';
import { getToken, setToken } from '../utils/memosStorage';
import { Field, inputCls } from './Field';

type ConnectState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; version: string }
  | { kind: 'error'; messageKey: string };

/**
 * The Memos tab.
 *
 * Connect is its own button rather than part of the form's Save for a concrete
 * reason: `chrome.permissions.request` needs a user gesture, and the gesture
 * does not survive an `await` — `PopupForm.handleSubmit` awaits before it does
 * anything, so a request routed through it would fail silently.
 *
 * Nothing is saved until the permission, the version and the token have all
 * been proved, so a wrong URL or a mistyped token surfaces here instead of as
 * an empty widget on the new tab page.
 *
 * On success both halves are persisted here — the token to local storage and
 * the URL through `saveSettings` — rather than leaving the URL to the form's
 * Save button. Splitting them would let someone press Connect, close the popup,
 * and end up with a token on disk, no URL, and a widget that silently says it
 * is not configured.
 */
export function MemosSection({
  url,
  tag,
  onUrlChange,
  onTagChange,
}: {
  url: string;
  tag: string;
  onUrlChange: (url: string) => void;
  onTagChange: (tag: string) => void;
}) {
  const { t } = useTranslation();
  const [draftUrl, setDraftUrl] = useState(url);
  const [token, setTokenInput] = useState('');
  const [state, setState] = useState<ConnectState>({ kind: 'idle' });

  // The token is not a setting, so it is not on this component's props.
  useEffect(() => {
    void getToken().then(setTokenInput);
  }, []);

  const connect = async () => {
    const base = normalizeBaseUrl(draftUrl);
    if (!base) {
      setState({ kind: 'error', messageKey: 'popup.memosErrorUrl' });
      return;
    }

    // Synchronously first, while the click's gesture is still live.
    const granted = await requestOriginPermission(originPattern(base));
    if (!granted) {
      setState({ kind: 'error', messageKey: 'popup.memosErrorPermission' });
      return;
    }

    setState({ kind: 'busy' });
    const result = await probe({ baseUrl: base, token: token.trim() });
    if (!result.ok) {
      const suffix = result.reason.charAt(0).toUpperCase() + result.reason.slice(1);
      setState({ kind: 'error', messageKey: `popup.memosError${suffix}` });
      return;
    }

    await setToken(token.trim());
    saveSettings({ memosUrl: base });
    setDraftUrl(base);
    // Keeps the form's own state coherent, so a later Save does not write back
    // the value the field held before Connect normalised it.
    onUrlChange(base);
    setState({ kind: 'ok', version: result.value });
  };

  return (
    <div className='flex flex-col gap-3'>
      <Field id='memosUrl' label={t('popup.memosUrl')} hint={t('popup.memosUrlHint')}>
        <input
          id='memosUrl'
          type='url'
          value={draftUrl}
          onChange={(e) => {
            setDraftUrl(e.target.value);
            setState({ kind: 'idle' });
          }}
          className={inputCls}
          placeholder='https://memo.example.com'
        />
      </Field>

      <Field id='memosToken' label={t('popup.memosToken')} hint={t('popup.memosTokenHint')}>
        <input
          id='memosToken'
          type='password'
          value={token}
          onChange={(e) => {
            setTokenInput(e.target.value);
            setState({ kind: 'idle' });
          }}
          className={inputCls}
          autoComplete='off'
        />
      </Field>

      <button
        type='button'
        onClick={() => void connect()}
        disabled={state.kind === 'busy'}
        className='w-full bg-white/10 hover:bg-white/20 transition-colors py-2 rounded-md text-sm font-semibold disabled:opacity-50'
      >
        {state.kind === 'busy' ? t('popup.memosConnecting') : t('popup.memosConnect')}
      </button>

      {state.kind === 'ok' && (
        <p className='text-[10px] text-emerald-300/80'>
          {t('popup.memosConnected', { version: state.version })}
        </p>
      )}
      {state.kind === 'error' && (
        <p className='text-[10px] text-red-300/80'>{t(state.messageKey)}</p>
      )}

      <Field id='memosTag' label={t('popup.memosTag')} hint={t('popup.memosTagHint')}>
        <input
          id='memosTag'
          type='text'
          value={tag}
          onChange={(e) => onTagChange(e.target.value.trim().replace(/^#/, ''))}
          className={inputCls}
          placeholder='todo'
        />
      </Field>
    </div>
  );
}
```

- [ ] **Step 5: Add the tab**

In `apps/extension/src/popup/TabNav.tsx`:

Add `NotebookPen` to the `lucide-react` import, add `| 'memos'` to `TabId`, and append to `TABS`:

```ts
  { id: 'memos' as const, icon: NotebookPen, labelKey: 'popup.tabMemos' as const },
```

Eight tabs fill the four-column grid as 4+4, so the wrapping comment above the `nav` still holds.

- [ ] **Step 6: Wire it into the form**

In `apps/extension/src/popup/PopupForm.tsx`:

Add the import:

```ts
import { MemosSection } from './MemosSection';
```

Add the state, beside the other field state:

```ts
  const [memosUrl, setMemosUrl] = useState(initialSettings.memosUrl);
  const [memosTag, setMemosTag] = useState(initialSettings.memosTag);
```

Add the panel, after the `widgets` tab block:

```tsx
        {activeTab === 'memos' && (
          <MemosSection
            url={memosUrl}
            tag={memosTag}
            onUrlChange={setMemosUrl}
            onTagChange={setMemosTag}
          />
        )}
```

Add to the `onSave({…})` call, after `hiddenWidgets`:

```ts
      memosUrl,
      memosTag,
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm nx run extension:test -- MemosSection.test.tsx`
Expected: PASS, 4 tests.

Run: `pnpm nx run-many -t typecheck lint test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/extension/src/popup/MemosSection.tsx apps/extension/src/popup/MemosSection.test.tsx apps/extension/src/popup/TabNav.tsx apps/extension/src/popup/PopupForm.tsx apps/extension/src/i18n/locales/en.json apps/extension/src/i18n/locales/hu.json
git commit -m "feat(extension): add the Memos settings tab"
```

---

### Task 9: Documentation and manual verification

The manifest changed in Task 3, so the three documents the Chrome Web Store review reads have to catch up — and the rendering nobody tested has to be looked at.

**Files:**
- Modify: `apps/extension/privacy-policy.md`
- Modify: `apps/extension/store-listing.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the privacy policy**

Read `apps/extension/privacy-policy.md` first and fit the heading level and voice of the sections already there. The text to add:

> ### Memos widget
>
> The Memos widget is off until you configure it. When you do, you supply the address of your own Memos server — we do not run one, and we never see it.
>
> Once connected, the extension sends two things to that server and to nowhere else: the text of the memos you write in the widget, and the access token you entered, which authenticates you to your own server. No memo content, token or server address is sent to the Hub API or to any other service.
>
> Your access token is stored with `chrome.storage.local` on the single device where you entered it. It is not synchronised to your other browsers, and it is deliberately excluded from the settings export file, so a backup you share cannot contain it. You can remove it at any time by clearing the token field in the extension's settings.
>
> Access to your server is an **optional** permission. Chrome asks for it at the moment you press Connect, and only for the one address you entered. If you never configure the widget, the extension is never granted access to any additional site.

Then bump the `Effective Date` at the top of the file to the date you make this commit.

- [ ] **Step 2: Update the store listing**

In `apps/extension/store-listing.md`, add to the permission justifications:

> `optional_host_permissions` — requested at runtime, for the single origin the user enters in the extension's settings, so the Memos widget can read and write notes on that user's own self-hosted Memos server. Not requested unless the user configures the widget.

Add to the feature copy that the Memos widget requires a **Memos 0.30.0 or newer** instance.

- [ ] **Step 3: Update CLAUDE.md**

In the **External APIs consumed by the extension** list, add:

> - The user's own Memos instance (`optional_host_permissions`, granted at runtime for one origin) — the Memos widget. **Deliberately not proxied through the Hub API:** the Worker cannot reach a LAN or Tailscale host, and routing private notes through a public, unauthenticated proxy — with the user's token as a Worker secret — is the wrong trust boundary. Requires Memos v0.30.0+; the adapter targets one API version rather than a range.

Add to the **Extension** section, after the settings-backup paragraph:

> **Memos widget** (`utils/memos.ts`, `memosClient.ts`, `memosStorage.ts`, `hooks/useMemos.ts`): the access token lives in `chrome.storage.local`, deliberately outside `HubSettings` — `settingsBackup`'s `RULES` is a mapped type over `keyof HubSettings` and `buildBackup` writes that whole object to a user-shareable file, so keeping the token out of the type makes exporting it impossible rather than merely forbidden. The base URL does sync; the token does not, which is why a second machine has to press Connect once.

- [ ] **Step 4: Build and verify by hand**

Run: `pnpm nx run extension:build`

Load `apps/extension/dist/` in Chrome as an unpacked extension and check, in order:

1. The Memos tab appears in the popup and the eight tabs wrap 4+4 with no clipped labels.
2. Connect with a wrong URL → the https error, and Chrome shows **no** permission prompt.
3. Connect with the real URL and token → Chrome prompts for that one origin, accepting it shows the version.
4. A new tab shows three compact rows in the bottom-left, clear of the photo credit.
5. The checkbox on a compact row archives the memo — confirm it is archived, not deleted, in the Memos UI.
6. Expanding shows the chips, the full list and the composer; a memo submitted while `#todo` is active gets the tag and stays in view.
7. Turn the server off (or disconnect) and open a new tab → the cached rows are still there with the faint cached-memos line, and no red error.
8. Revoke the host permission in `chrome://extensions` → the widget falls back to the settings prompt rather than erroring.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/privacy-policy.md apps/extension/store-listing.md CLAUDE.md
git commit -m "docs(repo): document the Memos widget's permissions and storage"
```

---

## Notes for the reviewer

- **Nothing touches the service worker.** If a change starts to need one, stop — the spec ruled out a background retry queue on purpose, and adding a state machine to `background.ts` is a separate decision.
- **The token must never gain a `HubSettings` field.** If a task seems to need one, the answer is a function in `memosStorage.ts`, not a settings key.
- **`network` failures must stay quiet.** A red error on the new tab page for the ordinary case of being away from the server is the one outcome this design exists to avoid.
