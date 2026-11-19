import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubSettings } from '../hooks/useSettings';
import { installChromeStub, type ChromeStub } from '../test/chromeStub';
import { runningPomodoro } from '../test/pomodoroState';
import { DEFAULT_WORK_MINUTES } from '../utils/pomodoro';
import { POMODORO_STATE_KEY } from '../utils/pomodoroState';
import { DRAFT_SAVE_DELAY_MS } from './useDraftSetting';

const baseSettings: HubSettings = {
  unsplashQuery: 'landscape',
  backgroundSource: 'unsplash',
  backgroundDim: 30,
  locationCity: '',
  locationLat: null,
  locationLon: null,
  selectedCalendars: ['primary'],
  countdownTarget: null,
  language: 'en',
  hiddenWidgets: [],
  pomodoroWorkMinutes: 25,
  pomodoroBreakMinutes: 5,
  quoteSource: 'stoic',
  quoteQuery: '',
  customQuotes: [],
  memosUrl: '',
  memosTag: '',
};

/** The form wired to the real `saveSettings`, so a test can read what reached `chrome.storage.sync`. */
const renderWithStorage = async (settings: HubSettings = baseSettings) => {
  await import('../i18n/i18n');
  const { saveSettings } = await import('../hooks/useSettings');
  const { PopupForm } = await import('./PopupForm');
  render(<PopupForm settings={settings} onSave={saveSettings} />);
};

/** Sync storage already holding more than `QUOTA_BYTES`, so any further write is refused. */
const fillSyncStorage = (stub: ChromeStub) =>
  stub.seedSync(
    Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`filler${i}`, 'x'.repeat(8000)])),
  );

/** The `storage.sync.set` calls that wrote `key`. */
const writesOf = (spy: { mock: { calls: unknown[][] } }, key: string) =>
  spy.mock.calls.filter(([items]) => key in (items as Record<string, unknown>));

afterEach(() => {
  vi.useRealTimers();
});

