# Hub API

A Cloudflare Worker that serves random background images from Unsplash and daily quotes from several sources, both with KV-based caching, plus a health endpoint for an uptime monitor. Built with [Hono](https://hono.dev/).

| Endpoint | Purpose |
| --- | --- |
| `GET /api/background` | One random photo, from a cached pool per tag set |
| `GET /api/quote` | The day's quote for one source and language |
| `GET /api/quote/sources` | The quote sources this deployment can serve |
| `GET /api/health` | Whether the background fallbacks can serve, for a monitor |

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

`url` asks for 3840 pixels, but the extension does not download it as it is:
`backgroundImageUrl` in `apps/extension/src/utils/backgroundImageSize.ts`
replaces its `w` and `q` query parameters with a width matched to the screen,
which Unsplash's image URLs allow without another API call. Keep `url` an
`images.unsplash.com` URL whose size is set by those two parameters; anything
else is passed through unchanged and downloaded at whatever size it names.

### Tag normalisation

Tags are lowercased, stripped of anything outside `[a-z0-9 -]`, deduplicated,
sorted, and capped at 5 before becoming the KV cache key. `Forest, MOUNTAIN` and
`mountain,forest` therefore share one cache entry rather than spending two
Unsplash calls. Normalisation lives in [`src/tags.ts`](src/tags.ts).

### Unsplash quota protection

The endpoint is public and the tag list comes from the caller, so a stream of
unique tags would otherwise drain the account's rate limit. A KV counter caps
Unsplash calls per hour (`HOURLY_UNSPLASH_BUDGET` in
[`src/background.ts`](src/background.ts)); once it is spent the worker serves
the fallback layers below instead of calling Unsplash, degrading variety rather
than failing. A call is claimed only when the request's own pool is missing, so
cached tag sets cost nothing.

The cap is approximate. The counter is a read followed by a write on KV, which
is eventually consistent, so concurrent requests (or requests in different
Cloudflare locations) can read the same count and each spend a call. Unsplash's
own per-hour rate limit on the account is the hard backstop. If the counter
cannot be read or written, the worker does not call Unsplash: it fails closed on
spending and open on serving.

The download pings count against the account's limit too: Unsplash counts every
request to `api.unsplash.com`. They are one per photo handed out, so they are
neither capped (the guidelines require them) nor counted in KV (that would be a
write per request). Instead every Unsplash response's `X-Ratelimit-Remaining`
is read, and when it falls below `UNSPLASH_RESERVE` a flag stops pool fetches
for the rest of the hour, leaving what is left for the pings. The flag is the
only write this adds, and only once the hour is nearly spent.

There is no per-client limit. Every caller shares the one hourly budget.

### Fallback order

A request is answered from the first of these that has photos:

1. the pool for its own normalised tags (`pool:<tags>`, 3-day TTL);
2. a fresh Unsplash fetch for those tags, if the hourly budget allows;
3. the default pool (`pool:<default tags>`, 3-day TTL);
4. the last good default pool (`last_good:default`), a copy written with no
   TTL whenever the default pool is fetched successfully, so it outlives an
   expired default pool;
5. the bundled pool (`BUNDLED_POOL` in [`src/bundledPool.ts`](src/bundledPool.ts)),
   shipped inside the worker. It is empty until real attribution data is added
   for it.

Only when all of them are empty does the endpoint answer `503`. A KV read
failure counts as a missing layer and a KV write failure is logged and ignored,
so a KV outage never surfaces as a `500`, and a pool that was fetched is served
even when it cannot be cached.

A `200` from Unsplash is checked before it is cached: photos without an
`https://` image URL, a photographer name or a photographer profile link are
dropped, and a response with nothing left (or one that is not a list) counts as
a failed fetch and is not cached.

### Upstream timeouts

Every upstream request (Unsplash, the `download_location` ping, `stoic`,
Citatum) gives up after 5 seconds (`UPSTREAM_TIMEOUT_MS` in
[`src/fetchWithTimeout.ts`](src/fetchWithTimeout.ts)), and the deadline covers
reading the body as well as the headers. An upstream that accepts the
connection and never answers raises no error on its own, so without the
deadline none of the fallbacks here would ever run. A timeout is handled as any
other failed request: the background route serves its fallback layers, the quote
route the stale quote, and a Citatum request that times out costs only its own
entry in the pool. The extension's own deadline for the worker
(`REQUEST_TIMEOUT_MS` in `apps/extension/src/utils/fetchWithTimeout.ts`) is
longer than this, so the fallback reaches the client before the client gives up.

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
| `n` | Which entry of the day's pool to serve, wrapping past the end. Deliberately **not** part of the cache key: the pool is what is cached, so asking for a different entry costs no upstream call. |

The cache key is `quote:<source>:<lang>[:<category>]:<YYYY-MM-DD>` and holds a
**pool** rather than a single quote, so a client can offer "another one" without
spending an upstream call. Source and language are part of the key because they
are part of the answer — sharing one would mean the day's first request decided
what everyone got.

Pool size is per source, because the upstreams differ. Citatum's `db` caps a
request at five *and* forbids random ordering, and paging with `honnan` instead
would need a category's size, which is unknowable — so its pool is built from
seven parallel single random requests, deduplicated, and a partial result is a
smaller pool rather than an error. `stoic` stays at one: it returns a single
random quote per call with no batch parameter, and a pool there would be one
request per entry against a one-person service.

No quote longer than 200 characters is cached. The limit is enforced on the way
in rather than at render time, because a long quote written to the day cache is
served to everyone until it expires. Citatum is asked upstream (`maxhossz`) not
to send them at all.

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

## GET /api/health

For an external uptime monitor. It costs at most two KV reads and never calls an
upstream, so polling it spends neither the Unsplash nor the Citatum allowance.
The response carries `Cache-Control: no-store`.

```json
{ "ok": true, "backgrounds": true }
```

`backgrounds` is whether any of the fallback layers (the default pool, the last
good default pool, the bundled pool; see [Fallback order](#fallback-order)) has
photos. Those are what `/api/background` serves when a request's own pool is
missing and Unsplash fails or the hourly budget is spent, so without them those
cases answer `503`. The status is `200` when `ok` is true and `503` with the
same body when it is false; a KV error counts as a missing layer rather than
surfacing as a `500`. The last good copy has no TTL, so once a deployment has
fetched the default pool successfully it stays healthy after the default pool
itself expires. A fresh deployment with an empty bundled pool reports unhealthy
until a request for the default tags fills it.

Quotes are deliberately not reported: the built-in sources answer from the
bundle with no upstream and no KV, so the worker can always serve a quote while
it runs at all, and checking the real upstreams would mean calling them.

## Errors

Every error is JSON with one field, the same shape as the routes' own `503`s:

```json
{ "error": "Not found" }
```

An unknown path answers `404` with `Not found`; an unhandled exception answers
`500` with `Internal error` and logs the error. CORS headers are present on both
under `/api/*`, so the extension can read the body cross-origin.

## API compatibility

The worker deploys as soon as an `api@*` tag is cut, while installed
extensions update only once the Chrome Web Store publishes a new version, so
they lag behind the worker by days to weeks. A response may therefore only gain
optional fields; renaming, removing or retyping a field, or making a new one
required, needs a new endpoint version that the old one keeps answering beside.
The shapes and the guards the extension reads them with live in `@hub/shared`
(`packages/shared/src/index.ts`), and
[`src/contract.test.ts`](src/contract.test.ts) runs every endpoint through those
guards, so a breaking change fails there first.

## Logging

`[observability]` in `wrangler.toml` turns on
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
which keeps the worker's own `console.*` output: 3 days on the Workers Free
plan, 7 on Paid. `head_sampling_rate = 1` keeps every one of them, which costs
little because the worker only writes on a failure.

Invocation logs are switched off (`invocation_logs = false`). Cloudflare would
otherwise record each request with its URL, and the URL carries the user's
background tags and quote category, which `apps/extension/privacy-policy.md`
promises are not logged. For the same reason, no log line includes the
request. The Citatum request URL carries the credentials in its query string,
so nothing logs it either: a timeout names only the host
(`FetchTimeoutError`), and the per-request errors of a Citatum pool are
dropped rather than logged (`citatum.resolve` in `src/quoteSources.ts`).

## Local development

### 1. Install dependencies

From the monorepo root:

```bash
pnpm install
```

### 2. Configure environment variables

Copy [`.dev.vars.example`](.dev.vars.example) to `apps/api/.dev.vars` and fill
it in. The example names every variable the worker reads and is the file to
update when that list changes; `.dev.vars` itself is gitignored.

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
pnpm run deploy
```

Use `pnpm run deploy` (or `pnpm nx run api:deploy` from the root), not `pnpm deploy`:
that one is pnpm's own experimental command for deploying a workspace package
to a directory, and does not run Wrangler.

### Automated deployment (GitHub Actions)

1. Add these secrets to your GitHub repository:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

2. Push a version tag:
   ```bash
   git tag api@1.0.6
   git push origin api@1.0.6
   ```

Normally you do not push the tag yourself: a push to `main` runs the Check workflow, and when it passes `release.yml` cuts the tags.

GitHub Actions runs `.github/workflows/deploy-api.yml`, which runs `pnpm run check` and then `pnpm nx deploy api`.

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

The KV namespace IDs point to Cloudflare KV stores used to cache image and quote pools and the hourly and daily call counters. Update these if you fork the project. The excerpt above omits the `[observability]` blocks described under [Logging](#logging).

## Stack

| Tool                                                            | Purpose            |
| --------------------------------------------------------------- | ------------------ |
| [Hono](https://hono.dev/)                                       | Web framework      |
| [Cloudflare Workers](https://workers.cloudflare.com/)           | Serverless runtime |
| [Cloudflare KV](https://developers.cloudflare.com/kv/)          | Image and quote pool cache |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | CLI and dev server |
| TypeScript                                                      | Language           |

