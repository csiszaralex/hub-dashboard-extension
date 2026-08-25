import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import hu from './locales/hu.json';
import { SUPPORTED_LANGUAGES } from '@hub/shared';

/**
 * Re-exported under the name the popup already uses, but sourced from the
 * shared list rather than from a build-time read of `locales/`. One place now
 * decides what languages exist; `validate.ts` proves a file backs each one.
 */
export const AVAILABLE_LANGUAGES: readonly string[] = SUPPORTED_LANGUAGES;

const autoDetectLanguage = (): string => {
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const lang of preferred) {
    const code = lang.split('-')[0];
    if (AVAILABLE_LANGUAGES.includes(code)) return code;
  }
  return AVAILABLE_LANGUAGES[0] ?? 'en';
};

i18n.use(initReactI18next).init({
  resources: {
    hu: { translation: hu },
    en: { translation: en },
  },
  lng: autoDetectLanguage(),
  fallbackLng: 'hu',
  interpolation: {
    escapeValue: false,
  },
}).then(() => {
  chrome.storage.sync.get('language', (res: { language?: string }) => {
    void i18n.changeLanguage(res.language || autoDetectLanguage());
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.language) {
    const lang = (changes.language.newValue as string | undefined) || autoDetectLanguage();
    void i18n.changeLanguage(lang);
  }
});

export default i18n;