describe('PopupForm', () => {
  it('clamps a corrupt stored backgroundDim before showing it in the dim hint', async () => {
    // The dim field only renders on the appearance tab; force it open before mounting.
    localStorage.setItem('popup_tab', 'appearance');
    const { PopupForm } = await import('./PopupForm');

    render(
      <PopupForm
        settings={{ ...baseSettings, backgroundDim: Number.NaN }}
        onSave={async () => {}}
      />,
    );

    const slider = await screen.findByRole('slider');
    const hint = slider.parentElement?.querySelector('p');

    expect(hint?.textContent).not.toMatch(/NaN/);
    expect(hint?.textContent).toMatch(/30/);
  });

  it('has no Apply button: nothing waits to be confirmed', async () => {
    localStorage.setItem('popup_tab', 'general');
    await renderWithStorage();
    await screen.findByLabelText('Language');

    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull();
  });

  it('swaps the Unsplash tag field for the upload control when the source radio changes', async () => {
    localStorage.setItem('popup_tab', 'appearance');
    const { PopupForm } = await import('./PopupForm');

    render(<PopupForm settings={baseSettings} onSave={async () => {}} />);

    expect(screen.queryByLabelText('Appearance & Background')).not.toBeNull();
    expect(screen.queryByLabelText('Choose an image')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'My own image' }));

    expect(screen.queryByLabelText('Appearance & Background')).toBeNull();
    expect(screen.queryByLabelText('Choose an image')).not.toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Unsplash photos' }));

    expect(screen.queryByLabelText('Appearance & Background')).not.toBeNull();
    expect(screen.queryByLabelText('Choose an image')).toBeNull();
  });

  it('rejects a non-image upload and reports it under the field and in the status line', async () => {
    localStorage.setItem('popup_tab', 'appearance');
    const { PopupForm } = await import('./PopupForm');
    // Built outside the JSX: i18next/no-literal-string flags string literals inside
    // JSX attribute expressions too, not just rendered text.
    const customSettings: HubSettings = { ...baseSettings, backgroundSource: 'custom' };
    const onSave = vi.fn();

    render(<PopupForm settings={customSettings} onSave={onSave} />);

    const fileInput = screen.getByLabelText('Choose an image');
    const notAnImage = new File(['plain text'], 'notes.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [notAnImage] } });

    await waitFor(() =>
      expect(fileInput.parentElement?.querySelector('p')?.textContent).toBe(
        'That file is not an image.',
      ),
    );
    expect((await screen.findByRole('alert')).textContent).toBe('That file is not an image.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('stores a valid image end to end and only then makes the custom source the setting', async () => {
    localStorage.setItem('popup_tab', 'appearance');
    const { PopupForm } = await import('./PopupForm');
    const customSettings: HubSettings = { ...baseSettings, backgroundSource: 'custom' };
    const onSave = vi.fn(async () => {});

    render(<PopupForm settings={customSettings} onSave={onSave} />);

    const fileInput = screen.getByLabelText('Choose an image');
    const validImage = new File(['not-actually-pixels-but-a-real-mime-type'], 'wallpaper.png', {
      type: 'image/png',
    });

    fireEvent.change(fileInput, { target: { files: [validImage] } });

    // Observable outcome, not internals: the image the popup just accepted must
    // be genuinely retrievable through the same cache the background hook reads —
    // this is exactly the check that would have caught the `hub://` scheme bug,
    // since a rejected `cache.put()` leaves `hasCustomImage()` false forever.
    const { hasCustomImage } = await import('../utils/imageCache');
    await waitFor(async () => expect(await hasCustomImage()).toBe(true));

    // Written by the upload itself, with nothing else to press.
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ backgroundSource: 'custom' }));

    // That slot shows the hint or an upload error, never both, so "no error"
    // means checking it is not one of the failures — not pinning the hint's
    // exact wording, which made a copy change look like a broken upload.
    const hint = fileInput.parentElement?.querySelector('p');
    expect(hint?.textContent).not.toMatch(/not an image|could not store|choose an image/i);
    expect(hint?.textContent).toMatch(/stored on this device only/i);
  });

  it('does not make the custom source the setting when no image was ever uploaded', async () => {
    localStorage.setItem('popup_tab', 'appearance');
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn();

    render(<PopupForm settings={baseSettings} onSave={onSave} />);

    // Selecting the radio directly, without going through the upload, is exactly
    // the gap the hook-level fix also has to tolerate: nothing has been stored yet.
    fireEvent.click(screen.getByRole('radio', { name: 'My own image' }));

    expect(await screen.findByText('Choose an image to use this option.')).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('writes the Unsplash source the moment its radio is picked', async () => {
    const stub = installChromeStub();
    localStorage.setItem('popup_tab', 'appearance');
    await renderWithStorage({ ...baseSettings, backgroundSource: 'custom' });

    fireEvent.click(await screen.findByRole('radio', { name: 'Unsplash photos' }));

    await waitFor(() => expect(stub.readSync('backgroundSource')).toBe('unsplash'));
  });

  it('writes the default focus length when the field is emptied and its tab is left', async () => {
    localStorage.setItem('popup_tab', 'pomodoro');
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn(async () => {});

    // Start from a value that is neither the default nor the minimum, so a
    // pass caused by "value happens to be unchanged" or "value happens to be
    // 1 already" can't masquerade as the fallback actually firing.
    render(<PopupForm settings={{ ...baseSettings, pomodoroWorkMinutes: 40 }} onSave={onSave} />);

    // Clearing the field yields an empty string. `clampPomodoroMinutes`
    // treats "nothing entered" as distinct from a deliberate `0` and falls
    // back to the default, rather than clamping up to the one-minute floor.
    fireEvent.change(screen.getByLabelText('Focus length (minutes)'), { target: { value: '' } });

    // Leaving the tab unmounts the field before the pause is over; the edit
    // is written then rather than lost with it.
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ pomodoroWorkMinutes: DEFAULT_WORK_MINUTES }),
    );
  });

  it('writes the default focus length, not 1, when the emptied field loses focus', async () => {
    localStorage.setItem('popup_tab', 'pomodoro');
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn(async () => {});

    render(<PopupForm settings={{ ...baseSettings, pomodoroWorkMinutes: 40 }} onSave={onSave} />);

    const input = screen.getByLabelText('Focus length (minutes)');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ pomodoroWorkMinutes: DEFAULT_WORK_MINUTES }),
    );
  });

  it('lets the focus length be cleared and retyped without a leading zero', async () => {
    const { PopupForm } = await import('./PopupForm');
    render(
      <PopupForm settings={{ ...baseSettings, pomodoroWorkMinutes: 25 }} onSave={async () => {}} />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /focus/i }));
    const input = screen.getByLabelText(/focus length/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: '3' } });
    expect(input.value).toBe('3');
  });
});

