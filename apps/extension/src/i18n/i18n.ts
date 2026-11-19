import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import hu from './locales/hu.json';
import { SUPPORTED_LANGUAGES } from '@hub/shared';
import { readSettings, type SettingKey } from '../utils/settingsSchema';
import { DEFAULT_LANGUAGE, detectLanguage, resolveLanguage } from './language';

/**
 * Not read through `useSettings`, whose store is reachable only from a React
 * hook, but typed and decoded by the same schema, so a rename fails the build.
 */
const LANGUAGE_KEY = 'language' satisfies SettingKey;

/**
 * Re-exported under the name the popup already uses, but sourced from the
 * shared list rather than from a build-time read of `locales/`. One place now
 * decides what languages exist; `validate.ts` proves a file backs each one.
 */
export const AVAILABLE_LANGUAGES: readonly string[] = SUPPORTED_LANGUAGES;

// Both pages load this module, so this is the one place `lang` follows the
// chosen language: screen readers pick their voice from it, and the static
// `lang="en"` in the HTML read Hungarian text with English pronunciation.
// Registered before `init`, which emits the first `languageChanged` itself.
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

i18n.use(initReactI18next).init({
  resources: {
    hu: { translation: hu },
    en: { translation: en },
  },
  lng: detectLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
}).then(() => {
  chrome.storage.sync.get(LANGUAGE_KEY, (stored) => {
    void i18n.changeLanguage(resolveLanguage(readSettings(stored).language));
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && LANGUAGE_KEY in changes) {
    const { language } = readSettings({ [LANGUAGE_KEY]: changes[LANGUAGE_KEY].newValue });
    void i18n.changeLanguage(resolveLanguage(language));
  }
});

export default i18n;
