import { Hono } from 'hono';
import { readFallbackPool } from './background';
import { Bindings } from './bindings';

/** What `GET /api/health` answers, with 200 when `ok` and 503 when not. */
export interface HealthReport {
  ok: boolean;
  backgrounds: boolean;
}

/**
 * Whether `GET /api/background` has a fallback to serve when Unsplash is down
 * or the hourly budget is spent: the same layers it would try, read the same
 * way (`readFallbackPool`), so this reports 503 exactly when a request whose
 * own pool is missing and cannot be fetched would get one.
 * A KV error counts as a missing layer rather than throwing, because a monitor
 * should see the same outage the users would.
 */
const canServeBackgrounds = async (kv: KVNamespace): Promise<boolean> =>
  (await readFallbackPool(kv)) !== null;

export const healthRoutes = new Hono<{ Bindings: Bindings }>();

/**
 * For an external uptime monitor: at most two KV reads and never an upstream
 * call, so polling it costs neither Unsplash's nor Citatum's allowance.
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