describe('PopupForm — save on change', () => {
  let stub: ChromeStub;

  beforeEach(() => {
    stub = installChromeStub();
  });

  it('writes a checkbox change to storage without anything else to press', async () => {
    localStorage.setItem('popup_tab', 'widgets');
    await renderWithStorage();

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Clock' }));

    await waitFor(() => expect(stub.readSync('hiddenWidgets')).toEqual(['clock']));
    expect((await screen.findByRole('status')).textContent).toMatch(/Saved/);
  });

  it('writes typed text once, after the pause', async () => {
    localStorage.setItem('popup_tab', 'appearance');
    const setSpy = vi.spyOn(chrome.storage.sync, 'set');
    await renderWithStorage();
    const field = await screen.findByLabelText('Appearance & Background');

    vi.useFakeTimers();
    fireEvent.change(field, { target: { value: 'for' } });
    fireEvent.change(field, { target: { value: 'forest' } });
    fireEvent.change(field, { target: { value: 'forest, mist ' } });

    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS - 1);
    expect(writesOf(setSpy, 'unsplashQuery')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(writesOf(setSpy, 'unsplashQuery')).toHaveLength(1);
    // Trimmed on the way, as the read path's decoders would see it.
    expect(stub.readSync('unsplashQuery')).toBe('forest, mist');

    // Nothing left over for a later timer or a blur to write a second time.
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS * 2);
    fireEvent.blur(field);
    expect(writesOf(setSpy, 'unsplashQuery')).toHaveLength(1);
  });

  it('writes typed text when the popup is hidden straight after typing', async () => {
    // A Chrome popup closes on any click outside it, well inside the pause.
    localStorage.setItem('popup_tab', 'appearance');
    const setSpy = vi.spyOn(chrome.storage.sync, 'set');
    await renderWithStorage();
    const field = await screen.findByLabelText('Appearance & Background');

    vi.useFakeTimers();
    fireEvent.change(field, { target: { value: 'harbour' } });
    window.dispatchEvent(new Event('pagehide'));
    expect(writesOf(setSpy, 'unsplashQuery')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS * 2);
    expect(writesOf(setSpy, 'unsplashQuery')).toHaveLength(1);
    vi.useRealTimers();

    await waitFor(() => expect(stub.readSync('unsplashQuery')).toBe('harbour'));
  });
});

/**
 * The Focus tab is the only place these controls exist once the widget is
 * hidden, and hiding the widget no longer stops the timer — the service worker
 * owns it now. Every test here drives the real form, because a command that
 * also wrote settings would be a property of the button's place in the form
 * rather than of the controls themselves.
 */
