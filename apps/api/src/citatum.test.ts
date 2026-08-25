import { describe, expect, it } from 'vitest';
import { normalizeCategory, parseCitatumQuote } from './citatum';

/** Copied from the response example in Citatum's own API documentation. */
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<idezetek>
<idezet>
<idezetszoveg>Üres fejjel lehet megélni, üres gyomorral nem.</idezetszoveg>
<szerzo>Móra Ferenc</szerzo>
<kategoria>Pénz</kategoria>
<kategoria>Humor</kategoria>
<kedvenc>63</kedvenc>
<id>5073</id>
<url>https://www.citatum.hu/idezet/5073</url>
</idezet>
<idezet>
<idezetszoveg>Pénz kell-e? izzadj; járj utána, s lesz.</idezetszoveg>
<szerzo>Vörösmarty Mihály</szerzo>
<id>6047</id>
<url>https://www.citatum.hu/idezet/6047</url>
</idezet>
</idezetek>`;

describe('parseCitatumQuote', () => {
  it('reads the first quote out of the documented response', () => {
    expect(parseCitatumQuote(SAMPLE)).toEqual({
      text: 'Üres fejjel lehet megélni, üres gyomorral nem.',
      author: 'Móra Ferenc',
      sourceUrl: 'https://www.citatum.hu/idezet/5073',
    });
  });

  it('keeps the quote and its own url together', () => {
    // The link back is required by Citatum's terms and is per quote, so pairing
    // it with the wrong entry would credit the wrong page.
    const secondOnly = SAMPLE.replace(/<idezet>[\s\S]*?<\/idezet>\s*/, '');

    expect(parseCitatumQuote(secondOnly)?.sourceUrl).toBe('https://www.citatum.hu/idezet/6047');
  });

  it('decodes the entities an XML payload escapes', () => {
    const escaped = `<idezetek><idezet><idezetszoveg>Sok&aacute;ig &quot;v&aacute;rt&quot; &amp; ment</idezetszoveg><szerzo>A &amp; B</szerzo><url>https://www.citatum.hu/idezet/1</url></idezet></idezetek>`;

    expect(parseCitatumQuote(escaped)).toMatchObject({
      text: 'Sokáig "várt" & ment',
      author: 'A & B',
    });
  });

  it('returns null when the category matched nothing', () => {
    // A narrow category legitimately has no quotes; that is an empty result, not
    // an error, and must not be cached as a quote with empty text.
    expect(parseCitatumQuote('<?xml version="1.0"?><idezetek></idezetek>')).toBeNull();
    expect(parseCitatumQuote('')).toBeNull();
  });

  it('returns null for an entry with no quote text', () => {
    const textless = `<idezetek><idezet><szerzo>Valaki</szerzo><url>https://x</url></idezet></idezetek>`;

    expect(parseCitatumQuote(textless)).toBeNull();
  });
});

describe('normalizeCategory', () => {
  it('folds accents to their base letter rather than dropping them', () => {
    // `Pénz` must become `penz`, not `pnz`. Citatum accepts either spelling, but
    // only if the word survives — and this string becomes part of a cache key,
    // so `Pénz` and `penz` have to collapse onto one entry.
    expect(normalizeCategory('Pénz')).toBe('penz');
    expect(normalizeCategory('SZERELEM')).toBe('szerelem');
    expect(normalizeCategory('Búcsú')).toBe('bucsu');
  });

  it('collapses spacing and strips punctuation', () => {
    expect(normalizeCategory('  élet  és   halál!  ')).toBe('elet es halal');
  });

  it('caps the length so the key space stays bounded', () => {
    expect(normalizeCategory('a'.repeat(100)).length).toBeLessThanOrEqual(32);
  });

  it('returns an empty string for input with nothing usable in it', () => {
    // Which the source reads as "no category" and asks for a random quote,
    // rather than writing a cache entry for punctuation.
    expect(normalizeCategory('@@@')).toBe('');
    expect(normalizeCategory('')).toBe('');
    expect(normalizeCategory(undefined)).toBe('');
  });
});
