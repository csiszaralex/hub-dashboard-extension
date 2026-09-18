import { describe, expect, it } from 'vitest';
import {
  composeContent,
  filterByTag,
  isSupportedVersion,
  normalizeBaseUrl,
  originPattern,
  parseMemoList,
  sanitizeMemosTag,
  stripTags,
  tagsExcept,
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

describe('sanitizeMemosTag', () => {
  it('keeps a bare tag', () => {
    expect(sanitizeMemosTag('todo')).toBe('todo');
  });

  // `Memo.tags` never carries the `#`, so a stored `#todo` would match nothing.
  it('trims the tag and drops one leading #', () => {
    expect(sanitizeMemosTag('  #todo  ')).toBe('todo');
    expect(sanitizeMemosTag('##todo')).toBe('#todo');
  });

  it('keeps an empty tag, which means unfiltered', () => {
    expect(sanitizeMemosTag('')).toBe('');
    expect(sanitizeMemosTag('   ')).toBe('');
  });

  // Read out of chrome.storage.sync, which is untyped at the boundary. A
  // non-string reaching `composeContent` throws inside `submit`, after the
  // composer has already been disabled — and it never re-enables.
  it('turns a non-string into no tag instead of passing it on', () => {
    expect(sanitizeMemosTag(42)).toBe('');
    expect(sanitizeMemosTag(null)).toBe('');
    expect(sanitizeMemosTag(undefined)).toBe('');
    expect(sanitizeMemosTag(['todo'])).toBe('');
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

  // The same boundary `stripTags` uses. With `\w`, `#teend` would be found
  // inside `#teendő`, the tag would be judged already present, and the memo
  // would file under a tag the filter it was written in does not match.
  it('treats accented letters as part of the word, like stripTags does', () => {
    expect(composeContent('#teendő mosogatás', 'teend')).toBe('#teendő mosogatás #teend');
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

describe('stripTags', () => {
  it('removes a tag written in front of the text', () => {
    expect(stripTags('#proj valami', ['proj'])).toBe('valami');
  });

  // composeContent appends the active tag, so this is the shape most memos the
  // widget itself wrote actually have.
  it('removes a tag appended after the text', () => {
    expect(stripTags('hívd fel Andrist #todo', ['todo'])).toBe('hívd fel Andrist');
  });

  // Memos deduplicates tags keeping the first spelling it met, so the text can
  // hold a spelling the tag list does not.
  it('matches regardless of case', () => {
    expect(stripTags('#Proj valami', ['proj'])).toBe('valami');
  });

  it('removes a longer tag whole rather than a shorter tag out of it', () => {
    expect(stripTags('#project és #proj', ['proj', 'project'])).toBe('és');
  });

  it('leaves a longer word that only begins with a tag', () => {
    expect(stripTags('#projekt terv', ['proj'])).toBe('#projekt terv');
  });

  // `\w` does not cover accented letters: a word boundary built on it would
  // see `#teend` end before the `ő` and cut a tag the server never listed.
  it('treats accented letters as part of the word', () => {
    expect(stripTags('#teendő mosogatás', ['teendő'])).toBe('mosogatás');
    expect(stripTags('#teendő mosogatás', ['teend'])).toBe('#teendő mosogatás');
  });

  it('removes a nested tag whole', () => {
    expect(stripTags('#proj/web kész', ['proj/web'])).toBe('kész');
  });

  // Only what the server parsed as a tag goes. A `#` in a link, in code, or in
  // anything else Memos did not list must survive.
  it('leaves a # that the server did not list as a tag', () => {
    expect(stripTags('lásd example.com/#szakasz', [])).toBe('lásd example.com/#szakasz');
  });

  it('closes the gap a tag in the middle leaves', () => {
    expect(stripTags('első #a második', ['a'])).toBe('első második');
  });

  it('leaves nothing when the memo was only tags', () => {
    expect(stripTags('#todo #proj', ['todo', 'proj'])).toBe('');
  });

  it('escapes tags that contain regex characters', () => {
    expect(stripTags('#c++ tanulás', ['c++'])).toBe('tanulás');
  });
});

describe('tagsExcept', () => {
  // Filtered to one tag, every row carries it — repeating it on each row says
  // nothing the filter above has not already said.
  it('leaves out the tag the list is filtered to', () => {
    expect(tagsExcept(['todo', 'proj'], 'todo')).toEqual(['proj']);
  });

  it('keeps every tag when nothing is filtered', () => {
    expect(tagsExcept(['todo', 'proj'], null)).toEqual(['todo', 'proj']);
  });
});
