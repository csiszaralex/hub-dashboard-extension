# Hub API

A Cloudflare Worker that serves random background images from Unsplash with KV-based caching. Built with [Hono](https://hono.dev/).

## How it works

`GET /api/background?tags=mountain,fog` fetches 30 photos from Unsplash for the given tags, caches the pool in Cloudflare KV for 3 days, then returns one random photo on each request.

**Response:**

```json
{
  "url": "https://images.unsplash.com/photo-...?w=3840&q=90&fm=jpg&fit=crop",
  "location": "Dolomites, Italy",
  "photographer": "John Doe",
  "photographerUrl": "https://unsplash.com/@johndoe?utm_source=hub&utm_medium=referral"
}
```

`tags` defaults to `landscape,forest,mountain,fog,nature view` when omitted.

### Tag normalisation

Tags are lowercased, stripped of anything outside `[a-z0-9 -]`, deduplicated,
sorted, and capped at 5 before becoming the KV cache key. `Forest, MOUNTAIN` and
`mountain,forest` therefore share one cache entry rather than spending two
Unsplash calls. Normalisation lives in [`src/tags.ts`](src/tags.ts).

### Unsplash quota protection

The endpoint is public and the tag list comes from the caller, so a stream of
unique tags would otherwise drain the account's rate limit. A KV counter caps
Unsplash calls per hour; once it is spent the worker serves the default pool
instead of calling Unsplash, degrading variety rather than failing.

### Attribution

Per the [Unsplash API guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines),
the worker pings each photo's `download_location` when it hands the photo out,
and attribution links carry `utm_source=hub&utm_medium=referral`.
`photographerUrl` points at the photographer's profile, not the photo page.

## GET /api/quote/sources

Lists the sources this deployment can actually serve, so a client can build a
picker without hard-coding one. A source needing credentials the environment
does not have is absent rather than listed and broken.

```json
[
  { "id": "stoic", "languages": ["en"], "acceptsQuery": false },
  { "id": "citatum", "languages": ["hu"], "acceptsQuery": true },
  { "id": "programming", "languages": ["en", "hu"], "acceptsQuery": false }
]
```

`languages` is what the source has content for, never what it would like to
have. `acceptsQuery` says whether `?q=` narrows the result.

## GET /api/quote

Returns the day's quote for one source, behind a KV cache.

| Parameter | Meaning |
| --- | --- |
| `source` | A source id from `/api/quote/sources`. Unknown values fall back to `stoic` rather than being passed through — the id reaches a cache key, and the endpoint is public. |
| `lang` | One of the supported languages. A source that cannot serve it answers in its own language instead: picking a Hungarian-only source with an English interface should give Hungarian, not an error. |
| `q` | Category, for sources where `acceptsQuery` is true. Normalised (lowercased, accents folded, punctuation stripped, capped) before it reaches upstream or the key. |

The cache key is `quote:<source>:<lang>[:<category>]:<YYYY-MM-DD>`. Source and
language are part of it because they are part of the answer — sharing one key
would mean the day's first request decided what everyone got.

**Sources**

- **`stoic`** — proxies [`stoic.tekloon.net`](https://stoic.tekloon.net/), English only.
- **`citatum`** — [Citatum](https://www.citatum.hu/), Hungarian, narrowed by `q`.
  Needs the `CITATUM_USER` and `CITATUM_KEY` secrets; without them the source is
  not advertised. Their allowance is 500 requests a day, so a KV counter caps
  calls below it and a spent budget degrades to the stale quote. Anything
  displaying these quotes must link back to Citatum — the response carries the
  quote's own `sourceUrl` for that.
- **Built-in lists** (`programming`, …) — shipped with the worker under
  `src/static_quotes/`, one file per source. No upstream, so no failure mode;
  the day's entry is derived from the date rather than picked at random.

**Response:**

```json
{
  "text": "Waste no more time arguing about what a good man should be. Be one.",
  "author": "Marcus Aurelius",
  "sourceUrl": "https://www.citatum.hu/idezet/5073"
}
```

`sourceUrl` is present only for sources whose terms require attribution.

### Fallback when upstream is down

`stoic.tekloon.net` is a single-person service with no SLA. Every successful
fetch also updates a `quote:<source>:<lang>:latest` pointer to that source's
newest good quote. If the upstream request fails, times out, or returns a body
with no quote text, the worker serves that pointer instead of failing the
widget. It is per source and language on purpose: one shared pointer would hand
a user who picked one source another source's quote the moment theirs went
down, silently, for as long as the outage lasted. Only when nothing has ever
been cached (or the pointer has expired) does the endpoint return
`503`. A KV read failure (day cache or the stale pointer) is treated the same
way as an upstream failure rather than surfacing as a raw `500` — it degrades
along the same fallback chain. A KV write failure never discards a quote
that was already fetched successfully; caching is best-effort on top of the
response, not a precondition for it.

"Once per day in total" is the steady-state behaviour, not a hard guarantee:
the day-cache check is a plain check-then-act with no request coalescing, so
concurrent callers who all arrive before the first one has written the day
key each read a miss and call upstream independently. In practice this is a
handful of requests around UTC day rollover, not a whole day's traffic —
building true coalescing would need a Durable Object to serialise callers,
which is disproportionate to that blast radius.

## Local development

### 1. Install dependencies

From the monorepo root:

```bash
pnpm install
```

### 2. Configure environment variables

Create `apps/api/.dev.vars`:

```
UNSPLASH_ACCESS_KEY=your_unsplash_access_key
CITATUM_USER=your_citatum_username
CITATUM_KEY=your_citatum_api_code
```

Get a free key at [unsplash.com/developers](https://unsplash.com/developers) → create an app → copy the Access Key.

The Citatum pair is optional. Without it the worker runs normally and simply
does not offer that source — `GET /api/quote/sources` leaves it out, so nothing
downstream advertises an option that cannot work. The code is requested by mail
through [their API page](https://www.citatum.hu/api.php) and is tied to a
registered username, which is why both halves are needed.

In production both are set with `wrangler secret put`, not in `wrangler.toml`.

### 3. Start the dev server

```bash
cd apps/api
pnpm dev
# Worker runs at http://localhost:8787
```

Test it:

```bash
curl "http://localhost:8787/api/background?tags=mountain"
```

### Checks

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # ESLint
pnpm test        # Vitest — exercises the Hono app against an in-memory KV stub
pnpm check       # all three
```

## Deployment

The API deploys to Cloudflare Workers via GitHub Actions on every `api@*` tag push.

### Manual deployment

Requires Cloudflare credentials in your environment:

```bash
export CLOUDFLARE_API_TOKEN=your_token
export CLOUDFLARE_ACCOUNT_ID=your_account_id

cd apps/api
pnpm deploy
```

### Automated deployment (GitHub Actions)

1. Add these secrets to your GitHub repository:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

2. Push a version tag:
   ```bash
   git tag api@1.0.6
   git push origin api@1.0.6
   ```

GitHub Actions runs `.github/workflows/deploy-api.yml`, which runs `pnpm nx deploy api`.

## Configuration

**`wrangler.toml`** — Cloudflare Worker config:

```toml
name = "hub-api"
compatibility_date = "2024-03-20"

[[kv_namespaces]]
binding = "UNSPLASH_CACHE"
id = "<production-kv-id>"
preview_id = "<dev-kv-id>"
```

The KV namespace IDs point to Cloudflare KV stores used to cache image pools. Update these if you fork the project.

## Stack

| Tool                                                            | Purpose            |
| --------------------------------------------------------------- | ------------------ |
| [Hono](https://hono.dev/)                                       | Web framework      |
| [Cloudflare Workers](https://workers.cloudflare.com/)           | Serverless runtime |
| [Cloudflare KV](https://developers.cloudflare.com/kv/)          | Image pool cache   |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | CLI and dev server |
| TypeScript                                                      | Language           |

