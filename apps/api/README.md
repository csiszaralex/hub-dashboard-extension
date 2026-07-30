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
```

Get a free key at [unsplash.com/developers](https://unsplash.com/developers) → create an app → copy the Access Key.

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

