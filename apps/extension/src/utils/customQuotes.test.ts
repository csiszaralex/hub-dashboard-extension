import { describe, expect, it } from 'vitest';
import {
  CUSTOM_QUOTE_SOURCE,
  MAX_CUSTOM_QUOTES,
  parseCustomQuotes,
  pickCustomQuote,
  sanitizeCustomQuotes,
  serializeCustomQuotes,
} from './customQuotes';

describe('parseCustomQuotes', () => {
  it('reads one quote per line, author after a dash', () => {
    // A textarea rather than a repeating form: the whole point of a list is
    // pasting one in, and a row of inputs makes that ten clicks per quote.
    const parsed = parseCustomQuotes('Be one. - Marcus Aurelius\nStay hungry. - Steve Jobs');

    expect(parsed).toEqual([
      { text: 'Be one.', author: 'Marcus Aurelius' },
      { text: 'Stay hungry.', author: 'Steve Jobs' },
    ]);
  });

  it('accepts an en dash and an em dash as well as a hyphen', () => {
    expect(parseCustomQuotes('Be one. — Marcus')[0].author).toBe('Marcus');
    expect(parseCustomQuotes('Be one. – Marcus')[0].author).toBe('Marcus');
  });

  it('keeps a quote that names no author', () => {
    // Attribution is the user's business, not a requirement we impose on them.
    expect(parseCustomQuotes('Just a thought.')).toEqual([
      { text: 'Just a thought.', author: '' },
    ]);
  });

  it('splits on the last separator, so a dash inside the quote survives', () => {
    // Two spaced dashes is the case that distinguishes first-match from
    // last-match. A hyphen inside a word (`Well-being`) needs no help — the
    // surrounding-whitespace requirement already excludes it — so testing only
    // that would prove nothing about which separator is chosen.
    const parsed = parseCustomQuotes('Life is short - and art long - Hippocrates');

    expect(parsed[0]).toEqual({ text: 'Life is short - and art long', author: 'Hippocrates' });
  });

  it('leaves a hyphen inside a word alone', () => {
    expect(parseCustomQuotes('Well-being is a choice - Seneca')[0]).toEqual({
      text: 'Well-being is a choice',
      author: 'Seneca',
    });
  });

  it('ignores blank lines and surrounding whitespace', () => {
    expect(parseCustomQuotes('\n  Be one.  \n\n\n  Stay hungry. \n')).toHaveLength(2);
  });

  it('round-trips through the text form the user edits', () => {
    const text = 'Be one. - Marcus Aurelius\nJust a thought.';

    expect(serializeCustomQuotes(parseCustomQuotes(text))).toBe(text);
  });
});

describe('sanitizeCustomQuotes', () => {
  it('caps the number of quotes', () => {
    // Everything here goes to `chrome.storage.sync`, which allows about 8 KB
    // per item and 100 KB in total across every setting. An unbounded list
    // would not just fail to save — it would take the rest of the settings
    // down with it once the quota was gone.
    const many = Array.from({ length: MAX_CUSTOM_QUOTES + 20 }, (_, i) => ({
      text: `Quote ${i}`,
      author: '',
    }));

    expect(sanitizeCustomQuotes(many)).toHaveLength(MAX_CUSTOM_QUOTES);
  });

  it('caps the length of a single quote', () => {
    const [long] = sanitizeCustomQuotes([{ text: 'x'.repeat(5000), author: 'y'.repeat(500) }]);

    expect(long.text.length).toBeLessThanOrEqual(300);
    expect(long.author.length).toBeLessThanOrEqual(80);
  });

  it('drops entries with no text', () => {
    expect(sanitizeCustomQuotes([{ text: '   ', author: 'Nobody' }])).toEqual([]);
  });

  it('survives values that are not quotes at all', () => {
    // It reaches here from an imported backup as well as from the textarea.
    expect(sanitizeCustomQuotes('not a list')).toEqual([]);
    expect(sanitizeCustomQuotes([null, 42, { text: 'Kept.' }])).toEqual([
      { text: 'Kept.', author: '' },
    ]);
  });
});

describe('pickCustomQuote', () => {
  const quotes = [
    { text: 'One.', author: 'A' },
    { text: 'Two.', author: 'B' },
    { text: 'Three.', author: 'C' },
  ];

  it('gives the same quote all day and a different one tomorrow', () => {
    // A new tab must not reshuffle it: the quote is a fixed point of the day,
    // the way the background image is.
    expect(pickCustomQuote(quotes, '2026-08-24')).toEqual(pickCustomQuote(quotes, '2026-08-24'));

    const week = new Set(
      ['24', '25', '26', '27', '28'].map((d) => pickCustomQuote(quotes, `2026-08-${d}`)?.text),
    );
    expect(week.size).toBeGreaterThan(1);
  });

  it('returns null for an empty list rather than an empty quote', () => {
    expect(pickCustomQuote([], '2026-08-24')).toBeNull();
  });
});

describe('CUSTOM_QUOTE_SOURCE', () => {
  it('is an id the API can never claim', () => {
    // The worker resolves an unknown source to its default, so the two must not
    // collide: this one is answered entirely in the extension and never sent.
    expect(CUSTOM_QUOTE_SOURCE).toBe('custom');
  });
});
