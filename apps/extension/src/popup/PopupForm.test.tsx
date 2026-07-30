import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HubSettings } from '../hooks/useSettings';

const baseSettings: HubSettings = {
  unsplashQuery: 'landscape',
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
});
