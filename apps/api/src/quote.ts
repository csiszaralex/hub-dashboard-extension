import { QuoteData } from '@hub/shared';
import { Hono } from 'hono';
import { Bindings } from './bindings';
import { normalizeCategory } from './citatum';
import { describeSources, resolveLanguage, resolveSource } from './quoteSources';

const QUOTE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Cache key for one source's quote of the day.
 *
 * The source and language are part of the key because they are part of the
 * answer: without them the first request of the day would decide what everyone
 * else got, whichever source it happened to ask for. Both come from closed sets
 * — the source registry and `SUPPORTED_LANGUAGES` — so the key space is bounded
 * by what we ship, not by what a caller sends.
 */
export const quoteCacheKey = (source: string, language: string, isoDate: string, query = '') =>
  `quote:${source}:${language}${query ? `:${query}` : ''}:${isoDate}`;

/**
 * Pointer to this source's newest good quote, for when its upstream is down.
 *
 * Per source and language, not global. A single shared pointer would hand a
 * user who picked one source another source's quote the moment theirs failed —
 * silently, and for as long as the outage lasted.
 */
export const quoteLatestKey = (source: string, language: string) =>
  `quote:${source}:${language}:latest`;

const todayIso = () => new Date().toISOString().split('T')[0];

export const quoteRoutes = new Hono<{ Bindings: Bindings }>();

/** Lets the popup offer only the sources that can serve a given language. */
quoteRoutes.get('/api/quote/sources', (c) => c.json(describeSources(c.env)));

quoteRoutes.get('/api/quote', async (c) => {
  const source = resolveSource(c.req.query('source'), c.env);
  const language = resolveLanguage(source, c.req.query('lang'));
  const date = todayIso();
  // Only for sources that take one, and normalised before it goes anywhere
  // near a cache key — the same discipline `tags.ts` applies to Unsplash tags.
  const query = source.acceptsQuery ? normalizeCategory(c.req.query('q')) : '';

  const key = quoteCacheKey(source.id, language, date, query);
  const latestKey = quoteLatestKey(source.id, language);

  // Check-then-act, not coalesced: a request that misses can race another
  // that is already mid-fetch. Everyone who arrives within that single
  // upstream round-trip — a handful of requests around UTC day rollover, not
  // the whole day — calls upstream independently. Coalescing would need a
  // Durable Object to serialise callers, which is disproportionate here; the
  // blast radius is one round-trip's worth of duplicate calls, not the
  // once-per-user-per-day cost this cache exists to remove.
  try {
    const cached = await c.env.UNSPLASH_CACHE.get<QuoteData>(key, 'json');
    if (cached?.text) return c.json(cached);
  } catch (error) {
    // A KV outage on the read is treated as a cache miss, not a failure —
    // fall through to the source rather than letting it bubble past Hono's
    // handler into a plain-text 500.
    console.error('Day-cache read failed:', error);
  }

  let quote: QuoteData;
  try {
    quote = await source.resolve({ language, query, env: c.env, date });
  } catch (error) {
    console.error(error);

    // Upstreams here are small third-party services; a stale quote beats an
    // empty widget. A built-in source cannot reach this path, which is part of
    // why it is worth having one.
    try {
      const latest = await c.env.UNSPLASH_CACHE.get<QuoteData>(latestKey, 'json');
      if (latest?.text) return c.json(latest);
    } catch (kvError) {
      console.error('Stale-quote read failed:', kvError);
    }

    return c.json({ error: 'No quote available' }, 503);
  }

  // Caching is best-effort: a good quote we just resolved is still the right
  // response even if KV is unavailable to write it, so a put failure must
  // not fall through to the stale/503 path above.
  try {
    const body = JSON.stringify(quote);
    await c.env.UNSPLASH_CACHE.put(key, body, { expirationTtl: QUOTE_TTL_SECONDS });
    await c.env.UNSPLASH_CACHE.put(latestKey, body, { expirationTtl: QUOTE_TTL_SECONDS });
  } catch (error) {
    console.error('Failed to cache fresh quote:', error);
  }

  return c.json(quote);
});
