import type { Language, QuoteData } from '@hub/shared';
import { SUPPORTED_LANGUAGES } from '@hub/shared';
import type { Bindings } from './bindings';
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
  resolve: (ctx: ResolveContext) => Promise<QuoteData>;
}

const STOIC_UPSTREAM = 'https://stoic.tekloon.net/stoic-quote';

const stoic: QuoteSource = {
  id: 'stoic',
  // English only: the upstream has no other language, and claiming otherwise
  // would put an option in the popup that returns English whatever is picked.
  languages: ['en'],
  acceptsQuery: false,
  resolve: async () => {
    const res = await fetch(STOIC_UPSTREAM);
    if (!res.ok) throw new Error(`Upstream error: ${res.status}`);

    const raw = (await res.json()) as { data?: { quote?: string; author?: string } };
    const quote = { text: raw.data?.quote ?? '', author: raw.data?.author ?? 'Unknown' };
    if (!quote.text) throw new Error('Upstream response had no quote');
    return quote;
  },
};

/**
 * Picks the day's quote from a fixed list.
 *
 * Indexed by the date rather than at random so the answer is stable: the KV
 * entry is written once per day, and a random pick would mean the first
 * request of the day decides for everyone anyway. Deriving it from the date
 * makes that explicit, and makes the same day give the same quote even if the
 * cache is cleared.
 */
const pickForDay = (quotes: QuoteData[], date: string): QuoteData => {
  const seed = [...date].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return quotes[seed % quotes.length];
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
    return pickForDay(quotes, date);
  },
});

const SOURCES: QuoteSource[] = [
  stoic,
  ...(Object.keys(STATIC_QUOTES) as StaticSourceId[]).map(staticSource),
];

export const DEFAULT_SOURCE_ID = 'stoic';

const BY_ID = new Map(SOURCES.map((source) => [source.id, source]));

/**
 * Resolves a caller-supplied source id to a known source, never to a new one.
 *
 * The endpoint is public and unauthenticated, and the id reaches a KV key. An
 * unrecognised id therefore has to collapse onto the default rather than be
 * passed through — otherwise `?source=<anything>` grows the key space without
 * bound, which is the hole `tags.ts` exists to close on the background route.
 */
export const resolveSource = (id: string | undefined): QuoteSource =>
  BY_ID.get(id ?? '') ?? BY_ID.get(DEFAULT_SOURCE_ID)!;

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
export const describeSources = () =>
  SOURCES.map(({ id, languages, acceptsQuery }) => ({ id, languages, acceptsQuery }));
