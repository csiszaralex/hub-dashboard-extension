import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { backgroundRoutes } from './background';
import { Bindings } from './bindings';
import { quoteRoutes } from './quote';

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());
app.route('/', quoteRoutes);
app.route('/', backgroundRoutes);

export default app;
