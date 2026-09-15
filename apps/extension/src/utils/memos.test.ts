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

  // Callers read this out of chrome.storage.sync, which is typed as `unknown`
  // at the boundary — a hand-edited or corrupt stored value is not guaranteed
  // to be a string. Every other sanitiser in this codebase guards internally
  // rather than trusting the caller; this one must too, or a non-string value
  // throws inside merge()/applyChanges() and the whole settings store hangs.
  it('rejects non-string input instead of throwing', () => {
    expect(normalizeBaseUrl(42)).toBeNull();
    expect(normalizeBaseUrl(null)).toBeNull();
    expect(normalizeBaseUrl(undefined)).toBeNull();
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
        creator: 'users/1',
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
        creator: 'users/1',
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
      creator: '',
      content: 'bare',
      snippet: 'bare',
      tags: [],
      createTime: '',
      pinned: false,
    });
  });

  // An empty creator matches no user, so a memo whose owner cannot be read is
  // never shown as the connected account's own.
  it('reads a creator that is not a string as no creator', () => {
    const [memo] = parseMemoList({ memos: [{ name: 'memos/x', content: 'a', creator: 1 }] }) ?? [];
    expect(memo.creator).toBe('');
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
