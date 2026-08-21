# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Nx monorepo for a Chrome extension dashboard with a serverless backend API.

- **`apps/extension`** — Chrome extension (React 19 + Vite + CRXJS) replacing the new tab page
- **`apps/api`** — Cloudflare Worker (Hono.js) serving background images from Unsplash and daily quotes, both with KV caching
- **`packages/shared`** — Shared TypeScript types (`BackgroundData` interface)

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
store, and — the largest suite by far — the service worker's prefetch and
Pomodoro state machines, including their concurrency and cross-restart
invariants (`apps/extension/src/background.test.ts`). Rendering and Chrome
integration are still verified by hand — load the built extension from
`apps/extension/dist/` in Chrome.

Extension tests run under happy-dom with stubs for `chrome` and the Cache API
(`src/test/`). Hooks backed by module-level stores (`useSettings`) must be
imported inside the test via `await import(...)`, because `src/test/setup.ts`
calls `vi.resetModules()` before each test to give every test the clean slate a
fresh page load would have.

A test double must model what the real API *enforces*, not just its happy
path — two bugs have shipped past a green suite here because a stub didn't:
the Cache API's `put()` throws for any request scheme other than `http(s)`
(a `hub://` cache key worked against the old stub and failed in every real
browser), and `chrome.storage.local` fires `onChanged` exactly like `.sync`
does (a stub that stayed silent on `.local` writes let a component that never
subscribed to them look correct). When you add or touch a stub in
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

The extension entry is `apps/extension/src/main.tsx` → `App.tsx`. The main `App` component mounts all widgets and shows/hides the UI overlay via `useUiVisibility` (double-click, `.`, or Escape).

**Widgets** (`src/components/`): `Clock`, `WeatherWidget`, `CalendarWidget`, `QuoteWidget`, `CountdownWidget`, `PomodoroWidget`, `QuickNote`, `BackgroundInfo`, `WhatsNewModal` — each is self-contained and reads settings through `useSettings`. `src/widgets.ts` is the single source of truth for widget ids (`WIDGET_IDS`): the popup's visibility checkboxes, `App.tsx`'s `showWidget`, and settings sanitisation (`sanitizeHiddenWidgets`) all read from it. Renaming a widget id is a migration, not a find-and-replace — `sanitizeHiddenWidgets` drops an unrecognised id rather than leaving a widget hidden with no way for the user to find it again.

**Hooks** (`src/hooks/`): Each widget has a corresponding data hook (`useBackground`, `useCalendar`, `useWeather`, `useQuote`, `usePomodoro`, etc.) that handles fetching, caching, and Chrome Storage interaction. `usePomodoro` only mirrors `chrome.storage.local` and ticks a display clock — the timer itself is owned by the service worker (see below). `useUiVisibility` owns the `.`/Escape UI toggle; `useDocumentTitle` mirrors a string onto the tab title, restoring the original on unmount or when passed `null`. Pure derivation logic lives in `src/utils/` (`calendarEvents`, `precipitation`, `forecast`, `changelog`, `dailyStorage`, `imageCache`, `dim`, `pomodoro`, `pomodoroState`) so it can be tested without React.

**Settings** (`src/hooks/useSettings.ts`): One module-level store shared by every consumer via `useSyncExternalStore` — a single `chrome.storage.sync.get` and a single `onChanged` listener per page. Do not add per-component storage reads.

**Settings backup** (`utils/settingsBackup.ts`): export writes the preferences as JSON; import validates every field before it reaches storage. The validation is not belt-and-braces — `useSettings` sanitises what it *reads*, so a bad value could never break the running page, but it would still be written to `chrome.storage.sync`, count against its byte quota and propagate to the user's other machines. `RULES` is a table keyed by `HubSettings` field so a new setting that nobody adds a rule for is visible in one place; a rejected field drops out rather than resetting to its default, since the file is the untrustworthy party and not the configuration the user already has.

**Settings UI** (`src/popup/`): Separate popup page (`popup.html`), tabbed (`TabNav`) across general, appearance, weather, countdown, focus, calendars and widgets. Writes to Chrome Storage Sync; widgets react to storage changes.

**Background image caching**: metadata (url, photographer, location) goes to `localStorage` via `dailyStorage`; the image itself — an Unsplash photo or a user-uploaded custom image — goes to the Cache API via `imageCache`. Never put image bytes in `localStorage` — a 4K JPEG base64-encodes past the origin quota. A cache version bump must not lose the user's own upload: `deleteObsoleteImageCaches` carries it forward, since it is the one entry in those buckets that cannot be re-downloaded.

**Images that are not part of the product** — the Chrome Web Store screenshot, anything for the project page — live in `assets/` at the repo root, never in `apps/extension/public/`. Everything in `public/` is packaged into the extension and downloaded by every user on every update; the store screenshot alone was 1.1 MB of a 2.1 MB package, for a file that never renders in the product. GitHub Pages serves the repo root, so `assets/` is reachable from both READMEs. `apps/extension/store-listing.md` holds the submitted listing copy and permission justifications, and is meant to be updated in the same commit as `manifest.json` and `privacy-policy.md`.

