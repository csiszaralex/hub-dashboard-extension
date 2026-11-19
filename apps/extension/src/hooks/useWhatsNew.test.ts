import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { installChromeStub } from '../test/chromeStub';

const STORAGE_KEY = 'hub_last_seen_version';
const OLDER_VERSION = '0.0.1';

const loadUseWhatsNew = async () => (await import('./useWhatsNew')).useWhatsNew;

/** Renders the hook and waits for the settings store's first read, which decides it. */
const renderLoaded = async (options?: Parameters<typeof renderHook>[1]) => {
  const useWhatsNew = await loadUseWhatsNew();
  const hook = renderHook(() => useWhatsNew(), options);
  // The hook answers null both before the store has loaded and when it has
  // nothing to say, so wait on the store itself rather than on the answer.
  const { useSettings } = await import('./useSettings');
  const store = renderHook(() => useSettings());
  await waitFor(() => expect(store.result.current.isLoaded).toBe(true));
  return hook;
};

describe('useWhatsNew', () => {
  it('welcomes a first install instead of showing release notes', async () => {
    const { result } = await renderLoaded();

    expect(result.current.announcement).toBe('welcome');
    // Not recorded yet: a tab closed unread must not use the welcome up.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('records the version when the welcome is dismissed, so the next load is quiet', async () => {
    const first = await renderLoaded();

    act(() => first.result.current.dismiss());

    expect(first.result.current.announcement).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(__APP_VERSION__);

    const next = await renderLoaded();
    expect(next.result.current.announcement).toBeNull();
  });

  it('shows the release notes after an update and records the version', async () => {
    localStorage.setItem(STORAGE_KEY, OLDER_VERSION);

    const { result } = await renderLoaded();

    expect(result.current.announcement).toBe('releaseNotes');
    expect(result.current.lastSeenVersion).toBe(OLDER_VERSION);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(__APP_VERSION__);
  });

  it('shows nothing to a returning user whose local storage was cleared', async () => {
    installChromeStub().seedSync({ language: 'hu' });

    const { result } = await renderLoaded();

    expect(result.current.announcement).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(__APP_VERSION__);
  });

  it('does not take the settings version alone for earlier use', async () => {
    // `useSettings` records it on the first page of a fresh install, so a
    // second tab opened before the welcome was dismissed finds it there.
    installChromeStub().seedSync({ settingsVersion: 1 });

    const { result } = await renderLoaded();

    expect(result.current.announcement).toBe('welcome');
  });

  it('stays quiet once the current version has been seen', async () => {
    localStorage.setItem(STORAGE_KEY, __APP_VERSION__);

    const { result } = await renderLoaded();

    expect(result.current.announcement).toBeNull();
  });

  it('still announces the version when React double-renders in StrictMode', async () => {
    localStorage.setItem(STORAGE_KEY, OLDER_VERSION);

    const { result } = await renderLoaded({ wrapper: StrictMode });

    expect(result.current.announcement).toBe('releaseNotes');
  });

  it('hides the release notes after they are dismissed', async () => {
    localStorage.setItem(STORAGE_KEY, OLDER_VERSION);
    const { result } = await renderLoaded();

    act(() => result.current.dismiss());

    expect(result.current.announcement).toBeNull();
  });
});
