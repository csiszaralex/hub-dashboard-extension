import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '../i18n/locales/en.json';
import hu from '../i18n/locales/hu.json';
import { installChromeStub } from '../test/chromeStub';
import { warmUp } from '../test/warmUp';

warmUp(() => Promise.all([import('../i18n/i18n'), import('./Popup')]));

const renderPopupIn = async (language: 'en' | 'hu') => {
  installChromeStub().seedSync({ language });
  const i18n = (await import('../i18n/i18n')).default;
  await waitFor(() => expect(i18n.language).toBe(language));
  const { Popup } = await import('./Popup');
  render(<Popup />);
};

describe('Popup — feedback link', () => {
  it('opens the form in the interface language, in a new tab', async () => {
    await renderPopupIn('hu');

    const link = await screen.findByRole('link', { name: hu.popup.feedback });
    const url = new URL(link.getAttribute('href') ?? '');
    expect(url.origin + url.pathname).toBe('https://tally.so/r/gbGG2J');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      source: 'popup',
      version: '0.0.0-test',
      lang: 'hu',
    });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('uses the English form for English', async () => {
    await renderPopupIn('en');

    const link = await screen.findByRole('link', { name: en.popup.feedback });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/tally\.so\/r\/rDPPM5\?/);
  });
});
