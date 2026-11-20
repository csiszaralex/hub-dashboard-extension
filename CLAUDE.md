# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Nx monorepo for a Chrome extension dashboard with a serverless backend API.

- **`apps/extension`** — Chrome extension (React 19 + Vite + CRXJS) replacing the new tab page
- **`apps/api`** — Cloudflare Worker (Hono.js) serving background images from Unsplash and daily quotes, both with KV caching
- **`packages/shared`** — Types and the few constants both apps must agree on (`packages/shared/src/index.ts`): `BackgroundData` and `QuoteData` (the response shapes), `SUPPORTED_LANGUAGES` / `Language`, `DEFAULT_BACKGROUND_TAGS` and `DEFAULT_QUOTE_SOURCE_ID`. Runtime values stay short; anything bulky belongs with the app that uses it

## Commands

All Nx tasks should be run via pnpm (not global nx):

```bash
# Root — these fan out via Nx and are cached, so re-running is nearly free
pnpm typecheck          # TypeScript check across all projects
pnpm lint               # ESLint across all projects
pnpm test               # Vitest across all projects
pnpm check              # typecheck + lint + test
pnpm build              # Production build of every buildable project
pnpm affected           # Same targets, but only for projects touched vs. main

# Extension (from root or apps/extension)
pnpm nx run extension:dev       # Vite dev server at localhost:5173
pnpm nx run extension:build     # TypeScript check + production build → dist/
pnpm nx run extension:pack      # Build + zip → extension-release.zip
pnpm nx run extension:lint      # ESLint
pnpm nx run extension:typecheck # TypeScript check only
pnpm nx run extension:test      # Vitest (happy-dom)
pnpm nx run extension:preview   # Vite preview server

# API (from root or apps/api)
pnpm nx run api:dev             # Wrangler dev at localhost:8787
pnpm nx run api:deploy          # Deploy to Cloudflare Workers
pnpm nx run api:typecheck       # TypeScript check
pnpm nx run api:lint            # ESLint
pnpm nx run api:test            # Vitest
```

### Testing

Vitest covers the logic that is cheap to get wrong: cache expiry, tag
normalisation, event categorisation, forecast aggregation, the settings
store, the Memos client and hook, the popup form, and the service worker's
prefetch and Pomodoro state machines, including their concurrency and
cross-restart invariants (`apps/extension/src/background.test.ts`, the one to
read before touching them). No single suite dominates: `useMemos.test.tsx`,
`PopupForm.test.tsx` and `background.test.ts` are each about 40 tests. Pixels
and real Chrome integration are still verified by hand — load the built
extension from `apps/extension/dist/` in Chrome.

Extension tests run under happy-dom with stubs for `chrome` and the Cache API
(`src/test/`). Hooks backed by module-level stores (`useSettings`) must be
imported inside the test via `await import(...)`, because `src/test/setup.ts`
calls `vi.resetModules()` before each test to give every test the clean slate a
fresh page load would have. That makes a file's first test pay for Vite
transforming everything its import reaches; a file that loads a large graph
(`App`, a widget) calls `warmUp` from `src/test/warmUp.ts` so the one-off
compile runs outside the 20-second test timeout, which a busy machine
otherwise exceeds.

A test double must model what the real API *enforces*, not just its happy
path — three bugs have shipped past a green suite here because a stub didn't:
the Cache API's `put()` throws for any request scheme other than `http(s)`
(a `hub://` cache key worked against the old stub and failed in every real
browser), `chrome.storage.local` fires `onChanged` exactly like `.sync`
does (a stub that stayed silent on `.local` writes let a component that never
subscribed to them look correct), and `chrome.storage.sync` refuses a whole
`set` when one item is over its 8 KB per-item quota (a stub with no sync quota
let an oversized custom quotes list sink a save the popup reported as
successful). When you add or touch a stub in
`src/test/`, check it against the constraint the real API imposes, not just
against the code you're about to exercise with it.

## Commit Conventions

Conventional Commits are enforced by Husky + commitlint on every commit:

```
type(scope): subject

# Valid scopes: api | extension | shared | repo | release | ci
```

Examples: `feat(extension): add countdown widget`, `fix(api): handle empty response`

## Architecture

### Extension

