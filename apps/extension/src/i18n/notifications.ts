import type { Language } from '@hub/shared';

/** What the service worker says when a Pomodoro phase changes. */
export interface PomodoroNotificationStrings {
  title: string;
  breakStarted: string;
  /** The break ran out and the timer stopped; the next focus waits for the user. */
  breakOver: string;
}

/**
 * The service worker's only strings, kept out of the locale files on purpose.
 *
 * Nothing on the page shows them, and the worker cannot go through
 * `i18n/i18n.ts`: that module installs the `react-i18next` binding, which would
 * drag React into a worker Chrome cold-starts on every alarm, and it applies
 * the saved language one storage round-trip after `init`, so a cold-started
 * worker could notify in the wrong language. Importing `en.json` and `hu.json`
 * directly for these three lines put both whole files into the chunk the
 * worker loads. So they live here, and only here.
 *
 * `Record<Language, …>` ties the map to `SUPPORTED_LANGUAGES`: a language added
 * there without an entry here fails the build naming the missing code, instead
 * of notifying in English while the rest of the interface is translated.
 */
export const POMODORO_NOTIFICATIONS: Record<Language, PomodoroNotificationStrings> = {
  en: {
    title: 'Hub',
    breakStarted: 'Break time — step away.',
    breakOver: 'Break over. Start the next focus when you are ready.',
  },
  hu: {
    title: 'Hub',
    breakStarted: 'Szünet: állj fel egy kicsit.',
    breakOver: 'Vége a szünetnek. Indítsd a következő fókuszt, ha készen állsz.',
  },
};
