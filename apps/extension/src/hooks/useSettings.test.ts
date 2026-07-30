import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import { MAX_DIM } from '../utils/dim';
import type { HubSettings } from './useSettings';

const loadUseSettings = async () => (await import('./useSettings')).useSettings;

describe('useSettings', () => {
  it('reads sync storage once no matter how many components ask for settings', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ locationCity: 'Szeged' });
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => [useSettings(), useSettings(), useSettings()]);

    await waitFor(() => expect(result.current[0].isLoaded).toBe(true));
    expect(result.current[2].settings.locationCity).toBe('Szeged');
    expect(chromeStub.syncGetCount()).toBe(1);
  });

  it('registers a single storage change listener for the whole page', async () => {
    const chromeStub = installChromeStub();
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => [useSettings(), useSettings(), useSettings()]);
    await waitFor(() => expect(result.current[0].isLoaded).toBe(true));

    expect(chromeStub.changeListenerCount()).toBe(1);
  });

  it('falls back to the default when a stored value is missing', async () => {
    installChromeStub();
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.settings.selectedCalendars).toEqual(['primary']);
  });

  it('propagates a saved setting to every consumer', async () => {
    installChromeStub();
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => [useSettings(), useSettings()]);
    await waitFor(() => expect(result.current[0].isLoaded).toBe(true));

    await act(async () => {
      result.current[0].saveSettings({ locationCity: 'Debrecen' });
      await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    });

    await waitFor(() => expect(result.current[1].settings.locationCity).toBe('Debrecen'));
  });

  it('clamps a corrupt backgroundDim and drops an unknown hidden widget id from the initial storage read', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ backgroundDim: 500, hiddenWidgets: ['weather', 'ghost-widget'] });
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.settings.backgroundDim).toBe(MAX_DIM);
    expect(result.current.settings.hiddenWidgets).toEqual(['weather']);
  });

  it('sanitises a corrupt backgroundDim and unknown hidden widget id written through a live storage change', async () => {
    installChromeStub();
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      result.current.saveSettings({
        backgroundDim: -50,
        hiddenWidgets: ['note', 'ghost-widget'],
      } as unknown as Partial<HubSettings>);
      await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    });

    await waitFor(() => expect(result.current.settings.backgroundDim).toBe(0));
    expect(result.current.settings.hiddenWidgets).toEqual(['note']);
  });

  it('keeps a stable saveSettings reference across renders', async () => {
    installChromeStub();
    const useSettings = await loadUseSettings();

    const { result, rerender } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    const first = result.current.saveSettings;

    rerender();

    expect(result.current.saveSettings).toBe(first);
  });
});
