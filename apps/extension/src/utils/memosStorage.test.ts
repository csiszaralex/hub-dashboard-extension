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
