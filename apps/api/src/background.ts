import { BackgroundData, type ErrorBody } from '@hub/shared';
import { Hono } from 'hono';
import { Bindings } from './bindings';
import { BUNDLED_POOL } from './bundledPool';
import { fetchWithTimeout } from './fetchWithTimeout';
import { DEFAULT_POOL_KEY, LAST_GOOD_DEFAULT_POOL_KEY, poolKey, resolveTags } from './tags';
import { Photo, PooledPhoto } from './types';

const POOL_TTL_SECONDS = 3 * 24 * 60 * 60;
const POOL_SIZE = 30;

/**
 * Ceiling on Unsplash API calls per hour, kept below the account's own rate
 * limit. The endpoint is public and the tag list is caller-supplied, so without
 * this a stream of unique tags would drain the quota for every user.
 *
 * The app was approved for Unsplash's production tier, which allows 1000
 * requests per hour; this was 40 while it sat on the demo tier's 50.
 *
 * Deliberately not raised in proportion. Ordinary traffic barely reaches
 * Unsplash at all — a pool is cached in KV for three days per normalised tag
 * set, so a call happens once per distinct tag set per three days, not once per
 * user. The number exists to bound abuse, not to serve demand, and 200 leaves
 * five times the previous headroom while still capping a burst at a fifth of
 * the account's hour. Past it the worker keeps serving the default pool, so the
 * failure mode stays "less variety" rather than "no backgrounds for anyone".
 */
export const HOURLY_UNSPLASH_BUDGET = 200;

/** Attribution parameters required by the Unsplash API guidelines. */
const UTM = 'utm_source=hub&utm_medium=referral';

const withUtm = (url: string): string => {
  if (!url) return '';
  return `${url}${url.includes('?') ? '&' : '?'}${UTM}`;
};

const budgetKey = () => `budget:${new Date().toISOString().slice(0, 13)}`;

/**
 * Claims one Unsplash call from this hour's budget. Returns false when spent.
 *
 * The cap is approximate, not exact. The counter is a read followed by a write
 * on KV, which is eventually consistent: concurrent requests, or requests in
 * different Cloudflare locations, can read the same count and each spend a
 * call, so a burst can overshoot the number. Unsplash's own per-hour rate limit
 * on the account is the hard backstop; this only keeps ordinary abuse well
 * below it.
 *
 * Fails closed: if KV cannot be read or written, the answer is "do not call
 * Unsplash this time". The request still gets a photo from a fallback layer,
 * and an outage must not turn into uncounted spending.
 */
const claimUnsplashCall = async (kv: KVNamespace): Promise<boolean> => {
  try {
    const key = budgetKey();
    const used = Number((await kv.get(key)) ?? '0');
    if (!Number.isFinite(used) || used >= HOURLY_UNSPLASH_BUDGET) return false;

    await kv.put(key, String(used + 1), { expirationTtl: 3600 });
    return true;
  } catch (error) {
    console.error('Unsplash budget check failed:', error);
    return false;
  }
};

const isHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Turns one Unsplash photo into a pool entry, or `null` when it lacks what the
 * response needs: an https image URL and the photographer's name and profile,
 * which the Unsplash guidelines require us to show. A pool is cached for three
 * days, so an entry that cannot be rendered or attributed would be handed out
 * for that long.
 */
const toPooledPhoto = (img: Photo): PooledPhoto | null => {
  const raw = img?.urls?.raw;
  const photographer = img?.user?.name;
  const profile = img?.user?.links?.html || img?.links?.html;
  if (!isHttpsUrl(raw) || typeof photographer !== 'string' || !photographer.trim()) return null;
  if (!isHttpsUrl(profile)) return null;

  const downloadLocation = img.links?.download_location;
  return {
    url: `${raw}&w=3840&q=90&fm=jpg&fit=crop`,
    location: img.location?.name || null,
    photographer,
    photographerUrl: withUtm(profile),
    downloadLocation: isHttpsUrl(downloadLocation) ? downloadLocation : undefined,
  };
};

