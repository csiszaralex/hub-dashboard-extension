import { describe, expect, it } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import {
  clearAllMemosData,
  clearDraft,
  clearServerData,
  getCachedMemos,
  getCheck,
  getConnectedServer,
  getDraft,
  getToken,
  getUser,
  setCachedMemos,
  setCheck,
  setConnectedServer,
  setDraft,
  setToken,
  setUser,
} from './memosStorage';

const BASE = 'https://memo.example.com';
const OTHER = 'https://other.example.com';

const memo = {
  name: 'memos/1',
  creator: 'users/1',
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
    expect(stub.readSync('memos_token')).toBeUndefined();
  });
});

describe('connected server', () => {
  it('is empty until one is stored', async () => {
    installChromeStub();
    await expect(getConnectedServer()).resolves.toBe('');
  });

  // The token is a credential for one host. Storing the two together is what
  // lets a tab refuse to send a token to a server it does not belong to.
  it('round-trips, in the local area beside the token', async () => {
    const stub = installChromeStub();
    await setConnectedServer(BASE);
    await expect(getConnectedServer()).resolves.toBe(BASE);
    expect(stub.readLocal('memos_server')).toBe(BASE);
    expect(stub.readSync('memos_server')).toBeUndefined();
  });
});

describe('user', () => {
  it('is empty until one is stored', async () => {
    installChromeStub();
    await expect(getUser()).resolves.toBe('');
  });

  it('round-trips', async () => {
    installChromeStub();
    await setUser('users/1');
    await expect(getUser()).resolves.toBe('users/1');
  });

  // It belongs to the token, which is local to this machine; a synced user
  // name would reach a machine whose token may be for a different account.
  it('is written to the local area, not sync', async () => {
    const stub = installChromeStub();
    await setUser('users/1');
    expect(stub.readLocal('memos_user')).toBe('users/1');
    expect(stub.readSync('memos_user')).toBeUndefined();
  });
});

describe('cached memos', () => {
  it('is empty until something is cached', async () => {
    installChromeStub();
    await expect(getCachedMemos(BASE)).resolves.toEqual([]);
  });

  it('round-trips for the server it was cached for', async () => {
    const stub = installChromeStub();
    await setCachedMemos(BASE, [memo]);
    await expect(getCachedMemos(BASE)).resolves.toEqual([memo]);
    expect(stub.readSync('memos_cache')).toBeUndefined();
  });

  // The server URL syncs and the cache does not. When another machine switches
  // servers, this machine's cache still holds the old server's memos, and they
  // must not be shown as if they were the new one's.
  it('reads as empty for a different server', async () => {
    installChromeStub();
    await setCachedMemos(BASE, [memo]);
    await expect(getCachedMemos(OTHER)).resolves.toEqual([]);
  });

  it('reads as empty when the cache does not say which server it is from', async () => {
    const stub = installChromeStub();
    stub.seedLocal({ memos_cache: { memos: [memo] } });
    await expect(getCachedMemos(BASE)).resolves.toEqual([]);
  });

  // A cache written by an older build, or corrupted by hand, must not reach the
  // renderer — an empty list is always safe, because a refresh follows.
  it('discards a cache that is not a memo list', async () => {
    const stub = installChromeStub();
    stub.seedLocal({ memos_cache: { baseUrl: BASE, memos: [{ noName: true }] } });
    await expect(getCachedMemos(BASE)).resolves.toEqual([]);
  });
});

describe('check', () => {
  it('is absent until one is stored', async () => {
    installChromeStub();
    await expect(getCheck(BASE)).resolves.toBeNull();
  });

  it('round-trips for the server it was taken against', async () => {
    const stub = installChromeStub();
    const check = { baseUrl: BASE, nextAt: 1_000, failure: 'network' as const };
    await setCheck(check);
    await expect(getCheck(BASE)).resolves.toEqual(check);
    expect(stub.readSync('memos_check')).toBeUndefined();
  });

  // A check against the old server says nothing about when the new one was
  // last asked, so it must not hold the new one back.
  it('is absent for a different server', async () => {
    installChromeStub();
    await setCheck({ baseUrl: BASE, nextAt: 1_000, failure: null });
    await expect(getCheck(OTHER)).resolves.toBeNull();
  });

  it.each([
    ['a non-numeric time', { baseUrl: BASE, nextAt: 'soon', failure: null }],
    ['an unknown failure', { baseUrl: BASE, nextAt: 1_000, failure: 'offline' }],
    ['no server', { nextAt: 1_000, failure: null }],
  ])('is absent when the stored check has %s', async (_label, value) => {
    const stub = installChromeStub();
    stub.seedLocal({ memos_check: value });
    await expect(getCheck(BASE)).resolves.toBeNull();
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

describe('clearing', () => {
  const seedEverything = () => {
    const stub = installChromeStub();
    stub.seedLocal({
      memos_server: BASE,
      memos_token: 'memos_pat_x',
      memos_user: 'users/1',
      memos_cache: { baseUrl: BASE, memos: [memo] },
      memos_check: { baseUrl: BASE, nextAt: 1_000, failure: null },
      memos_draft: 'half a thought',
    });
    return stub;
  };

  // Switching servers makes the old server's memos and its check meaningless,
  // but the draft is text the user typed, not the server's data, and the token
  // and account are about to be overwritten by the new connection anyway.
  it('clearServerData removes the cache and the check, and keeps the rest', async () => {
    const stub = seedEverything();
    await clearServerData();
    expect(stub.readLocal('memos_cache')).toBeUndefined();
    expect(stub.readLocal('memos_check')).toBeUndefined();
    expect(stub.readLocal('memos_token')).toBe('memos_pat_x');
    expect(stub.readLocal('memos_user')).toBe('users/1');
    expect(stub.readLocal('memos_draft')).toBe('half a thought');
  });

  it('clearAllMemosData removes everything the widget stored on this machine', async () => {
    const stub = seedEverything();
    await clearAllMemosData();
    for (const key of [
      'memos_server',
      'memos_token',
      'memos_user',
      'memos_cache',
      'memos_check',
      'memos_draft',
    ]) {
      expect(stub.readLocal(key)).toBeUndefined();
    }
  });
});
