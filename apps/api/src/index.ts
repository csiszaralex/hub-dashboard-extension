import type { ErrorBody } from '@hub/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { backgroundRoutes } from './background';
import { Bindings } from './bindings';
import { healthRoutes } from './health';
import { quoteRoutes } from './quote';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());
app.route('/', quoteRoutes);
app.route('/', backgroundRoutes);
app.route('/', healthRoutes);

// The same `{ error }` shape as the routes' own 503s, so the extension can read
// every failure the same way instead of meeting Hono's plain-text defaults.
app.notFound((c) => c.json({ error: 'Not found' } satisfies ErrorBody, 404));

app.onError((error, c) => {
  // The error only, never the request: its URL carries the caller's tags and
  // quote category, and these lines are retained (see `[observability]` in
  // wrangler.toml).
  console.error('Unhandled error:', error);
  return c.json({ error: 'Internal error' } satisfies ErrorBody, 500);
});

export default app;
