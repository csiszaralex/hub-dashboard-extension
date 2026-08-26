import type { Language, QuoteData } from '@hub/shared';
import { SUPPORTED_LANGUAGES } from '@hub/shared';
import type { Bindings } from './bindings';
import { claimCitatumCalls, citatumUrl, parseCitatumQuote } from './citatum';
import { STATIC_QUOTES, staticLanguages, type StaticSourceId } from './static_quotes';

export interface ResolveContext {
  language: Language;
  /** Category or search term, already normalised. Empty when the source takes none. */
  query: string;
  env: Bindings;
  /** The UTC date the answer is being cached under, so a static pick is stable for the day. */
  date: string;
}

export interface QuoteSource {
  id: string;
  /** Languages this source can actually serve — never one it has no content for. */
  languages: readonly Language[];
  /** Whether a caller-supplied category narrows the result. */
  acceptsQuery: boolean;
  /**
   * Whether this deployment can serve the source at all. A source needing
   * credentials the environment does not have is hidden rather than offered and
   * then failing — the popup builds its picker from what this reports.
   */
  isAvailable?: (env: Bindings) => boolean;
  /**
   * The day's pool for this source. One entry is a perfectly good pool — it
   * simply means refresh has nowhere to go for that source.
   */
  resolve: (ctx: ResolveContext) => Promise<QuoteData[]>;
}

const STOIC_UPSTREAM = 'https://stoic.tekloon.net/stoic-quote';

const stoic: QuoteSource = {
  id: 'stoic',
  // English only: the upstream has no other language, and claiming otherwise
  // would put an option in the popup that returns English whatever is picked.
  languages: ['en'],
  acceptsQuery: false,
  // Stays at one. Its upstream returns a single random quote per call with no
  // batch parameter, so a pool would be one request per entry against a
  // one-person service with no SLA — refresh is worth less than that costs.
  resolve: async () => {
    const res = await fetch(STOIC_UPSTREAM);
    if (!res.ok) throw new Error(`Upstream error: ${res.status}`);

    const raw = (await res.json()) as { data?: { quote?: string; author?: string } };
    const quote = { text: raw.data?.quote ?? '', author: raw.data?.author ?? 'Unknown' };
    if (!quote.text) throw new Error('Upstream response had no quote');
    return [quote];
  },
};

/**
 * Rotates a list so a different entry leads each day.
 *
 * The whole list is the pool, so refresh can walk all of it — but which one
 * comes first still has to change daily, and deterministically: a random start
 * would mean the day's first request decided for everyone, since only one
 * ordering is cached.
 */
const rotateForDay = (quotes: QuoteData[], date: string): QuoteData[] => {
  const seed = [...date].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const start = seed % quotes.length;
  return [...quotes.slice(start), ...quotes.slice(0, start)];
};

const staticSource = (id: StaticSourceId): QuoteSource => ({
  id,
  languages: staticLanguages(id),
  acceptsQuery: false,
  resolve: async ({ language, date }) => {
    const quotes = STATIC_QUOTES[id][language];
    // Unreachable through the route, which only offers languages the source
    // advertises — but a resolver that assumes its caller checked is one
    // refactor away from returning undefined to the client.
    if (!quotes?.length) throw new Error(`No ${id} quotes for ${language}`);
    return rotateForDay(quotes, date);
  },
});

/**
 * Hungarian quotes, narrowed by category.
 *
 * The only source that takes a query, and the reason the mechanism has one: a
 * single upstream to keep working, made personal by a parameter, the same shape
 * the background endpoint already uses for Unsplash tags.
 */
/**
 * How many quotes to gather for Citatum's daily pool.
 *
 * Seven single random requests rather than one batched five: `db` caps at five
 * and cannot be combined with `rendez=veletlen`, and the alternative — paging
 * with `honnan` — would need a category's size, which we cannot know. Seven of
 * a 500-a-day allowance per category is affordable; the same few quotes for
 * days is not what a refresh button is for.
 */
const CITATUM_POOL_SIZE = 7;

const citatum: QuoteSource = {
  id: 'citatum',
  languages: ['hu'],
  acceptsQuery: true,
  isAvailable: (env) => Boolean(env.CITATUM_USER && env.CITATUM_KEY),
  resolve: async ({ env, query, date }) => {
    // Their allowance is 500 a day and they reserve the right to switch a key
    // off. Claiming the whole pool up front means the counter can never be
    // fooled by a multi-call fetch, and refusing here sends the route to the
    // stale-quote path — yesterday's quote rather than an allowance we were
    // asked to treat carefully.
    if (!(await claimCitatumCalls(env.UNSPLASH_CACHE, date, CITATUM_POOL_SIZE))) {
      throw new Error('Citatum daily budget spent');
    }

    // In parallel: seven sequential round trips would make the first request
    // of the day visibly slow, and they do not depend on each other.
    const responses = await Promise.allSettled(
      Array.from({ length: CITATUM_POOL_SIZE }, async () => {
        const res = await fetch(citatumUrl(env, query));
        if (!res.ok) throw new Error(`Citatum error: ${res.status}`);
        return parseCitatumQuote(await res.text());
      }),
    );

    // Random picks repeat and a request can fail; four usable quotes out of
    // seven is a pool of four, not an error. Deduplicated by text because the
    // same quote arriving twice would waste a refresh.
    const seen = new Set<string>();
    const pool: QuoteData[] = [];
    for (const result of responses) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      if (seen.has(result.value.text)) continue;
      seen.add(result.value.text);
      pool.push(result.value);
    }

    if (pool.length === 0) throw new Error('Citatum returned no usable quote');
    return pool;
  },
};

const SOURCES: QuoteSource[] = [
  stoic,
  citatum,
  ...(Object.keys(STATIC_QUOTES) as StaticSourceId[]).map(staticSource),
];

export const DEFAULT_SOURCE_ID = 'stoic';

const BY_ID = new Map(SOURCES.map((source) => [source.id, source]));

const isUsable = (source: QuoteSource, env: Bindings) => source.isAvailable?.(env) ?? true;

/**
 * Resolves a caller-supplied source id to a known source, never to a new one.
 *
 * The endpoint is public and unauthenticated, and the id reaches a KV key. An
 * unrecognised id therefore has to collapse onto the default rather than be
 * passed through — otherwise `?source=<anything>` grows the key space without
 * bound, which is the hole `tags.ts` exists to close on the background route.
 */
export const resolveSource = (id: string | undefined, env: Bindings): QuoteSource => {
  const asked = BY_ID.get(id ?? '');
  if (asked && isUsable(asked, env)) return asked;
  return BY_ID.get(DEFAULT_SOURCE_ID)!;
};

/**
 * The language to serve, given what was asked for and what the source has.
 *
 * A source the user deliberately picked wins over a language it cannot serve:
 * choosing a Hungarian-only source with an English interface should give
 * Hungarian quotes, not an error or an empty widget. The popup only offers
 * sources that match, so this is the edge, not the path.
 */
export const resolveLanguage = (source: QuoteSource, requested: string | undefined): Language => {
  const wanted = (SUPPORTED_LANGUAGES as readonly string[]).includes(requested ?? '')
    ? (requested as Language)
    : undefined;

  if (wanted && source.languages.includes(wanted)) return wanted;
  return source.languages[0];
};

/** What `GET /api/quote/sources` reports, so the popup can build its picker. */
export const describeSources = (env: Bindings) =>
  SOURCES.filter((source) => isUsable(source, env)).map(({ id, languages, acceptsQuery }) => ({
    id,
    languages,
    acceptsQuery,
  }));
