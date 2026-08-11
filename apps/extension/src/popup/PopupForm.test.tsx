import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubSettings } from '../hooks/useSettings';
import { installChromeStub, type ChromeStub } from '../test/chromeStub';
import { runningPomodoro } from '../test/pomodoroState';
import { DEFAULT_WORK_MINUTES } from '../utils/pomodoro';
import { POMODORO_STATE_KEY } from '../utils/pomodoroState';

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
};

describe('PopupForm', () => {
  it('clamps a corrupt stored backgroundDim before showing it in the dim hint', async () => {
    // The dim field only renders on the appearance tab; force it open before mounting.
    localStorage.setItem('popup_tab', 'appearance');
    const { PopupForm } = await import('./PopupForm');

    render(
      <PopupForm
        initialSettings={{ ...baseSettings, backgroundDim: Number.NaN }}
        onSave={() => {}}
      />,
    );

    const slider = await screen.findByRole('slider');
    const hint = slider.parentElement?.querySelector('p');

    expect(hint?.textContent).not.toMatch(/NaN/);
    expect(hint?.textContent).toMatch(/30/);
  });

  it('swaps the Unsplash tag field for the upload control when the source radio changes', async () => {
    localStorage.setItem('popup_tab', 'appearance');
    const { PopupForm } = await import('./PopupForm');

    render(<PopupForm initialSettings={baseSettings} onSave={() => {}} />);

    expect(screen.queryByLabelText('Appearance & Background')).not.toBeNull();
    expect(screen.queryByLabelText('Choose an image')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'My own image' }));

    expect(screen.queryByLabelText('Appearance & Background')).toBeNull();
    expect(screen.queryByLabelText('Choose an image')).not.toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Unsplash photos' }));

    expect(screen.queryByLabelText('Appearance & Background')).not.toBeNull();
    expect(screen.queryByLabelText('Choose an image')).toBeNull();
  });

  it('rejects a non-image upload and reports the error under the upload field', async () => {
    localStorage.setItem('popup_tab', 'appearance');
    const { PopupForm } = await import('./PopupForm');
    // Built outside the JSX: i18next/no-literal-string flags string literals inside
    // JSX attribute expressions too, not just rendered text.
    const customSettings: HubSettings = { ...baseSettings, backgroundSource: 'custom' };

    render(<PopupForm initialSettings={customSettings} onSave={() => {}} />);

    const fileInput = screen.getByLabelText('Choose an image');
    const notAnImage = new File(['plain text'], 'notes.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [notAnImage] } });

    expect(await screen.findByText('That file is not an image.')).not.toBeNull();
  });

  it('stores a valid image end to end: no error, source ends up custom, image is retrievable', async () => {
    localStorage.setItem('popup_tab', 'appearance');
    const { PopupForm } = await import('./PopupForm');
    const customSettings: HubSettings = { ...baseSettings, backgroundSource: 'custom' };
    const onSave = vi.fn();

    render(<PopupForm initialSettings={customSettings} onSave={onSave} />);

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

    // No error text anywhere under the upload field for a legitimate image.
    const hint = fileInput.parentElement?.querySelector('p');
    expect(hint?.textContent).toBe('Stored on this device only.');

    // The source is saveable as custom — submitting must not be blocked by the
    // "no image stored" guard, and the saved payload reports the custom source.
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ backgroundSource: 'custom' });
  });

  it('blocks saving the custom source when no image was ever uploaded', async () => {
    localStorage.setItem('popup_tab', 'appearance');
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn();

    render(<PopupForm initialSettings={baseSettings} onSave={onSave} />);

    // Selecting the radio directly, without going through handleUpload, is exactly
    // the gap the hook-level fix also has to tolerate: nothing has been stored yet.
    fireEvent.click(screen.getByRole('radio', { name: 'My own image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));

    expect(await screen.findByText('Choose an image before saving this option.')).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('falls back to the default focus length when emptied, even after switching away from its tab', async () => {
    localStorage.setItem('popup_tab', 'pomodoro');
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn();

    render(<PopupForm initialSettings={baseSettings} onSave={onSave} />);

    // Clearing the field yields an empty string. `clampPomodoroMinutes`
    // treats "nothing entered" as distinct from a deliberate `0` and falls
    // back to the default, rather than clamping up to the one-minute floor.
    fireEvent.change(screen.getByLabelText('Focus length (minutes)'), { target: { value: '' } });

    // The `pomodoro` tab's input unmounts on tab switch; its React state does
    // not reset, so submitting later must still see (and fall back for) that
    // emptied value.
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ pomodoroWorkMinutes: DEFAULT_WORK_MINUTES });
  });

  it('saves the default focus length, not 1, when the field is emptied and submitted', async () => {
    localStorage.setItem('popup_tab', 'pomodoro');
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn();

    // Start from a value that is neither the default nor the minimum, so a
    // pass caused by "value happens to be unchanged" or "value happens to be
    // 1 already" can't masquerade as the fallback actually firing.
    render(
      <PopupForm initialSettings={{ ...baseSettings, pomodoroWorkMinutes: 40 }} onSave={onSave} />,
    );

    fireEvent.change(screen.getByLabelText('Focus length (minutes)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply settings' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ pomodoroWorkMinutes: DEFAULT_WORK_MINUTES });
  });

  it('lets the focus length be cleared and retyped without a leading zero', async () => {
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn();
    render(
      <PopupForm initialSettings={{ ...baseSettings, pomodoroWorkMinutes: 25 }} onSave={onSave} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /focus/i }));
    const input = screen.getByLabelText(/focus length/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: '3' } });
    expect(input.value).toBe('3');
  });
});