const fetchPool = async (tags: string, accessKey: string): Promise<PooledPhoto[]> => {
  const unsplashUrl = new URL('https://api.unsplash.com/photos/random');
  unsplashUrl.searchParams.set('count', String(POOL_SIZE));
  unsplashUrl.searchParams.set('query', tags);
  unsplashUrl.searchParams.set('orientation', 'landscape');

  const rawData = await fetchWithTimeout(
    unsplashUrl.toString(),
    async (res): Promise<unknown> => {
      if (!res.ok) throw new Error(`Unsplash API error: ${res.status}`);
      return res.json();
    },
    { headers: { Authorization: `Client-ID ${accessKey}` } },
  );
  if (!Array.isArray(rawData)) throw new Error('Unsplash response is not a list');

  const pool = (rawData as Photo[])
    .map(toPooledPhoto)
    .filter((photo): photo is PooledPhoto => photo !== null);
  // An empty pool is a failed fetch: caching it would mean three days of
  // fallbacks for this tag set without another attempt.
  if (pool.length === 0) throw new Error('No usable photo in Unsplash response');
  return pool;
};

/**
 * Reads one pool from KV. A failed read is a miss, as in `quote.ts`, so the
 * caller moves on to the next layer instead of reaching `app.onError`.
 */
const readPool = async (kv: KVNamespace, key: string): Promise<PooledPhoto[] | null> => {
  try {
    const pool = await kv.get<PooledPhoto[]>(key, 'json');
    return Array.isArray(pool) && pool.length > 0 ? pool : null;
  } catch (error) {
    console.error('Background pool read failed:', error);
    return null;
  }
};

/** Best-effort write: a pool that was fetched is served even if KV refuses it. */
const writePool = async (
  kv: KVNamespace,
  key: string,
  pool: PooledPhoto[],
  options?: KVNamespacePutOptions,
): Promise<void> => {
  try {
    await kv.put(key, JSON.stringify(pool), options);
  } catch (error) {
    console.error('Background pool write failed:', error);
  }
};

/** Fetches and caches a missing pool, or `null` when the budget or Unsplash says no. */
const refillPool = async (
  kv: KVNamespace,
  tags: string,
  key: string,
  accessKey: string,
): Promise<PooledPhoto[] | null> => {
  // Claimed only here, on a miss for this exact tag set: a cached pool costs
  // nothing from the budget.
  if (!(await claimUnsplashCall(kv))) return null;

  let pool: PooledPhoto[];
  try {
    pool = await fetchPool(tags, accessKey);
  } catch (error) {
    console.error(error);
    return null;
  }

  await writePool(kv, key, pool, { expirationTtl: POOL_TTL_SECONDS });
  if (key === DEFAULT_POOL_KEY) {
    // No TTL: this copy is what keeps the route answering when the default
    // pool expires at a moment nothing can refill it.
    await writePool(kv, LAST_GOOD_DEFAULT_POOL_KEY, pool);
  }
  return pool;
};

/**
 * The pool served when a request's own pool is missing and cannot be fetched:
 * the default pool, then the last good copy of it, then `BUNDLED_POOL`.
 * `null` only when all three are empty, which is the one case the route
 * answers 503 — and so the one case `GET /api/health` reports as unhealthy.
 */
export const readFallbackPool = async (
  kv: KVNamespace,
): Promise<readonly PooledPhoto[] | null> =>
  (await readPool(kv, DEFAULT_POOL_KEY)) ??
  (await readPool(kv, LAST_GOOD_DEFAULT_POOL_KEY)) ??
  (BUNDLED_POOL.length > 0 ? BUNDLED_POOL : null);

export const backgroundRoutes = new Hono<{ Bindings: Bindings }>();

backgroundRoutes.get('/api/background', async (c) => {
  const kv = c.env.UNSPLASH_CACHE;
  const tags = resolveTags(c.req.query('tags'));
  const cacheKey = poolKey(tags);

  // Budget spent, Unsplash unavailable or KV down: degrade along the fallback
  // layers rather than failing the new tab page.
  const pool: readonly PooledPhoto[] | null =
    (await readPool(kv, cacheKey)) ??
    (await refillPool(kv, tags, cacheKey, c.env.UNSPLASH_ACCESS_KEY)) ??
    (await readFallbackPool(kv));

  if (!pool) {
    return c.json({ error: 'No background available' } satisfies ErrorBody, 503);
  }

  const { downloadLocation, ...selected } = pool[Math.floor(Math.random() * pool.length)];

  // Unsplash requires a download event whenever a photo is actually used.
  if (downloadLocation) {
    c.executionCtx.waitUntil(
      // Bounded too: `waitUntil` would otherwise hold the invocation open for as
      // long as Unsplash takes to answer a request whose reply nobody reads.
      fetchWithTimeout(downloadLocation, () => Promise.resolve(undefined), {
        headers: { Authorization: `Client-ID ${c.env.UNSPLASH_ACCESS_KEY}` },
      }).catch((error) => console.error('Download ping failed:', error)),
    );
  }

  return c.json(selected satisfies BackgroundData);
});
