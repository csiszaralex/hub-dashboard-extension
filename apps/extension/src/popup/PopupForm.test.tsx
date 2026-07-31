import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HubSettings } from '../hooks/useSettings';

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
});
