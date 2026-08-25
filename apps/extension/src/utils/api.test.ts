import { describe, expect, it } from 'vitest';
import { backgroundRequestUrl, quoteRequestUrl } from './api';

describe('quoteRequestUrl', () => {
  it('asks for the chosen source in the interface language', () => {
    const url = new URL(quoteRequestUrl('citatum', 'hu', ''));

    expect(url.searchParams.get('source')).toBe('citatum');
    expect(url.searchParams.get('lang')).toBe('hu');
  });

  it('passes a category through when one is set', () => {
    expect(new URL(quoteRequestUrl('citatum', 'hu', 'Pénz')).searchParams.get('q')).toBe('Pénz');
  });

  it('omits an empty category rather than sending a blank parameter', () => {
    // A `q=` on the wire would be a second spelling of "no category" and, if
    // the worker ever keyed on the raw value, a second cache entry for it.
    expect(new URL(quoteRequestUrl('stoic', 'en', '')).searchParams.has('q')).toBe(false);
  });

  it('leaves the background builder alone', () => {
    expect(new URL(backgroundRequestUrl('forest')).searchParams.get('tags')).toBe('forest');
  });
});