The extension entry is `apps/extension/src/main.tsx` → `Root.tsx` (the outer error boundary) → `App.tsx`. The main `App` component mounts all widgets and shows/hides the UI overlay via `useUiVisibility` (double-click, `.`, or Escape). It also holds a settings button (it calls `chrome.runtime.openOptionsPage()`; `options_ui` in `manifest.json` opens `popup.html` in a tab), because the toolbar action stays in Chrome's extensions menu until the user pins it.

**Widgets** (`src/components/`): `Clock`, `WeatherWidget`, `CalendarWidget`, `QuoteWidget`, `CountdownWidget`, `PomodoroWidget`, `QuickNote`, `MemosWidget`, `BackgroundInfo`, plus `WhatsNewModal` and `WelcomeCard` (first-run and release notices) and `UndoLine` (the shared "done · Undo" line, shown for `UNDO_WINDOW_MS` from `utils/undo.ts` after an archived memo or a cleared note). Most widgets call their own data hook and read `useSettings` themselves; `QuoteWidget` and `BackgroundInfo` are the exceptions, presentational components that take `quote` / `data` as props, because `App` calls `useQuote` and `useBackground` itself (it passes `refresh` down and owns the background refresh button). `TopSitesWidget` and `useTopSites` exist but are commented out in `App.tsx` and absent from `WIDGET_IDS`. `src/widgets.ts` is the single source of truth for widget ids (`WIDGET_IDS`): the popup's visibility checkboxes, `App.tsx`'s `showWidget`, and settings sanitisation (`sanitizeHiddenWidgets`) all read from it. Renaming a widget id is a migration, not a find-and-replace — `sanitizeHiddenWidgets` drops an unrecognised id rather than leaving a widget hidden with no way for the user to find it again.

**Error boundaries** (`components/ErrorBoundary.tsx`): two levels, because a render error otherwise unmounts the whole tree and a bad cached value makes every new tab come up blank. In `App.tsx` each widget sits in its own boundary, inside its `showWidget(...)` condition, with an empty fallback: a failing widget disappears and the rest of the page stays. `Root.tsx` (rendered by `main.tsx`) wraps `App` itself, for errors in `App` or its hooks, and falls back to `RecoveryScreen`: Reload, or clear cached data and reload. That screen must not throw a second time, so it translates through `i18n.t` with the English locale file as a fallback rather than through `useTranslation`. What "clear cached data" may delete is listed in one place, `utils/recovery.ts`'s `clearRecoverableData`, and the rule is: only what the extension can fetch or derive again. Never the quick note, the last-seen release, the Memos credentials or draft, the Pomodoro state, `chrome.storage.sync`, or the uploaded background, which is why the image buckets are cleared through `pruneImageCache` and `deleteObsoleteImageCaches` rather than deleted.

**Hooks** (`src/hooks/`): Each widget has a corresponding data hook (`useBackground`, `useCalendar`, `useWeather`, `useQuote`, `usePomodoro`, etc.) that handles fetching, caching, and Chrome Storage interaction. `usePomodoro` only mirrors `chrome.storage.local` and ticks a display clock — the timer itself is owned by the service worker (see below). `useUiVisibility` owns the `.`/Escape UI toggle; `useDocumentTitle` mirrors a string onto the tab title, restoring the original on unmount or when passed `null`. Pure derivation logic lives in `src/utils/` (`calendarEvents`, `precipitation`, `forecast`, `changelog`, `dailyStorage`, `imageCache`, `dim`, `pomodoro`, `pomodoroState`) so it can be tested without React. `useWeather` and `useCalendar` refresh through `utils/pageRefresh.ts`'s `schedulePageRefresh`, so a hidden tab never refetches on its own: it skips the interval and catches up (stale weather cache, or calendar events older than five minutes) when it becomes visible, and the calendar stays in memory only, so a new tab still loads once.

**Settings** (`src/hooks/useSettings.ts`): One module-level store shared by every consumer via `useSyncExternalStore` — a single `chrome.storage.sync.get` and a single `onChanged` listener per page. Do not add per-component storage reads.

