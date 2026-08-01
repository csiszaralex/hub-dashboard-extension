import { BackgroundData } from '@hub/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { quoteRoutes } from './quote';
import { DEFAULT_POOL_KEY, poolKey, resolveTags } from './tags';
import { Photo } from './types';

type Bindings = {
  UNSPLASH_CACHE: KVNamespace;
  UNSPLASH_ACCESS_KEY: string; // secretként van felvéve
};

/**
 * Photo as stored in KV. `downloadLocation` is needed to report usage back to
 * Unsplash but is not part of the public response.
 */
interface PooledPhoto extends BackgroundData {
  downloadLocation?: string;
}

const POOL_TTL_SECONDS = 3 * 24 * 60 * 60;
const POOL_SIZE = 30;

/**
 * Ceiling on Unsplash API calls per hour, kept below the account's own rate
 * limit. The endpoint is public and the tag list is caller-supplied, so without
 * this a stream of unique tags would drain the quota for every user.
 */
const HOURLY_UNSPLASH_BUDGET = 40;

/** Attribution parameters required by the Unsplash API guidelines. */
const UTM = 'utm_source=hub&utm_medium=referral';

const withUtm = (url: string): string => {
  if (!url) return '';
  return `${url}${url.includes('?') ? '&' : '?'}${UTM}`;
};

const budgetKey = () => `budget:${new Date().toISOString().slice(0, 13)}`;

/** Claims one Unsplash call from this hour's budget. Returns false when spent. */
const claimUnsplashCall = async (kv: KVNamespace): Promise<boolean> => {
  const key = budgetKey();
  const used = Number((await kv.get(key)) ?? '0');
  if (!Number.isFinite(used) || used >= HOURLY_UNSPLASH_BUDGET) return false;

  await kv.put(key, String(used + 1), { expirationTtl: 3600 });
  return true;
};

const fetchPool = async (tags: string, accessKey: string): Promise<PooledPhoto[]> => {
  const unsplashUrl = new URL('https://api.unsplash.com/photos/random');
  unsplashUrl.searchParams.set('count', String(POOL_SIZE));
  unsplashUrl.searchParams.set('query', tags);
  unsplashUrl.searchParams.set('orientation', 'landscape');

  const res = await fetch(unsplashUrl.toString(), {
    headers: { Authorization: `Client-ID ${accessKey}` },
  });
  if (!res.ok) throw new Error(`Unsplash API error: ${res.status}`);

  const rawData: Photo[] = await res.json();
  return rawData.map((img) => ({
    url: `${img.urls.raw}&w=3840&q=90&fm=jpg&fit=crop`,
    location: img.location?.name || null,
    photographer: img.user?.name || 'Unknown',
    photographerUrl: withUtm(img.user?.links?.html || img.links?.html || ''),
    downloadLocation: img.links?.download_location,
  }));
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());
app.route('/', quoteRoutes);

app.get('/api/background', async (c) => {
  const tags = resolveTags(c.req.query('tags'));
  const cacheKey = poolKey(tags);

  let pool = await c.env.UNSPLASH_CACHE.get<PooledPhoto[]>(cacheKey, 'json');

  if (!pool || pool.length === 0) {
    if (await claimUnsplashCall(c.env.UNSPLASH_CACHE)) {
      try {
        pool = await fetchPool(tags, c.env.UNSPLASH_ACCESS_KEY);
      } catch (error) {
        console.error(error);
        pool = null;
      }
      if (pool?.length) {
        await c.env.UNSPLASH_CACHE.put(cacheKey, JSON.stringify(pool), {
          expirationTtl: POOL_TTL_SECONDS,
        });
      }
    }

    // Budget spent or Unsplash unavailable — degrade to the default pool
    // rather than failing the new tab page.
    if (!pool || pool.length === 0) {
      pool = await c.env.UNSPLASH_CACHE.get<PooledPhoto[]>(DEFAULT_POOL_KEY, 'json');
    }
  }

  if (!pool || pool.length === 0) {
    return c.json({ error: 'No background available' }, 503);
  }

  const { downloadLocation, ...selected } = pool[Math.floor(Math.random() * pool.length)];

  // Unsplash requires a download event whenever a photo is actually used.
  if (downloadLocation) {
    c.executionCtx.waitUntil(
      fetch(downloadLocation, {
        headers: { Authorization: `Client-ID ${c.env.UNSPLASH_ACCESS_KEY}` },
      }).catch((error) => console.error('Download ping failed:', error)),
    );
  }

  return c.json(selected satisfies BackgroundData);
});

export default app;
