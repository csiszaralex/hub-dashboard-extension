import { SUPPORTED_LANGUAGES } from '@hub/shared';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LANGUAGE, detectLanguage, resolveLanguage, toLanguage } from './language';

describe('detectLanguage', () => {
  it('falls back to the default for a browser language the product does not ship', () => {
    expect(detectLanguage(['de-DE', 'fr'])).toBe(DEFAULT_LANGUAGE);
    expect(DEFAULT_LANGUAGE).toBe(SUPPORTED_LANGUAGES[0]);
  });

  it('takes the first supported one, ignoring the region', () => {
    expect(detectLanguage(['de-DE', 'hu-HU', 'en-US'])).toBe('hu');
  });

  it('reads the browser when given nothing', () => {
    vi.stubGlobal('navigator', { language: 'hu-HU', languages: [] });
    expect(detectLanguage()).toBe('hu');
  });
});

describe('resolveLanguage', () => {
  it('keeps a saved language and follows the browser when none is saved', () => {
    vi.stubGlobal('navigator', { language: 'hu', languages: ['hu'] });
    expect(resolveLanguage('en')).toBe('en');
    expect(resolveLanguage('')).toBe('hu');
    // A value from a newer build that knows more languages.
    expect(resolveLanguage('de')).toBe('hu');
  });
});

describe('toLanguage', () => {
  it('narrows whatever i18next reports to a supported language', () => {
    expect(toLanguage('hu-HU')).toBe('hu');
    expect(toLanguage('')).toBe(DEFAULT_LANGUAGE);
    expect(toLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
    expect(toLanguage('cimode')).toBe(DEFAULT_LANGUAGE);
  });
});