**Settings schema** (`src/utils/settingsSchema.ts`): the one description of `HubSettings` — the interface, `DEFAULT_SETTINGS`, and `DECODERS`, one decoder per field (`unknown` → the value, or `undefined` when it is not a valid setting). `DECODERS` is a mapped type over `keyof HubSettings`, so a field added without a decoder fails the build. The decoders reuse the sanitisers the popup applies (`sanitizeHiddenWidgets`, `clampDim`, `clampPomodoroMinutes`, `sanitizeCustomQuotes`, `normalizeBaseUrl`, `sanitizeMemosTag`). Two readers apply different policies to `undefined`, on purpose: `applyStoredSettings`/`readSettings` (everything read from `chrome.storage.sync`: `useSettings` on load and on every change, the service worker, `i18n.ts`) replace an invalid value with its **default**, since storage is the configuration and there is nothing better; `decodeSettings` (backup import) **drops** it, since the file is the untrustworthy party. The module is React-free and imported by the service worker, so it and everything it imports must stay free of `window`, `document` and `localStorage`. Defaults the API must agree with (`DEFAULT_BACKGROUND_TAGS`, `DEFAULT_QUOTE_SOURCE_ID`) live in `@hub/shared`.

The stored shape is versioned: `settingsVersion` in `chrome.storage.sync`, outside `HubSettings` (so never a setting, never in a backup file). `useSettings`'s start path reads the whole area, runs `MIGRATIONS` from the stored version in order (`migrateStoredSettings`; a missing version means 1, a newer one is left alone), renders the result, then writes only what changed plus the version (`migrationWrites`). `CURRENT_SETTINGS_VERSION` is `MIGRATIONS.length + 1`, so there are none yet and version 1 is simply recorded. Renaming a field or changing a stored value's format is a migration step, never an edit to a key or decoder alone, which would silently reset every user's value to its default.

**Quote sources**: the worker owns a source registry (`apps/api/src/quoteSources.ts`) and reports what it can serve from `GET /api/quote/sources`, so the popup's picker is built from the API rather than a list in the extension — a source whose credentials are missing from a deployment is simply absent. `custom` is the exception: the user's own list, answered entirely in the extension with no request, which is why `useQuote` branches before it fetches. Source ids and the language are part of the KV key, both from closed sets, for the reason `tags.ts` exists.

**Settings backup** (`utils/settingsBackup.ts`): export writes the preferences as JSON; import validates every field before it reaches storage, through the schema's `decodeSettings`. The validation is not belt-and-braces — `useSettings` decodes every field it *reads* and falls back to the default, so a bad value cannot reach a widget, but it would still be written to `chrome.storage.sync`, count against its byte quota and propagate to the user's other machines. A rejected field drops out rather than resetting to its default, since the file is the untrustworthy party and not the configuration the user already has. `parseBackup` checks the file's `version`: one newer than `BACKUP_VERSION` is refused with its own message (`popup.backupTooNew`), because this build cannot know what a newer one meant; a file without a numeric version is not a backup.

**Memos widget** (`utils/memos.ts`, `memosClient.ts`, `memosPermissions.ts`, `memosStorage.ts`, `memosFailureMessage.ts`, `hooks/useMemos.ts`, `components/MemosWidget.tsx` and `MemosPanel.tsx`, `popup/MemosSection.tsx`): the access token lives in `chrome.storage.local`, deliberately outside `HubSettings` — the schema's `DECODERS` is a mapped type over `keyof HubSettings` and `buildBackup` writes that whole object to a user-shareable file, so keeping the token out of the type makes exporting it impossible rather than merely forbidden. The base URL does sync; the token does not, which is why a second machine has to press Connect once.

Two invariants hold this widget together, and both are easy to undo by accident:

- **`GET /api/v1/memos` is public in Memos v0.30** (and `GET /api/memos` after it). With an expired or revoked token it still answers `200` — with that server's *public* memos only, which for a widget that writes `PRIVATE` ones is usually none. Every refresh therefore proves the token with `GET …/auth/me`, which is *not* public, and commits the list to the screen and to the cache only if that vouched for it in the same round. Dropping the `auth/me` call as a redundant request reintroduces a bug that is invisible until a token expires, and then looks like the user's notes disappearing — it also overwrote the offline cache. `memosFetch.ts`'s fake models the asymmetry, so the tests hold the line.
- **The token is stored with the server it was issued for** (`memos_server`, beside `memos_token`), and nothing is sent while that and `memosUrl` disagree. Connect writes the server first, then the token and account, then the synced URL; an open tab reloads on each local write, and without the pair it would hand a newly entered token to the server being left behind.

