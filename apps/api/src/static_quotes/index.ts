import type { Language, QuoteData } from '@hub/shared';
import { programming } from './programming';

/**
 * A built-in quote list, per language.
 *
 * `Partial` on purpose. Adding a language to `SUPPORTED_LANGUAGES` must not
 * block on someone translating every list — the discovery endpoint reports
 * which languages a source actually has, so an untranslated list simply is not
 * offered in that language. The strictness that does matter is the other way
 * round: a source can never advertise a language it has no quotes for.
 *
 * That is the opposite of the UI strings, where a missing translation *is* a
 * build error — a half-translated interface is worse than a delayed language,
 * while a missing quote list is just one fewer option in a dropdown.
 */
export type StaticQuotes = Partial<Record<Language, QuoteData[]>>;

/**
 * Every built-in list, keyed by the source id it is served under.
 *
 * Registered by hand rather than discovered from the directory: a Cloudflare
 * Worker is a bundle with no filesystem to walk at runtime, so a new file has
 * to be imported somewhere regardless. One line here is that somewhere, and a
 * file nobody registered is visibly absent from this object rather than
 * silently absent from the API.
 */
export const STATIC_QUOTES = {
  programming,
} satisfies Record<string, StaticQuotes>;

export type StaticSourceId = keyof typeof STATIC_QUOTES;

/** The languages a built-in list can actually serve, in `SUPPORTED_LANGUAGES` order. */
export const staticLanguages = (id: StaticSourceId): Language[] =>
  (Object.keys(STATIC_QUOTES[id]) as Language[]).filter(
    (lang) => (STATIC_QUOTES[id][lang]?.length ?? 0) > 0,
  );
