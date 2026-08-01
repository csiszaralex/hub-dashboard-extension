import { describe, expect, it } from 'vitest';
import { FALLBACK_QUOTES, pickFallbackQuote } from './quoteFallback';

describe('FALLBACK_QUOTES', () => {
  it('has enough entries that a repeat is not obvious', () => {
    expect(FALLBACK_QUOTES.length).toBeGreaterThanOrEqual(20);
  });

  it('has a text and an author for every entry', () => {
    for (const quote of FALLBACK_QUOTES) {
      expect(quote.text.length).toBeGreaterThan(0);
      expect(quote.author.length).toBeGreaterThan(0);
    }
  });
});

describe('pickFallbackQuote', () => {
  it('returns the same quote for the same day', () => {
    expect(pickFallbackQuote('2026-07-30')).toEqual(pickFallbackQuote('2026-07-30'));
  });

  it('returns a different quote on a different day', () => {
    expect(pickFallbackQuote('2026-07-30')).not.toEqual(pickFallbackQuote('2026-07-31'));
  });

  it('always returns one of the bundled quotes', () => {
    expect(FALLBACK_QUOTES).toContainEqual(pickFallbackQuote('2026-12-25'));
  });

  it('handles a malformed date without throwing', () => {
    expect(FALLBACK_QUOTES).toContainEqual(pickFallbackQuote('not-a-date'));
  });
});