`utils/memosStorage.ts` also keeps a per-server `memos_check` — when to ask again (five minutes after a success, one after a failure) and what the last attempt failed with — so opening tabs does not mean a request each. The panel's refresh button and a credential change both bypass it. `MemosStatus`'s `needs-access` is the case where the connection is whole and only Chrome's host grant is gone, which is what every reload of an unpacked build produces: the widget offers a button rather than the popup, because the click on it is the user gesture `permissions.request` needs.

**Settings UI** (`src/popup/`): Separate popup page (`popup.html`, also the options page), tabbed (`TabNav`) across general, appearance, weather, countdown, focus (id `pomodoro`), calendars, widgets and memos, one section component per tab (`GeneralSection`, `AppearanceSection`, … `MemosSection`), each owning its fields. There is no Apply button: a Chrome popup closes on any outside click, so held-back edits were lost silently. Every setting is written as it changes, through `saveStatus.ts`'s `SaveContext`, which runs the patch through the schema's `decodeSettings` before `saveSettings`. Checkboxes, selects and radios write at once; free text (and the dim slider) goes through `useDraftSetting`, which writes after `DRAFT_SAVE_DELAY_MS` of pause, on blur, on `pagehide`/hidden and when its tab unmounts — the pause is what keeps a typing user inside `chrome.storage.sync`'s write-rate limits (quoted at that constant). Three things are not plain writes: the city is resolved by a geocoding lookup on blur or Enter and written with its coordinates or not at all (`WeatherSection`); the custom background becomes the setting only once an image is in the cache (`AppearanceSection`); the Memos URL is written by Connect, which needs the click's gesture. Feedback lands in `SaveStatusLine`, pinned below the tabs, so a write that finishes after its tab is gone is still seen: "Saved" in a polite live region, an error (with Chrome's message) as an `alert`. Field errors (city, upload) also show by their field. The Calendars tab asks for the list without a prompt and stays silent when signed out; an error appears only for a request that failed (offline, an API error), or after the sign-in button was pressed. Widgets react to the storage changes as before.

**Background image caching**: metadata (url, photographer, location) goes to `localStorage` via `dailyStorage`; the image itself — an Unsplash photo or a user-uploaded custom image — goes to the Cache API via `imageCache`. Never put image bytes in `localStorage` — a 4K JPEG base64-encodes past the origin quota. A cache version bump must not lose the user's own upload: `deleteObsoleteImageCaches` carries it forward, since it is the one entry in those buckets that cannot be re-downloaded. The photo's size is the extension's choice, not the API's: the API's URL is left as it is for old clients, and `utils/backgroundImageSize.ts`'s `backgroundImageUrl` rewrites its `w`/`q` to a fixed width bucket (`widthBucketFor`, from `screen.width × devicePixelRatio`) before anything downloads or stores it. The page and the service worker's prefetch both call it, and the page records its bucket in `chrome.storage.local` (`recordWidthBucket`) because the worker has no screen; they must keep producing the same URL, or the cache lookup misses what the worker downloaded.

**Images that are not part of the product** — the Chrome Web Store screenshot, anything for the project page — live in `assets/` at the repo root, never in `apps/extension/public/`. Everything in `public/` is packaged into the extension and downloaded by every user on every update; the store screenshot alone was 1.1 MB of a 2.1 MB package, for a file that never renders in the product. GitHub Pages serves the repo root, so `assets/` is reachable from both READMEs. `apps/extension/store-listing.md` holds the submitted listing copy and permission justifications, and is meant to be updated in the same commit as `manifest.json` and `privacy-policy.md`.

**Release notes** (`WhatsNewModal` + `utils/changelog.ts`): `vite.config.ts` injects the **last ten releases**, not the one being built, and the page selects the range from the version `useWhatsNew` recorded on the previous visit up to the running one. Users do not arrive one release at a time — the Chrome Web Store ships whatever is current — so injecting a single version silently buries everything a user skipped. `SectionKey` is a literal union so a section heading added without a translation fails the build rather than rendering a raw key. A first install gets `WelcomeCard` instead, and only when there is no recorded version *and* `useSettings`' `hadStoredSettings` is false: a user who cleared the site data, or a second synced machine, is caught up silently rather than welcomed or shown a changelog with no starting point. `settingsVersion` does not count as a stored setting, since the first page of a fresh install writes it.

**Service worker** (`src/background.ts`) owns three things. **None of them, or anything they import, may touch `window`, `document` or `localStorage` — a service worker has no access to `localStorage`** (enforced by `serviceWorkerGuard` in `vite.config.ts`, which fails the build when the worker's chunk graph names one of them or bundles React, and by `background.test.ts` running in the node environment), which is why `utils/prefetch.ts` and `utils/pomodoroState.ts` both hand data to the page through `chrome.storage.local` instead:
1. **Cache housekeeping** — drops obsolete image caches on install/update.
2. **Background prefetch** — a `chrome.alarms` alarm fetches tomorrow's background once a day and stores it via `utils/prefetch.ts`'s `chrome.storage.local` hand-off slot; the new tab page adopts the packet on load instead of fetching cold. A custom background source skips this entirely.
3. **The Pomodoro timer** — moved out of `usePomodoro` because a per-tab timer meant two open tabs disagreed about the remaining time and each raised its own notification. The worker holds the one deadline, the one alarm (`pomodoro-phase`), and raises the one notification; its state (`utils/pomodoroState.ts`) is read back from `chrome.storage.local` on every event, since nothing survives the worker being torn down between events. `background.test.ts` is where the concurrency invariants live (compare-and-swap epoch, in-memory command counter, write-state-before-schedule-alarm ordering) — read it before changing the transition logic.

**i18n**: `react-i18next` with locale files in `src/i18n/locales/`. ESLint is configured with `eslint-plugin-i18next` to catch JSX literal strings. The languages that exist are `SUPPORTED_LANGUAGES` in `@hub/shared`; `AVAILABLE_LANGUAGES` (`src/i18n/i18n.ts`) only re-exports it for the popup's picker. Which language applies is decided by `src/i18n/language.ts` (`detectLanguage`, `resolveLanguage`, `toLanguage`, `DEFAULT_LANGUAGE`), shared by the page and the service worker, so it must stay free of React and page globals; i18next's `fallbackLng` is the same `DEFAULT_LANGUAGE`. The worker does not import `i18n/i18n.ts` (that would drag React into a worker Chrome cold-starts on every alarm), so `src/background.ts` keeps its own `LOCALES` map for the two Pomodoro notification strings. Several lookups are `Record<Language, …>`, so adding a language to `SUPPORTED_LANGUAGES` fails the build until each has an entry: the locale file in `i18n/validate.ts`, the worker's `LOCALES`, and the date-fns locale in `utils/localeFormat.ts`'s `DATE_LOCALES`. The `resources` object in `i18n.ts` is not checked that way and needs the new file by hand; `background.test.ts`'s locale-parity suite (`it.each` over `src/i18n/locales/*.json`) also covers the worker. Times and numbers go through `Intl` in `utils/localeFormat.ts` (`formatTime`, `clockParts`, `formatNumber`), never a fixed `HH:mm`: the language decides 12- or 24-hour time and the decimal separator.

**External APIs consumed by the extension:** every host below must also be listed in `manifest.json` under `host_permissions` — except the Memos instance, whose one origin is granted at runtime through `optional_host_permissions` instead.
- Hub API (this repo's `apps/api`) — background image metadata and daily quotes. The extension never calls Unsplash's search endpoint or `stoic.tekloon.net` directly; only the Hub API does, and only it needs their credentials.
- `images.unsplash.com` — downloading the actual image bytes once the Hub API has resolved a photo
- Open-Meteo — weather; `geocoding-api.open-meteo.com` for city lookup in the popup
- BigDataCloud — reverse geocoding (no key needed)
- GeoJS (`get.geojs.io`) — IP-based location fallback
- Google Calendar API — via OAuth identity permission (`calendar.readonly`)
- The user's own Memos instance (`optional_host_permissions`, granted at runtime for one origin) — the Memos widget. **Deliberately not proxied through the Hub API:** the Worker cannot reach a LAN or Tailscale host, and routing private notes through a public, unauthenticated proxy — with the user's token as a Worker secret — is the wrong trust boundary. Requires Memos v0.30.0+; the adapter targets one API shape rather than a range. The one move it follows is 26.10's, which took the routes from `/api/v1/...` to `/api/...` (410 Gone on the old prefix) without changing the JSON: `memosClient` looks the prefix up once per page per server, from whether `GET /api/instance/profile` answers 404, and looks again on a 410.

Changes to permissions, scopes or external hosts must be reflected in `privacy-policy.md`, which is what the Chrome Web Store review reads.

### API

`src/index.ts` (Hono app) mounts one route module per concern — `src/background.ts` (`GET /api/background`), `src/quote.ts` (`GET /api/quote` and `GET /api/quote/sources`) and `src/health.ts` (`GET /api/health`) — with tag normalisation shared out of `src/tags.ts`. Configured via `wrangler.toml`. `apps/api/README.md` documents every endpoint in full and is kept accurate independently of this file; this section is a pointer, not a duplicate.

Every outbound request in both apps goes through that app's `fetchWithTimeout` (`apps/api/src/fetchWithTimeout.ts`, `apps/extension/src/utils/fetchWithTimeout.ts`; the Memos client keeps its own), whose deadline also covers the body read, because a hung upstream raises no error and the fallbacks only run after one; the extension's `REQUEST_TIMEOUT_MS` must stay above the worker's `UPSTREAM_TIMEOUT_MS`, or the client gives up before the worker's fallback arrives.

`GET /api/background?tags=...` fetches 30 photos from Unsplash, caches the pool in Cloudflare KV for 3 days (TTL), and returns one random photo's metadata. Two constraints it exists under, since it is public and unauthenticated:
- Tags are normalised (lowercased, stripped, deduped, sorted, capped at 5) so the KV key space cannot be inflated by callers.
- Unsplash calls are capped per hour by a KV counter. Past the cap the worker serves the default pool instead of calling Unsplash, so a burst degrades the variety rather than exhausting the account quota. The cap is approximate (KV is eventually consistent); Unsplash's own rate limit is the hard backstop.

Fallback order: own pool → Unsplash fetch → default pool → `last_good:default` (no TTL) → `BUNDLED_POOL` → 503. Every KV call there is fallible, as in `quote.ts`: a failed read is a miss, a failed write is ignored, a failed budget read or write means no Unsplash call. `GET /api/health` reads the same layers.

Unsplash's API guidelines are load-bearing here: the worker pings each photo's `download_location` when it hands the photo out, and attribution links carry `utm_source=hub&utm_medium=referral`.

`GET /api/quote?source=&lang=` serves one source from the registry in `src/quoteSources.ts` (`stoic` proxies `stoic.tekloon.net`, `citatum` proxies Citatum and exists only where its secrets are set, the built-in lists answer from `src/static_quotes/`). What is cached is a day's *pool* per source and language, keyed `quote:<source>:<lang>[:<category>]:<YYYY-MM-DD>` (UTC date), so upstream is hit roughly once per day per key rather than once per request; when upstream is down it falls back to a per-source, per-language `quote:<source>:<lang>:latest` pointer, never a shared one, so an outage cannot hand a user another source's quote. The extension talks only to this endpoint for quotes — see the External APIs note in the Extension section above.

`GET /api/health` (`src/health.ts`) is for an uptime monitor: at most two KV reads of the background fallback layers, never an upstream call. Workers Logs keeps the worker's `console.*` output, but `invocation_logs` stays off in `wrangler.toml`: those would record each request URL, which carries the user's tags and quote category, and `privacy-policy.md` promises no request logs. So no log line may include the request either.

### Release Flow

1. Push to `main` → `check.yml` runs → on its success `release.yml` (a `workflow_run` trigger, not a push trigger) runs `pnpm nx release` → creates git tags using conventional commits. A failed or cancelled Check releases nothing; re-running the Check is how a release is retried
2. Tag matching `extension@*` triggers `deploy.yml` → runs `pnpm run check`, builds with `pnpm nx run extension:pack` and uploads to the Chrome Web Store. The upload is a draft unless the repository variable `PUBLISH_EXTENSION` is `true`; submitting for review is otherwise done by hand
3. Tag matching `api@*` triggers `deploy-api.yml` → runs `pnpm run check`, then deploys via Wrangler (`pnpm nx deploy api`) to Cloudflare

## Nx Guidelines

- Use `nx-workspace` skill to explore projects and targets
- Use `nx-generate` skill before any scaffolding task
- Never guess CLI flags — check `--help` or `nx_docs` first
- Run `nx migrate --run-migrations` with `--agentic=false --create-commits=false`. From Nx 24 it switches to an agent mode by default when it detects an AI agent, and that mode commits on its own (`chore: [nx migration] checkpoint`, untracked files included), which skips the commit review this repo relies on.
- See `AGENTS.md` for full Nx guidelines
