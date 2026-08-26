import type { QuoteData } from '@hub/shared';

/**
 * Source id for the user's own list.
 *
 * Answered entirely in the extension and never sent to the worker, which would
 * resolve an unknown source to its default anyway. It sits in the same setting
 * as the API's source ids so the picker stays one control rather than a source
 * dropdown plus a separate "or use my own" switch.
 */
export const CUSTOM_QUOTE_SOURCE = 'custom';

/**
 * Bounds on what can be stored, in place because this lives in
 * `chrome.storage.sync`.
 *
 * That store allows roughly 8 KB per item and 100 KB across every setting
 * combined, and it syncs to the user's other machines. An unbounded list would
 * not merely fail to save: it would exhaust the quota and take the rest of the
 * settings down with it, on every device.
 *
 * Fifty quotes of 300 characters is about 15 KB before JSON overhead — over the
 * per-item limit on paper, but the realistic list is a handful of favourites,
 * and the caps exist so a paste of a whole book fails predictably at the edit
 * rather than unpredictably at the write.
 */
export const MAX_CUSTOM_QUOTES = 50;
const MAX_TEXT_LENGTH = 300;
const MAX_AUTHOR_LENGTH = 80;

/** Hyphen, en dash and em dash — whichever the user's keyboard or paste produced. */
const AUTHOR_SEPARATOR = /\s+[-–—]\s+(?=[^-–—]*$)/;

/**
 * Reads the textarea into quotes: one per line, the author after the last dash.
 *
 * A textarea rather than a repeating form, because the point of a list is being
 * able to paste one in. Splitting on the *last* dash keeps `Well-being is a
 * choice - Seneca` intact, which a first-match split would cut in half.
 *
 * A line with no dash is a quote with no author. Attribution is the user's
 * business; refusing the line would be the extension having an opinion about
 * someone's own notes.
 */
export const parseCustomQuotes = (text: string): QuoteData[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = AUTHOR_SEPARATOR.exec(line);
      if (!match) return { text: line, author: '' };
      return {
        text: line.slice(0, match.index).trim(),
        author: line.slice(match.index + match[0].length).trim(),
      };
    });

/** Back to the text the user edits, so the textarea round-trips. */
export const serializeCustomQuotes = (quotes: QuoteData[]): string =>
  quotes.map((q) => (q.author ? `${q.text} - ${q.author}` : q.text)).join('\n');

/**
 * Bounds a list before it reaches storage.
 *
 * Reached from the textarea and from an imported backup, so it takes `unknown`
 * and never assumes its input is a list of quotes — the same posture
 * `settingsBackup` takes towards a file.
 */
export const sanitizeCustomQuotes = (value: unknown): QuoteData[] => {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is Partial<QuoteData> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      text: typeof entry.text === 'string' ? entry.text.trim().slice(0, MAX_TEXT_LENGTH) : '',
      author:
        typeof entry.author === 'string' ? entry.author.trim().slice(0, MAX_AUTHOR_LENGTH) : '',
    }))
    .filter((entry) => entry.text.length > 0)
    .slice(0, MAX_CUSTOM_QUOTES);
};

/**
 * The day's quote from the user's list.
 *
 * Derived from the date rather than random, for the same reason the worker's
 * built-in sources are: the quote is a fixed point of the day. A random pick
 * would reshuffle on every new tab, which reads as a glitch rather than a
 * feature.
 */
export const pickCustomQuote = (quotes: QuoteData[], isoDate: string): QuoteData | null => {
  if (quotes.length === 0) return null;
  const seed = [...isoDate].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return quotes[seed % quotes.length];
};