/**
 * The Focus tab is the only place these controls exist once the widget is
 * hidden, and hiding the widget no longer stops the timer — the service worker
 * owns it now. Every test here drives the real form, because two of the three
 * ways this can break (a button that submits the form, a command that waits for
 * "Apply settings") are properties of the button's place in the form rather
 * than of the controls themselves.
 */
describe('PopupForm — Focus session controls', () => {
  let chromeStub: ChromeStub;

  beforeEach(() => {
    // Re-installed to get a handle on it: the shared setup installs a stub but
    // keeps the seeding and inspection helpers to itself.
    chromeStub = installChromeStub();
    localStorage.setItem('popup_tab', 'pomodoro');
  });

  it('sends start to the worker on click, without submitting the form', async () => {
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn();

    render(<PopupForm initialSettings={baseSettings} onSave={onSave} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    // The command travels immediately, on its own, and nothing else does.
    await waitFor(() => expect(chromeStub.sentMessages()).toEqual([{ type: 'pomodoro/start' }]));
    // A <button> in a <form> submits unless it says otherwise; if this one did,
    // pressing Start would silently save every field on the form with it.
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sends reset to the worker on click, without submitting the form', async () => {
    chromeStub.seedLocal({ [POMODORO_STATE_KEY]: runningPomodoro('work', 90_000) });
    const { PopupForm } = await import('./PopupForm');
    const onSave = vi.fn();

    render(<PopupForm initialSettings={baseSettings} onSave={onSave} />);

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

    render(<PopupForm initialSettings={baseSettings} onSave={() => {}} />);

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

    render(<PopupForm initialSettings={hidden} onSave={() => {}} />);

    expect(await screen.findByRole('button', { name: 'Reset' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Start' })).not.toBeNull();
  });

  it('mounts nothing timer-related while another tab is open', async () => {
    // `usePomodoro` subscribes to storage and pings the worker on mount. A
    // popup opened on General has no business doing either.
    localStorage.setItem('popup_tab', 'general');
    chromeStub.seedLocal({ [POMODORO_STATE_KEY]: runningPomodoro('work', 60_000) });
    const { PopupForm } = await import('./PopupForm');

    render(<PopupForm initialSettings={baseSettings} onSave={() => {}} />);
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeNull());

    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(chromeStub.sentMessages()).toEqual([]);
  });
});