describe('PopupForm — Focus session controls', () => {
  let chromeStub: ChromeStub;

  beforeEach(() => {
    // Re-installed to get a handle on it: the shared setup installs a stub but
    // keeps the seeding and inspection helpers to itself.
    chromeStub = installChromeStub();
    localStorage.setItem('popup_tab', 'pomodoro');
  });

  it('sends start to the worker on click, and writes no settings', async () => {
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn();

    render(<PopupForm settings={baseSettings} onSave={onSave} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    // The command travels immediately, on its own, and nothing else does.
    await waitFor(() => expect(chromeStub.sentMessages()).toEqual([{ type: 'pomodoro/start' }]));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sends reset to the worker on click, and writes no settings', async () => {
    chromeStub.seedLocal({ [POMODORO_STATE_KEY]: runningPomodoro('work', 90_000) });
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn();

    render(<PopupForm settings={baseSettings} onSave={onSave} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));

    await waitFor(() =>
      expect(chromeStub.sentMessages()).toContainEqual({ type: 'pomodoro/reset' }),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the phase and remaining time of a session that is already running', async () => {
    // Blind Start and Reset buttons would be a worse trap than none: the user
    // cannot see the timer at all once the widget is hidden.
    chromeStub.seedLocal({ [POMODORO_STATE_KEY]: runningPomodoro('break', 5 * 60_000) });
    const { PopupForm } = await import('./PopupForm');

    render(<PopupForm settings={baseSettings} onSave={async () => {}} />);

    expect(await screen.findByText('Break')).not.toBeNull();
    expect(await screen.findByText(/^0[45]:\d\d$/)).not.toBeNull();
    // Start means nothing while a phase is running; the widget disables it too.
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
  });

  it('reaches the session even with the Focus widget hidden', async () => {
    // The whole point. Hiding the widget used to remove the only Start and
    // Reset in the extension while the worker kept the timer — and the phase
    // notifications — running.
    chromeStub.seedLocal({ [POMODORO_STATE_KEY]: runningPomodoro('work', 60_000) });
    const { PopupForm } = await import('./PopupForm');
    const hidden: HubSettings = { ...baseSettings, hiddenWidgets: ['pomodoro'] };

    render(<PopupForm settings={hidden} onSave={async () => {}} />);

    expect(await screen.findByRole('button', { name: 'Reset' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Start' })).not.toBeNull();
  });

  it('mounts nothing timer-related while another tab is open', async () => {
    // `usePomodoro` subscribes to storage and pings the worker on mount. A
    // popup opened on General has no business doing either.
    localStorage.setItem('popup_tab', 'general');
    chromeStub.seedLocal({ [POMODORO_STATE_KEY]: runningPomodoro('work', 60_000) });
    const { PopupForm } = await import('./PopupForm');

    render(<PopupForm settings={baseSettings} onSave={async () => {}} />);
    // The language select, named rather than "the only combobox" — the General
    // tab grew a second one when the quote source picker landed there.
    await screen.findByLabelText('Language');

    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(chromeStub.sentMessages()).toEqual([]);
  });
});

describe('PopupForm — custom background durability', () => {
  beforeEach(() => {
    installChromeStub();
    localStorage.setItem('popup_tab', 'appearance');
  });

  it('warns that an uploaded background cannot be recovered', async () => {
    // "Stored on this device only" was already there and is the problem: in an
    // extension whose whole pitch is that nothing leaves the machine, that
    // sentence reads as reassurance. The uploaded image is the one piece of
    // user data here that no amount of care in `imageCache` can bring back once
    // the browser clears its storage, and the popup has to say so.
    await import('../i18n/i18n');
    const { PopupForm } = await import('./PopupForm');
    const custom: HubSettings = { ...baseSettings, backgroundSource: 'custom' };

    render(<PopupForm settings={custom} onSave={async () => {}} />);

    expect(await screen.findByText(/cannot be recovered/i)).not.toBeNull();
  });

  it('says nothing about it when the background comes from Unsplash', async () => {
    // An Unsplash photo is re-downloadable by definition, so the warning would
    // be noise on the only path where it does not apply.
    await import('../i18n/i18n');
    const { PopupForm } = await import('./PopupForm');

    render(<PopupForm settings={baseSettings} onSave={async () => {}} />);

    // Wait for the Unsplash branch of the tab to actually render, so a missing
    // warning below cannot simply mean nothing was rendered yet.
    await screen.findByLabelText('Appearance & Background');
    expect(screen.queryByText(/cannot be recovered/i)).toBeNull();
  });
});

describe('PopupForm — the weather city', () => {
  let stub: ChromeStub;

  beforeEach(() => {
    stub = installChromeStub();
    localStorage.setItem('popup_tab', 'weather');
  });

  const geocoding = (results: { name: string; latitude: number; longitude: number }[]) =>
    vi.fn(async () => new Response(JSON.stringify({ results })));

  it('looks the city up on blur and writes it with its coordinates', async () => {
    const fetchMock = geocoding([{ name: 'Kiskunfalva', latitude: 46.25, longitude: 19.5 }]);
    vi.stubGlobal('fetch', fetchMock);
    await renderWithStorage();

    const field = (await screen.findByLabelText('Weather Location')) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'kiskunfalva' } });
    // Enter resolves too; the blur after it must not ask a second time.
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.blur(field);

    await waitFor(() => expect(stub.readSync('locationCity')).toBe('Kiskunfalva'));
    expect(stub.readSync('locationLat')).toBe(46.25);
    expect(stub.readSync('locationLon')).toBe(19.5);
    // The field shows the name the lookup settled on.
    expect(field.value).toBe('Kiskunfalva');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for a city the lookup cannot find, and says so by the field', async () => {
    vi.stubGlobal('fetch', geocoding([]));
    const setSpy = vi.spyOn(chrome.storage.sync, 'set');
    await renderWithStorage({ ...baseSettings, locationCity: 'Old Town', locationLat: 1, locationLon: 2 });

    const field = await screen.findByLabelText('Weather Location');
    fireEvent.change(field, { target: { value: 'Nowhereville' } });
    fireEvent.blur(field);

    expect((await screen.findByRole('alert')).textContent).toBe('The specified city was not found.');
    expect(field.parentElement?.querySelector('p')?.textContent).toBe(
      'The specified city was not found.',
    );
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('clears the location when the field is emptied', async () => {
    await renderWithStorage({ ...baseSettings, locationCity: 'Old Town', locationLat: 1, locationLon: 2 });

    const field = await screen.findByLabelText('Weather Location');
    fireEvent.change(field, { target: { value: '  ' } });
    fireEvent.blur(field);

    await waitFor(() => expect(stub.readSync('locationCity')).toBe(''));
    expect(stub.readSync('locationLat')).toBeNull();
    expect(stub.readSync('locationLon')).toBeNull();
  });
});

describe('PopupForm — calendars', () => {
  let stub: ChromeStub;

  beforeEach(() => {
    stub = installChromeStub();
    localStorage.setItem('popup_tab', 'calendars');
  });

  it('shows the sign-in hint and no error when the user is signed out', async () => {
    // The stub's default: no cached token, so the non-interactive request fails
    // as it does for a user who never connected. Nothing was pressed yet.
    await renderWithStorage();

    expect(
      await screen.findByText('Sign in with Google to choose which calendars to show.'),
    ).not.toBeNull();
    expect(stub.authTokenRequests()).toEqual([{ interactive: false }]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/error|not signed in/i)).toBeNull();
  });

  it('writes a calendar choice the moment it is ticked', async () => {
    stub.setAuthToken('ya29.invented-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                { id: 'someone@example.com', primary: true, summary: 'Personal' },
                { id: 'team@group.calendar.google.com', summary: 'Team' },
              ],
            }),
          ),
      ),
    );
    await renderWithStorage();

    // The primary calendar is listed as `primary`, the id the setting holds.
    const personal = (await screen.findByRole('checkbox', { name: 'Personal' })) as HTMLInputElement;
    expect(personal.checked).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Team' }));

    await waitFor(() =>
      expect(stub.readSync('selectedCalendars')).toEqual([
        'primary',
        'team@group.calendar.google.com',
      ]),
    );
  });
});

