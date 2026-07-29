import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';

const STORAGE_KEY = 'hub_last_seen_version';

const loadUseWhatsNew = async () => (await import('./useWhatsNew')).useWhatsNew;

describe('useWhatsNew', () => {
  it('announces a version the user has not seen yet', async () => {
    const useWhatsNew = await loadUseWhatsNew();

    const { result } = renderHook(() => useWhatsNew());

    expect(result.current.shouldShow).toBe(true);
  });

  it('stays quiet once the current version has been seen', async () => {
    const useWhatsNew = await loadUseWhatsNew();
    localStorage.setItem(STORAGE_KEY, __APP_VERSION__);

    const { result } = renderHook(() => useWhatsNew());

    expect(result.current.shouldShow).toBe(false);
  });

  it('records the seen version so a later load stays quiet', async () => {
    const useWhatsNew = await loadUseWhatsNew();

    renderHook(() => useWhatsNew());

    expect(localStorage.getItem(STORAGE_KEY)).toBe(__APP_VERSION__);
  });

  it('still announces the version when React double-renders in StrictMode', async () => {
    const useWhatsNew = await loadUseWhatsNew();

    const { result } = renderHook(() => useWhatsNew(), { wrapper: StrictMode });

    expect(result.current.shouldShow).toBe(true);
  });

  it('hides the announcement after it is dismissed', async () => {
    const useWhatsNew = await loadUseWhatsNew();
    const { result } = renderHook(() => useWhatsNew());

    act(() => result.current.dismiss());

    expect(result.current.shouldShow).toBe(false);
  });
});
