import type { QuoteData } from '@hub/shared';
import type { HubSettings } from '../hooks/useSettings';

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
 * That store allows 8192 bytes per item (`QUOTA_BYTES_PER_ITEM`) and 102400
 * across every setting combined (`QUOTA_BYTES`), and it syncs to the user's
 * other machines. Chrome refuses a whole `set` call when any one item in it is
 * over quota, so an oversized list does not merely fail to save itself: every
 * other setting in the same Apply is lost with it.
 *
 * The count and length caps alone do not keep the list inside that: fifty
 * quotes at full length are well over 8 KB, and more again in accented text,
 * where a letter takes two bytes. So the list is also held to a byte budget
 * (`CUSTOM_QUOTES_BUDGET_BYTES`), and it is the budget that decides how many
 * quotes a long list keeps. The caps stay, so a paste of a whole book is cut
 * predictably at the edit rather than measured line by line.
 */
export const MAX_CUSTOM_QUOTES = 50;
const MAX_TEXT_LENGTH = 300;
const MAX_AUTHOR_LENGTH = 80;

/** The setting the list is stored under: part of what Chrome counts. */
const CUSTOM_QUOTES_KEY = 'customQuotes' satisfies keyof HubSettings;

/**
 * Bytes the list may take in `chrome.storage.sync`, key included.
 *
 * A full kilobyte below Chrome's 8192-byte per-item limit. `syncItemBytes`
 * follows the serialiser Chrome measures with as far as it is known, but that
 * is Chromium's own JSON writer, not `JSON.stringify`, and its escaping is
 * free to change between releases; a list that fitted to the byte would be
 * the first to break when it does.
 */
export const CUSTOM_QUOTES_BUDGET_BYTES = 7168;

const utf8 = new TextEncoder();

/**
 * Characters Chromium's JSON writer escapes and `JSON.stringify` does not.
 * Chromium writes each as a six-byte unicode escape: `<` is one byte in
 * `JSON.stringify`'s output, the line and paragraph separators (U+2028,
 * U+2029) three. Counted so a quote full of them cannot slip past the budget
 * on the strength of the margin alone. Built from code points so the source
 * holds no invisible characters.
 */
const CHROME_ONLY_ESCAPES = new RegExp(
  `[<${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`,
  'g',
);

/**
 * What `chrome.storage.sync` counts against its per-item quota for one item:
 * the UTF-8 length of the key plus that of the value's JSON, as Chrome writes
 * it.
 */
export const syncItemBytes = (key: string, value: unknown): number => {
  const json = JSON.stringify(value) ?? '';
  let extra = 0;
  for (const [char] of json.matchAll(CHROME_ONLY_ESCAPES)) extra += char === '<' ? 5 : 3;
  return utf8.encode(key).length + utf8.encode(json).length + extra;
};

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
 * Bounds a list before it reaches storage, and says how much was cut.
 *
 * Reached from the textarea and from an imported backup, so it takes `unknown`
 * and never assumes its input is a list of quotes — the same posture
 * `settingsBackup` takes towards a file.
 *
 * Quotes are kept in order while they fit, and everything from the first one
 * that does not is dropped — not skipped over in search of a shorter one
 * further down, which would keep a list the user cannot predict from what
 * they typed. `dropped` counts the usable quotes that did not make it, so the
 * popup can say so instead of losing them silently.
 */
export const fitCustomQuotes = (value: unknown): { kept: QuoteData[]; dropped: number } => {
  if (!Array.isArray(value)) return { kept: [], dropped: 0 };

  const candidates = value
    .filter((entry): entry is Partial<QuoteData> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      text: typeof entry.text === 'string' ? entry.text.trim().slice(0, MAX_TEXT_LENGTH) : '',
      author:
        typeof entry.author === 'string' ? entry.author.trim().slice(0, MAX_AUTHOR_LENGTH) : '',
    }))
    .filter((entry) => entry.text.length > 0);

  // Counted the way the stored array serialises: the key and `[]`, then each
  // quote, with a comma before every one but the first.
  const kept: QuoteData[] = [];
  let bytes = syncItemBytes(CUSTOM_QUOTES_KEY, []);
  for (const quote of candidates) {
    if (kept.length === MAX_CUSTOM_QUOTES) break;
    const next = bytes + syncItemBytes('', quote) + (kept.length > 0 ? 1 : 0);
    if (next > CUSTOM_QUOTES_BUDGET_BYTES) break;
    kept.push(quote);
    bytes = next;
  }

  return { kept, dropped: candidates.length - kept.length };
};

/** The list `fitCustomQuotes` keeps: what every path to storage writes. */
export const sanitizeCustomQuotes = (value: unknown): QuoteData[] => fitCustomQuotes(value).kept;

/**
 * The day's quote from the user's list.
 *
 * Derived from the date rather than random, for the same reason the worker's
 * built-in sources are: the quote is a fixed point of the day. A random pick
 * would reshuffle on every new tab, which reads as a glitch rather than a
 * feature.
 */
export const pickCustomQuote = (
  quotes: QuoteData[],
  isoDate: string,
  offset = 0,
): QuoteData | null => {
  if (quotes.length === 0) return null;
  const seed = [...isoDate].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return quotes[(seed + offset) % quotes.length];
};