describe('PopupForm — a write Chrome refuses', () => {
  it('shows the error in the status line, and keeps it there on another tab', async () => {
    fillSyncStorage(installChromeStub());
    localStorage.setItem('popup_tab', 'widgets');
    await renderWithStorage();

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Clock' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/QUOTA_BYTES quota exceeded/);
    expect(screen.getByRole('status').textContent).not.toMatch(/Saved/);

    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(screen.getByRole('alert').textContent).toMatch(/QUOTA_BYTES quota exceeded/);
  });

  it('reports a write that fails after its tab is gone', async () => {
    // The old popup's failure mode: an error rendered only inside the tab that
    // caused it, so pressing on from another tab showed nothing at all.
    fillSyncStorage(installChromeStub());
    localStorage.setItem('popup_tab', 'appearance');
    await renderWithStorage();

    fireEvent.change(await screen.findByLabelText('Appearance & Background'), {
      target: { value: 'desert' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Widgets' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/QUOTA_BYTES quota exceeded/);
  });

  it('clears the error once a later write goes through', async () => {
    localStorage.setItem('popup_tab', 'widgets');
    await import('../i18n/i18n');
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi
      .fn<(settings: Partial<HubSettings>) => Promise<void>>()
      .mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'))
      .mockResolvedValue(undefined);

    render(<PopupForm settings={baseSettings} onSave={onSave} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Clock' }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Clock' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Saved/));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a refused import in place of reloading', async () => {
    fillSyncStorage(installChromeStub());
    localStorage.setItem('popup_tab', 'general');
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    await renderWithStorage();

    fireEvent.change(await screen.findByLabelText('Import'), {
      target: {
        files: [
          new File([JSON.stringify({ version: 1, settings: { locationCity: 'Pécs' } })], 'b.json', {
            type: 'application/json',
          }),
        ],
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));

    expect(await screen.findByText(/QUOTA_BYTES quota exceeded/)).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('PopupForm — settings backup', () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installChromeStub();
    localStorage.setItem('popup_tab', 'general');
    // The component remounts the popup after a successful import so the form
    // fields stop showing the values they were mounted with. happy-dom has no
    // navigation, so this stands in for it and lets the assertion run.
    reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
  });

  const backupFile = (settings: unknown) =>
    new File([JSON.stringify({ version: 1, settings })], 'hub-settings.json', {
      type: 'application/json',
    });

  it('applies the settings from a backup file, then reloads', async () => {
    await import('../i18n/i18n');
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn(async () => {});

    render(<PopupForm settings={baseSettings} onSave={onSave} />);

    const input = await screen.findByLabelText('Import');
    fireEvent.change(input, {
      target: { files: [backupFile({ locationCity: 'Szeged', backgroundDim: 45 })] },
    });

    // Settings sync to every signed-in machine, so the file says how much it
    // would change and nothing is written until Apply.
    expect(await screen.findByText('Settings this file will change: 2')).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ locationCity: 'Szeged', backgroundDim: 45 }),
    );
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('counts only the settings that differ, and Cancel writes nothing', async () => {
    await import('../i18n/i18n');
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn(async () => {});

    render(<PopupForm settings={baseSettings} onSave={onSave} />);

    const input = await screen.findByLabelText('Import');
    fireEvent.change(input, {
      target: {
        files: [
          backupFile({
            // The same as the current ones: no change, so not counted.
            unsplashQuery: 'landscape',
            selectedCalendars: ['primary'],
            locationCity: 'Szeged',
          }),
        ],
      },
    });

    expect(await screen.findByText('Settings this file will change: 1')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Settings this file will change: 1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('offers nothing to apply for a file that matches the current settings', async () => {
    await import('../i18n/i18n');
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn(async () => {});

    render(<PopupForm settings={baseSettings} onSave={onSave} />);

    fireEvent.change(await screen.findByLabelText('Import'), {
      target: { files: [backupFile({ language: 'en', hiddenWidgets: [] })] },
    });

    expect(await screen.findByText('This file matches your current settings.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reports a file that is not a backup and changes nothing', async () => {
    // The important half: a wrong file must not reach storage. Settings sync
    // across machines, so a bad import is not confined to the device that made it.
    await import('../i18n/i18n');
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn();

    render(<PopupForm settings={baseSettings} onSave={onSave} />);

    const input = await screen.findByLabelText('Import');
    fireEvent.change(input, {
      target: { files: [new File(['nonsense'], 'x.json', { type: 'application/json' })] },
    });

    expect(await screen.findByText(/not a Hub settings backup/i)).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses a backup from a newer version and says why', async () => {
    await import('../i18n/i18n');
    const { PopupForm } = await import('./PopupForm');
    const { BACKUP_VERSION } = await import('../utils/settingsBackup');
    const onSave = vi.fn();

    render(<PopupForm settings={baseSettings} onSave={onSave} />);

    const input = await screen.findByLabelText('Import');
    const newer = JSON.stringify({ version: BACKUP_VERSION + 1, settings: { language: 'hu' } });
    fireEvent.change(input, {
      target: { files: [new File([newer], 'hub-settings.json', { type: 'application/json' })] },
    });

    expect(await screen.findByText(/made by a newer version of Hub/i)).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('strips keys that are not settings before they reach storage', async () => {
    await import('../i18n/i18n');
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn(async () => {});

    render(<PopupForm settings={baseSettings} onSave={onSave} />);

    const input = await screen.findByLabelText('Import');
    fireEvent.change(input, {
      target: { files: [backupFile({ language: 'hu', junk: 'x'.repeat(4000) })] },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ language: 'hu' }));
  });
});

/** The text of whatever `element`'s `aria-describedby` points at. */
const describedText = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ');

describe('PopupForm — accessibility', () => {
  it('shows the active section as a tab panel named by its tab', async () => {
    localStorage.setItem('popup_tab', 'appearance');
    await renderWithStorage();

    const panel = await screen.findByRole('tabpanel', { name: 'Background' });
    expect(screen.getByRole('tab', { name: 'Background' }).getAttribute('aria-controls')).toBe(panel.id);
  });

  it('links a field hint to its control, so it is read with it', async () => {
    localStorage.setItem('popup_tab', 'appearance');
    await renderWithStorage();

    const slider = await screen.findByRole('slider', { name: 'Background dimming' });
    expect(describedText(slider)).toMatch(/hard to read on bright photos/);
  });

  it('groups the background source radios under a named fieldset', async () => {
    localStorage.setItem('popup_tab', 'appearance');
    await renderWithStorage();

    const group = await screen.findByRole('group', { name: 'Background source' });
    expect(group.tagName).toBe('FIELDSET');
    expect(group.querySelectorAll('input[type="radio"]').length).toBeGreaterThan(1);
  });
});
