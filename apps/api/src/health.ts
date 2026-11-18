import { Hono } from 'hono';
import { Bindings } from './bindings';
import { DEFAULT_POOL_KEY } from './tags';

/** What `GET /api/health` answers, with 200 when `ok` and 503 when not. */
export interface HealthReport {
  ok: boolean;
  backgrounds: boolean;
}

/**
 * Whether the default pool is there to fall back on.
 *
 * That pool is what `GET /api/background` serves when Unsplash is down or the
 * hourly budget is spent; without it those cases answer 503. A KV error counts
 * as unhealthy rather than throwing, because a monitor should see the same
 * outage the users would.
 */
const canServeBackgrounds = async (kv: KVNamespace): Promise<boolean> => {
  try {
    const pool = await kv.get<unknown[]>(DEFAULT_POOL_KEY, 'json');
    return Array.isArray(pool) && pool.length > 0;
  } catch (error) {
    console.error('Health check KV read failed:', error);
    return false;
  }
};

export const healthRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * For an external uptime monitor: one KV read and never an upstream call, so
 * polling it costs neither Unsplash's nor Citatum's allowance.
 *
 * Quotes are not reported. The built-in sources answer from the bundle with no
 * upstream and no KV, so "can serve quotes" is true whenever the worker runs at
 * all, and checking the real upstreams would mean calling them.
 */
healthRoutes.get('/api/health', async (c) => {
  const backgrounds = await canServeBackgrounds(c.env.UNSPLASH_CACHE);
  const report: HealthReport = { ok: backgrounds, backgrounds };

  // A cached "ok" would hide the outage the monitor is polling for.
  c.header('Cache-Control', 'no-store');
  return c.json(report, report.ok ? 200 : 503);
});
