import type { QuoteData } from '@hub/shared';
import type { Bindings } from './bindings';

const ENDPOINT = 'https://api.citatum.hu/idezet.php';

/**
 * Citatum allows 500 requests a day for free use; past that they ask to be
 * contacted first. Capped below it so a burst degrades to yesterday's cached
 * quote rather than spending the allowance and risking the key being switched
 * off — they reserve the right to do that, and say so.
 *
 * Far tighter than the Unsplash budget in `background.ts`: that one is per
 * hour against 1000, this is per *day* against 500. One normalised category is
 * one call per day, so 450 is 450 distinct categories in use — well beyond
 * anything organic, and the ceiling exists for the case that is not organic.
 */
export const DAILY_CITATUM_BUDGET = 450;

const budgetKey = (date: string) => `citatum:budget:${date}`;
const DAY_SECONDS = 24 * 60 * 60;

/** Claims one call from today's allowance. Returns false when it is spent. */
export const claimCitatumCall = async (kv: KVNamespace, date: string): Promise<boolean> => {
  const key = budgetKey(date);
  const used = Number((await kv.get(key)) ?? '0');
  if (!Number.isFinite(used) || used >= DAILY_CITATUM_BUDGET) return false;

  await kv.put(key, String(used + 1), { expirationTtl: DAY_SECONDS });
  return true;
};

const MAX_CATEGORY_LENGTH = 32;

/**
 * Reduces a caller-supplied category to a canonical, cache-safe form.
 *
 * Accents are folded to their base letter rather than stripped, which is the
 * one thing `normalizeTags` cannot be reused for: its `[^a-z0-9 -]` filter
 * turns `Pénz` into `pnz` and asks Citatum for a word that does not exist.
 * Citatum accepts either spelling — but only if the word survives the trip.
 *
 * The result is part of the KV key, so anything that varies without changing
 * the meaning — case, spacing, punctuation, accents — has to normalise away, or
 * every variant spends a fresh call against a 500-a-day allowance.
 */
export const normalizeCategory = (raw: string | undefined): string =>
  (raw ?? '')
    .normalize('NFD')
    // Combining marks left behind by the decomposition above: é becomes e + ́,
    // and this removes the second half.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CATEGORY_LENGTH)
    .trim();

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Decodes the entities an XML payload escapes.
 *
 * Citatum serves UTF-8 but escapes named HTML entities for accented letters in
 * places, so `&aacute;` has to resolve as well as `&amp;`. Numeric forms are
 * handled directly; anything unrecognised is left as written rather than
 * silently deleted, since a stray `&` in a quote is better than a hole in it.
 */
const decodeEntities = (text: string): string =>
  text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => {
      const lower = name.toLowerCase();
      if (ENTITIES[lower]) return ENTITIES[lower];
      // The accented-letter names Citatum uses follow a pattern: base letter
      // plus the accent's name. `aacute` is á, `ouml` is ö, `udblac` is ű.
      const accent = /^([a-z])(acute|grave|circ|uml|dblac|tilde|ring|cedil|slash)$/i.exec(lower);
      if (!accent) return whole;
      const [, letter, mark] = accent;
      const combining: Record<string, string> = {
        acute: '́',
        grave: '̀',
        circ: '̂',
        uml: '̈',
        dblac: '̋',
        tilde: '̃',
        ring: '̊',
        cedil: '̧',
      };
      const combiner = combining[mark];
      return combiner ? (letter + combiner).normalize('NFC') : whole;
    });

const tagValue = (block: string, tag: string): string => {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return match ? decodeEntities(match[1]).trim() : '';
};

/**
 * Reads the first quote out of a Citatum response.
 *
 * Parsed with regexes rather than a DOM: a Cloudflare Worker has no
 * `DOMParser`, and pulling in an XML library for three fields of a small,
 * machine-generated document is not worth the bundle. The shape is taken from
 * the response example in Citatum's own documentation, which is what the tests
 * use as their fixture.
 *
 * Null when the document holds no usable quote — a narrow category legitimately
 * matches nothing, and that is an empty result rather than an error. Returning
 * an empty-text quote instead would cache a blank widget for the rest of the
 * day.
 */
export const parseCitatumQuote = (xml: string): QuoteData | null => {
  const block = /<idezet>([\s\S]*?)<\/idezet>/.exec(xml);
  if (!block) return null;

  const text = tagValue(block[1], 'idezetszoveg');
  if (!text) return null;

  return {
    text,
    author: tagValue(block[1], 'szerzo') || 'Ismeretlen',
    // Required by Citatum's terms: whatever displays the quote has to link
    // back, and the link belongs to this quote rather than the site in general.
    sourceUrl: tagValue(block[1], 'url') || undefined,
  };
};

/** Builds the upstream request for one random quote, narrowed by category. */
export const citatumUrl = (env: Bindings, category: string): string => {
  const url = new URL(ENDPOINT);
  url.searchParams.set('f', env.CITATUM_USER ?? '');
  url.searchParams.set('j', env.CITATUM_KEY ?? '');
  url.searchParams.set('rendez', 'veletlen');
  if (category) url.searchParams.set('kat', category);
  return url.toString();
};
