import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Photo } from './types';

type Bindings = {
  UNSPLASH_CACHE: KVNamespace;
  UNSPLASH_ACCESS_KEY: string; // Ezt secretként fogjuk felvenni
};

interface BackgroundData {
  url: string;
  location: string | null;
  photographer: string;
  photographerUrl: string;
}

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());

app.get('/api/background', async (c) => {
  const rawTags = c.req.query('tags') || 'landscape,nature';
  const normalizedTags = rawTags
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');

  const cacheKey = `pool:${normalizedTags}`;
  let pool = await c.env.UNSPLASH_CACHE.get<BackgroundData[]>(cacheKey, 'json');

  // 3. Cache Miss: Új pool lekérése az Unsplash-től
  if (!pool || pool.length === 0) {
    const unsplashUrl = new URL('https://api.unsplash.com/photos/random');
    unsplashUrl.searchParams.set('count', '30');
    unsplashUrl.searchParams.set('query', normalizedTags);
    unsplashUrl.searchParams.set('orientation', 'landscape');

    const res = await fetch(unsplashUrl.toString(), {
      headers: {
        Authorization: `Client-ID ${c.env.UNSPLASH_ACCESS_KEY}`,
      },
    });
    if (!res.ok) {
      return c.json({ error: 'Unsplash API hiba' }, res.status as any);
    }
    const rawData: Photo[] = await res.json();
    pool = rawData.map((img) => ({
      url: `${img.urls.raw}&w=3840&q=90&fm=jpg&fit=crop`,
      location: img.location?.name || null,
      photographer: img.user?.name || 'Ismeretlen',
      photographerUrl: img.links?.html || '',
    }));
    await c.env.UNSPLASH_CACHE.put(cacheKey, JSON.stringify(pool), {
      expirationTtl: 3 * 24 * 60 * 60, // 3 nap
    });
  }

  const randomIndex = Math.floor(Math.random() * pool.length);
  const selectedImage = pool[randomIndex];

  return c.json(selectedImage);
});

export default app;
