import { describe, expect, it, vi } from 'vitest';
import { installChromeStub } from './chromeStub';

/**
 * The stub's `storage.sync` quotas, checked against what Chrome documents for
 * `chrome.storage.sync`: an item over `QUOTA_BYTES_PER_ITEM` (8192), an area
 * over `QUOTA_BYTES` (102400) or over `MAX_ITEMS` (512) fails the whole call,
 * through `runtime.lastError` or a rejected Promise. A stub without them let a
 * settings save Chrome refuses look like one that worked.
 */
describe('chromeStub storage.sync quotas', () => {
  /** The callback form, resolved with whatever `lastError` said inside it. */
  const setWithCallback = (items: Record<string, unknown>) =>
    new Promise<string | undefined>((resolve) =>
      chrome.storage.sync.set(items, () => resolve(chrome.runtime.lastError?.message)),
    );

  it('refuses a call with one item over the per-item quota and writes none of it', async () => {
    const stub = installChromeStub();
    stub.seedSync({ locationCity: 'Szeged' });
    const onChanged = vi.fn();
    chrome.storage.onChanged.addListener(onChanged);

    const error = await setWithCallback({
      locationCity: 'Pécs',
      customQuotes: 'x'.repeat(8192),
    });

    expect(error).toBe('QUOTA_BYTES_PER_ITEM quota exceeded');
    // Atomic: the small, valid item in the same call is not written either.
    expect(stub.readSync('locationCity')).toBe('Szeged');
    expect(stub.readSync('customQuotes')).toBeUndefined();
    expect(onChanged).not.toHaveBeenCalled();
    // Readable only inside the callback, as in Chrome.
    expect(chrome.runtime.lastError).toBeUndefined();
  });

  it('rejects the promise form instead when no callback is passed', async () => {
    const stub = installChromeStub();

    await expect(chrome.storage.sync.set({ customQuotes: 'x'.repeat(9000) })).rejects.toThrow(
      'QUOTA_BYTES_PER_ITEM quota exceeded',
    );
    expect(stub.readSync('customQuotes')).toBeUndefined();
  });

  it('counts UTF-8 bytes, not string length', async () => {
    // 4500 characters, 9000 bytes: accented text is what pushes a real list over.
    installChromeStub();

    expect(await setWithCallback({ note: 'á'.repeat(4500) })).toBe(
      'QUOTA_BYTES_PER_ITEM quota exceeded',
    );
  });

  it('refuses a write that takes the whole area over its total quota', async () => {
    const stub = installChromeStub();
    // Twelve items of just under 8 KB fit; the thirteenth crosses 102400.
    for (let i = 0; i < 12; i++) {
      expect(await setWithCallback({ [`k${i}`]: 'x'.repeat(8000) })).toBeUndefined();
    }

    expect(await setWithCallback({ k12: 'x'.repeat(8000) })).toBe('QUOTA_BYTES quota exceeded');
    expect(stub.readSync('k12')).toBeUndefined();
    expect(stub.readSync('k11')).toBeDefined();
  });

  it('refuses a write past the item count', async () => {
    const stub = installChromeStub();
    const items = Object.fromEntries(Array.from({ length: 513 }, (_, i) => [`k${i}`, 1]));

    expect(await setWithCallback(items)).toBe('MAX_ITEMS quota exceeded');
    expect(stub.readSync('k0')).toBeUndefined();
  });

  it('still writes and announces a call that fits', async () => {
    const stub = installChromeStub();
    const onChanged = vi.fn();
    chrome.storage.onChanged.addListener(onChanged);

    expect(await setWithCallback({ locationCity: 'Pécs' })).toBeUndefined();

    expect(stub.readSync('locationCity')).toBe('Pécs');
    expect(onChanged).toHaveBeenCalledWith({ locationCity: { newValue: 'Pécs' } }, 'sync');
  });
});
