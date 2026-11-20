import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Language } from '@hub/shared';
import en from './locales/en.json';
import hu from './locales/hu.json';
import { installChromeStub } from '../test/chromeStub';
import { warmUp } from '../test/warmUp';

warmUp(() =>
  Promise.all([import('./i18n'), import('../App'), import('../popup/Popup')]),
);

const LOCALES: Record<Language, typeof en> = { en, hu };

/**
 * A key i18next could not resolve is printed as itself (`weather.windSpeed`).
 * Matching on the top-level sections rather than on the keys the locale files
 * hold also catches a key the code asks for that no file has any more.
 */
const RAW_KEY = new RegExp(`\\b(?:${Object.keys(en).join('|')})\\.[A-Za-z0-9_.]+`, 'g');

/** Attributes that carry translated text without it being in `textContent`. */
const TEXT_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt', 'aria-description'];

const rawKeysOnPage = (): string[] => {
  // Text node by text node: `body.textContent` runs neighbouring elements
  // together ("Visible widgetswidgets.clock"), which hides the word boundary.
  const texts: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    texts.push(node.nodeValue ?? '');
  }
  for (const attribute of TEXT_ATTRIBUTES) {
    document.body.querySelectorAll(`[${attribute}]`).forEach((element) => {
      texts.push(element.getAttribute(attribute) ?? '');
    });
  }
  return texts.flatMap((text) => text.match(RAW_KEY) ?? []);
};

/** Seeds the stored language and waits until i18next has switched to it. */
const loadIn = async (language: Language) => {
  installChromeStub().seedSync({ language });
  const i18n = (await import('./i18n')).default;
  await waitFor(() => expect(i18n.language).toBe(language));
};

describe('i18n — no raw translation keys', () => {
  it('recognises a raw key', () => {
    expect('Wind: weather.windSpeed'.match(RAW_KEY)).toEqual(['weather.windSpeed']);
  });

  it.each(Object.keys(LOCALES) as Language[])('the main page in %s', async (language) => {
    await loadIn(language);
    const App = (await import('../App')).default;

    render(<App />);
    await screen.findByRole('button', { name: LOCALES[language].app.openSettings });

    expect(document.documentElement.lang).toBe(language);
    expect(rawKeysOnPage()).toEqual([]);
  });

  it.each(Object.keys(LOCALES) as Language[])('every popup tab in %s', async (language) => {
    await loadIn(language);
    const { Popup } = await import('../popup/Popup');

    render(<Popup />);
    await screen.findByRole('tab', { name: LOCALES[language].popup.tabGeneral });

    for (const tab of screen.getAllByRole('tab')) {
      fireEvent.click(tab);
      expect(tab.getAttribute('aria-selected')).toBe('true');      expect(rawKeysOnPage(), `on the ${tab.textContent} tab`).toEqual([]);
    }
  });
});