**Release notes** (`WhatsNewModal` + `utils/changelog.ts`): `vite.config.ts` injects the **last ten releases**, not the one being built, and the page selects the range from the version `useWhatsNew` recorded on the previous visit up to the running one. Users do not arrive one release at a time — the Chrome Web Store ships whatever is current — so injecting a single version silently buries everything a user skipped. `SectionKey` is a literal union so a section heading added without a translation fails the build rather than rendering a raw key.

**Service worker** (`src/background.ts`) owns three things. **None of them, or anything they import, may touch `window`, `document` or `localStorage` — a service worker has no access to `localStorage`**, which is why `utils/prefetch.ts` and `utils/pomodoroState.ts` both hand data to the page through `chrome.storage.local` instead:
1. **Cache housekeeping** — drops obsolete image caches on install/update.
2. **Background prefetch** — a `chrome.alarms` alarm fetches tomorrow's background once a day and stores it via `utils/prefetch.ts`'s `chrome.storage.local` hand-off slot; the new tab page adopts the packet on load instead of fetching cold. A custom background source skips this entirely.
3. **The Pomodoro timer** — moved out of `usePomodoro` because a per-tab timer meant two open tabs disagreed about the remaining time and each raised its own notification. The worker holds the one deadline, the one alarm (`pomodoro-phase`), and raises the one notification; its state (`utils/pomodoroState.ts`) is read back from `chrome.storage.local` on every event, since nothing survives the worker being torn down between events. `background.test.ts` is where the concurrency invariants live (compare-and-swap epoch, in-memory command counter, write-state-before-schedule-alarm ordering) — read it before changing the transition logic.

**i18n**: `react-i18next` with locale files in `src/i18n/locales/`. ESLint is configured with `eslint-plugin-i18next` to catch JSX literal strings. `AVAILABLE_LANGUAGES` (`src/i18n/i18n.ts`) is read from `src/i18n/locales/` at build time, so the page itself picks up a new locale file automatically. The service worker cannot: importing `i18n/i18n.ts` would drag React into a worker Chrome cold-starts on every alarm, so `src/background.ts` keeps its own hand-maintained `LOCALES` map for the two Pomodoro notification strings. **Adding a locale therefore needs a manual entry in that map** — nothing warns if you forget it, since the lookup silently falls back to English. `background.test.ts`'s locale-parity suite (`it.each` over `src/i18n/locales/*.json`) is what catches a missing entry.

**External APIs consumed by the extension:** every host below must also be listed in `manifest.json` under `host_permissions`.
- Hub API (this repo's `apps/api`) — background image metadata and daily quotes. The extension never calls Unsplash's search endpoint or `stoic.tekloon.net` directly; only the Hub API does, and only it needs their credentials.
- `images.unsplash.com` — downloading the actual image bytes once the Hub API has resolved a photo
- Open-Meteo — weather; `geocoding-api.open-meteo.com` for city lookup in the popup
- BigDataCloud — reverse geocoding (no key needed)
- GeoJS (`get.geojs.io`) — IP-based location fallback
- Google Calendar API — via OAuth identity permission (`calendar.readonly`)

Changes to permissions, scopes or external hosts must be reflected in `privacy-policy.md`, which is what the Chrome Web Store review reads.

### API

`src/index.ts` (Hono app) mounts one route module per concern — `src/background.ts` (`GET /api/background`) and `src/quote.ts` (`GET /api/quote`) — with tag normalisation shared out of `src/tags.ts`. Configured via `wrangler.toml`. `apps/api/README.md` documents both endpoints in full and is kept accurate independently of this file; this section is a pointer, not a duplicate.

`GET /api/background?tags=...` fetches 30 photos from Unsplash, caches the pool in Cloudflare KV for 3 days (TTL), and returns one random photo's metadata. Two constraints it exists under, since it is public and unauthenticated:
- Tags are normalised (lowercased, stripped, deduped, sorted, capped at 5) so the KV key space cannot be inflated by callers.
- Unsplash calls are capped per hour by a KV counter. Past the cap the worker serves the default pool instead of calling Unsplash, so a burst degrades the variety rather than exhausting the account quota.

Unsplash's API guidelines are load-bearing here: the worker pings each photo's `download_location` when it hands the photo out, and attribution links carry `utm_source=hub&utm_medium=referral`.

`GET /api/quote` proxies `stoic.tekloon.net` behind a KV cache keyed by the current UTC date, so upstream is hit roughly once per day in total rather than once per request, and falls back to the last successfully cached quote (`quote:latest`) when upstream is down or errors. The extension talks only to this endpoint for quotes — see the External APIs note in the Extension section above.

### Release Flow

1. Push to `main` → `release.yml` runs `pnpm nx release` → creates git tags using conventional commits
2. Tag matching `extension@*` triggers `deploy.yml` → builds and uploads to Chrome Web Store
3. Tag matching `api@*` triggers `deploy-api.yml` → deploys via Wrangler to Cloudflare

## Nx Guidelines

- Use `nx-workspace` skill to explore projects and targets
- Use `nx-generate` skill before any scaffolding task
- Never guess CLI flags — check `--help` or `nx_docs` first
- See `AGENTS.md` for full Nx guidelines
