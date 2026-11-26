import type { Language } from '@hub/shared';

/**
 * The feedback forms, one per interface language.
 *
 * Tally cannot translate a form's own questions, so each language has its own
 * form with the same questions, hidden fields and logic. `Record<Language, …>`
 * means a language added to `SUPPORTED_LANGUAGES` fails the build until it has
 * one here.
 *
 * Imported by the service worker, so this module must stay free of `window`,
 * `document` and `localStorage`.
 */
const FEEDBACK_FORMS: Record<Language, string> = {
  en: 'https://tally.so/r/rDPPM5',
  hu: 'https://tally.so/r/gbGG2J',
};

/**
 * Where the form was opened from. The form shows different questions for each:
 * `uninstall` asks why Hub was removed, anything else asks what the message is
 * about.
 */
export type FeedbackSource = 'uninstall' | 'popup';

/**
 * The form link with its hidden fields filled in: where it was opened from,
 * the running version and the interface language. Nothing else is sent, and
 * nothing that identifies the user. `privacy-policy.md` lists the same three.
 */
export const feedbackUrl = (source: FeedbackSource, language: Language, version: string): string => {
  const url = new URL(FEEDBACK_FORMS[language]);
  url.searchParams.set('source', source);
  url.searchParams.set('version', version);
  url.searchParams.set('lang', language);
  return url.toString();
};
