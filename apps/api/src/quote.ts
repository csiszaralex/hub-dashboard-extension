import { QuoteData } from '@hub/shared';
import { Hono } from 'hono';
import { Bindings } from './bindings';

const UPSTREAM = 'https://stoic.tekloon.net/stoic-quote';

/** Pointer to the newest successfully cached quote, for use when upstream is down. */
const LATEST_KEY = 'quote:latest';
const QUOTE_TTL_SECONDS = 7 * 24 * 60 * 60;

export const quoteCacheKey = (isoDate: string) => `quote:${isoDate}`;

const todayIso = () => new Date().toISOString().split('T')[0];

export const quoteRoutes = new Hono<{ Bindings: Bindings }>();

quoteRoutes.get('/api/quote', async (c) => {
  const key = quoteCacheKey(todayIso());

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
    // fall through to upstream rather than letting it bubble past Hono's
    // handler into a plain-text 500.
    console.error('Day-cache read failed:', error);
  }

  let quote: QuoteData;
  try {
    const res = await fetch(UPSTREAM);
    if (!res.ok) throw new Error(`Upstream error: ${res.status}`);

    const raw = (await res.json()) as { data?: { quote?: string; author?: string } };
    quote = {
      text: raw.data?.quote ?? '',
      author: raw.data?.author ?? 'Unknown',
    };
    if (!quote.text) throw new Error('Upstream response had no quote');
  } catch (error) {
    console.error(error);

    // Upstream is a one-person service; a stale quote beats an empty widget.
    try {
      const latest = await c.env.UNSPLASH_CACHE.get<QuoteData>(LATEST_KEY, 'json');
      if (latest?.text) return c.json(latest);
    } catch (kvError) {
      console.error('quote:latest read failed:', kvError);
    }

    return c.json({ error: 'No quote available' }, 503);
  }

  // Caching is best-effort: a good quote we just fetched is still the right
  // response even if KV is unavailable to write it, so a put failure must
  // not fall through to the stale/503 path below.
  try {
    const body = JSON.stringify(quote);
    await c.env.UNSPLASH_CACHE.put(key, body, { expirationTtl: QUOTE_TTL_SECONDS });
    await c.env.UNSPLASH_CACHE.put(LATEST_KEY, body, { expirationTtl: QUOTE_TTL_SECONDS });
  } catch (error) {
    console.error('Failed to cache fresh quote:', error);
  }

  return c.json(quote);
});
