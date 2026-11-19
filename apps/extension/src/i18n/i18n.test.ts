import { describe, expect, it, vi } from 'vitest';

describe('i18n — document language', () => {
  // Screen readers choose their voice from `lang`, and both HTML files ship a
  // static `lang="en"`, so Hungarian text was read with English pronunciation.
  it('sets the page language on load and follows every change', async () => {
    document.documentElement.lang = 'xx';
    const i18n = (await import('./i18n')).default;

    // `init` with inline resources still finishes on a later tick.
    await vi.waitFor(() => expect(i18n.isInitialized).toBe(true));
    expect(document.documentElement.lang).toBe(i18n.language);

    await i18n.changeLanguage('hu');
    expect(document.documentElement.lang).toBe('hu');

    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
  });
});
