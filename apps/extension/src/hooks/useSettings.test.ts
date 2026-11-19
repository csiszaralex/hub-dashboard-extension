import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installChromeStub } from '../test/chromeStub';
import { MAX_DIM } from '../utils/dim';
import { MAX_MINUTES, MIN_MINUTES } from '../utils/pomodoro';
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
      void result.current[0].saveSettings({ locationCity: 'Debrecen' });
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
      void result.current.saveSettings({
        backgroundDim: -50,
        hiddenWidgets: ['note', 'ghost-widget'],
      } as unknown as Partial<HubSettings>);
      await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    });

    await waitFor(() => expect(result.current.settings.backgroundDim).toBe(0));
    expect(result.current.settings.hiddenWidgets).toEqual(['note']);
  });

  it('clamps an out-of-range pomodoro work/break length from the initial storage read', async () => {
    const chromeStub = installChromeStub();
    // A cleared popup field syncs as 0 (see PopupForm); an absurd hand-edited
    // value is the other end of the same defect class this guards against.
    chromeStub.seedSync({ pomodoroWorkMinutes: 0, pomodoroBreakMinutes: 500 });
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.settings.pomodoroWorkMinutes).toBe(MIN_MINUTES);
    expect(result.current.settings.pomodoroBreakMinutes).toBe(MAX_MINUTES);
  });

  it('clamps an out-of-range pomodoro length written through a live storage change', async () => {
    installChromeStub();
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      void result.current.saveSettings({
        pomodoroWorkMinutes: 0,
      } as unknown as Partial<HubSettings>);
      await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    });

    await waitFor(() => expect(result.current.settings.pomodoroWorkMinutes).toBe(MIN_MINUTES));
  });

  // A hand-edited or corrupted memosUrl is not guaranteed to be a string.
  // normalizeBaseUrl used to assume one and threw, which meant merge() never
  // finished, isLoaded never became true and emit() never fired — the whole
  // new-tab page hung on a single bad field, not just the Memos widget.
  it('drops a non-string memosUrl instead of hanging the store on the initial read', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ memosUrl: 42 });
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.settings.memosUrl).toBe('');
  });

  it('drops a non-string memosUrl written through a live storage change', async () => {
    // Seeded to a valid, non-empty prior value on purpose: if the sanitiser
    // were skipped entirely, `next.memosUrl` would just keep this value
    // rather than becoming '', so a seed of '' would let the assertion pass
    // whether or not normalizeBaseUrl ever ran.
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ memosUrl: 'https://old.example.com' });
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.settings.memosUrl).toBe('https://old.example.com');

    await act(async () => {
      void result.current.saveSettings({
        memosUrl: 42,
      } as unknown as Partial<HubSettings>);
      await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    });

    await waitFor(() => expect(result.current.settings.memosUrl).toBe(''));
  });

  // The same defect class as memosUrl above: a stored memosTag is not
  // guaranteed to be a string, and a non-string one made `composeContent`
  // throw inside `submit`, leaving the Memos composer disabled for good.
  it('drops a non-string memosTag on the initial read', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ memosTag: 42 });
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.settings.memosTag).toBe('');
  });

  it('drops a non-string memosTag written through a live storage change', async () => {
    // A non-empty prior value for the reason the memosUrl test gives: with a
    // seed of '', a skipped sanitiser would leave '' behind and still pass.
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ memosTag: 'todo' });
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.settings.memosTag).toBe('todo');

    await act(async () => {
      void result.current.saveSettings({
        memosTag: 42,
      } as unknown as Partial<HubSettings>);
      await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    });

    await waitFor(() => expect(result.current.settings.memosTag).toBe(''));
  });

  // These two used to reach the widgets as stored: only seven fields were
  // sanitised on read. A string `selectedCalendars` reaches `.map` in
  // `useCalendar` and takes the dashboard down.
  it('falls back to the default for a calendar list stored as a string and an unknown background source', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ selectedCalendars: 'primary', backgroundSource: 'bing' });
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.settings.selectedCalendars).toEqual(['primary']);
    expect(result.current.settings.backgroundSource).toBe('unsplash');
  });

  it('falls back to the default for an invalid value written through a live storage change', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ selectedCalendars: ['work@example.com'], backgroundSource: 'custom' });
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.settings.backgroundSource).toBe('custom');

    await act(async () => {
      void result.current.saveSettings({
        selectedCalendars: 'primary',
        backgroundSource: 'bing',
      } as unknown as Partial<HubSettings>);
      await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    });

    await waitFor(() => expect(result.current.settings.backgroundSource).toBe('unsplash'));
    expect(result.current.settings.selectedCalendars).toEqual(['primary']);
  });

  it('keeps settings that are not part of a live change', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ locationCity: 'Szeged' });
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.saveSettings({ memosTag: 'todo' });
    });

    await waitFor(() => expect(result.current.settings.memosTag).toBe('todo'));
    expect(result.current.settings.locationCity).toBe('Szeged');
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

describe('useSettings — settings version', () => {
  const VERSION_KEY = 'settingsVersion';

  it('records the current version for settings stored before versioning', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ locationCity: 'Szeged' });
    const { CURRENT_SETTINGS_VERSION } = await import('../utils/settingsSchema');
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(chromeStub.readSync(VERSION_KEY)).toBe(CURRENT_SETTINGS_VERSION));
    // Recording the version changes nothing the user set.
    expect(chromeStub.readSync('locationCity')).toBe('Szeged');
    expect(result.current.settings.locationCity).toBe('Szeged');
  });

  it('does not count the version as a setting', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ [VERSION_KEY]: 1 });
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.settings).not.toHaveProperty(VERSION_KEY);
  });

  it('leaves a version written by a newer build alone', async () => {
    const chromeStub = installChromeStub();
    chromeStub.seedSync({ [VERSION_KEY]: 99, locationCity: 'Szeged' });
    const useSettings = await loadUseSettings();

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chromeStub.readSync(VERSION_KEY)).toBe(99);
    expect(result.current.settings.locationCity).toBe('Szeged');
  });
});

describe('saveSettings', () => {
  it('resolves once Chrome has written the settings', async () => {
    const chromeStub = installChromeStub();
    const { saveSettings } = await import('./useSettings');

    await expect(saveSettings({ locationCity: 'Pécs' })).resolves.toBeUndefined();
    expect(chromeStub.readSync('locationCity')).toBe('Pécs');
  });

  it("rejects with Chrome's message when the write is refused", async () => {
    // Chrome refuses the whole call when one item is over the per-item quota,
    // so the valid setting alongside it is not written either — the caller has
    // to hear about it, because nothing on the page will show it otherwise.
    const chromeStub = installChromeStub();
    const { saveSettings } = await import('./useSettings');

    await expect(
      saveSettings({
        locationCity: 'Pécs',
        customQuotes: [{ text: 'x'.repeat(9000), author: '' }],
      }),
    ).rejects.toThrow('QUOTA_BYTES_PER_ITEM quota exceeded');
    expect(chromeStub.readSync('locationCity')).toBeUndefined();
  });
});
