# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Nx monorepo for a Chrome extension dashboard with a serverless backend API.

- **`apps/extension`** — Chrome extension (React 19 + Vite + CRXJS) replacing the new tab page
- **`apps/api`** — Cloudflare Worker (Hono.js) serving background images from Unsplash with KV caching
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
normalisation, event categorisation, forecast aggregation, and the settings
store. Rendering and Chrome integration are still verified by hand — load the
built extension from `apps/extension/dist/` in Chrome.

Extension tests run under happy-dom with stubs for `chrome` and the Cache API
(`src/test/`). Hooks backed by module-level stores (`useSettings`) must be
imported inside the test via `await import(...)`, because `src/test/setup.ts`
calls `vi.resetModules()` before each test to give every test the clean slate a
fresh page load would have.

## Commit Conventions

Conventional Commits are enforced by Husky + commitlint on every commit:

```
type(scope): subject

# Valid scopes: api | extension | shared | repo | release | ci
```

Examples: `feat(extension): add countdown widget`, `fix(api): handle empty response`

## Architecture

### Extension

The extension entry is `apps/extension/src/main.tsx` → `App.tsx`. The main `App` component mounts all widgets and manages a double-click toggle to show/hide the UI overlay.

**Widgets** (`src/components/`): `Clock`, `WeatherWidget`, `CalendarWidget`, `QuoteWidget`, `CountdownWidget`, `QuickNote`, `BackgroundInfo`, `WhatsNewModal` — each is self-contained and reads settings through `useSettings`.

**Hooks** (`src/hooks/`): Each widget has a corresponding data hook (`useBackground`, `useCalendar`, `useWeather`, `useQuote`, etc.) that handles fetching, caching, and Chrome Storage interaction. Pure derivation logic lives in `src/utils/` (`calendarEvents`, `precipitation`, `changelog`, `dailyStorage`, `imageCache`) so it can be tested without React.

**Settings** (`src/hooks/useSettings.ts`): One module-level store shared by every consumer via `useSyncExternalStore` — a single `chrome.storage.sync.get` and a single `onChanged` listener per page. Do not add per-component storage reads.

**Settings UI** (`src/popup/`): Separate popup page (`popup.html`). Writes to Chrome Storage Sync; widgets react to storage changes.

**Background image caching**: metadata (url, photographer, location) goes to `localStorage` via `dailyStorage`; the image itself goes to the Cache API via `imageCache`. Never put image bytes in `localStorage` — a 4K JPEG base64-encodes past the origin quota. The service worker (`src/background.ts`) drops obsolete image caches on install/update.

**i18n**: `react-i18next` with locale files in `src/i18n/locales/`. ESLint is configured with `eslint-plugin-i18next` to catch JSX literal strings.

**External APIs consumed by the extension:** every host below must also be listed in `manifest.json` under `host_permissions`.
- Hub API (this repo's `apps/api`) — background images
- Open-Meteo — weather; `geocoding-api.open-meteo.com` for city lookup in the popup
- BigDataCloud — reverse geocoding (no key needed)
- GeoJS (`get.geojs.io`) — IP-based location fallback
- Google Calendar API — via OAuth identity permission (`calendar.readonly`)
- `stoic.tekloon.net` — daily quotes

Changes to permissions, scopes or external hosts must be reflected in `privacy-policy.md`, which is what the Chrome Web Store review reads.

### API

`src/index.ts` (Hono app) with tag normalisation in `src/tags.ts`. `GET /api/background?tags=...` fetches 30 photos from Unsplash, caches the pool in Cloudflare KV for 3 days (TTL), and returns one random photo's metadata. Configured via `wrangler.toml`.

Two constraints the endpoint exists under, since it is public and unauthenticated:
- Tags are normalised (lowercased, stripped, deduped, sorted, capped at 5) so the KV key space cannot be inflated by callers.
- Unsplash calls are capped per hour by a KV counter. Past the cap the worker serves the default pool instead of calling Unsplash, so a burst degrades the variety rather than exhausting the account quota.

Unsplash's API guidelines are load-bearing here: the worker pings each photo's `download_location` when it hands the photo out, and attribution links carry `utm_source=hub&utm_medium=referral`.

### Release Flow

1. Push to `main` → `release.yml` runs `pnpm nx release` → creates git tags using conventional commits
2. Tag matching `extension@*` triggers `deploy.yml` → builds and uploads to Chrome Web Store
3. Tag matching `api@*` triggers `deploy-api.yml` → deploys via Wrangler to Cloudflare

## Nx Guidelines

- Use `nx-workspace` skill to explore projects and targets
- Use `nx-generate` skill before any scaffolding task
- Never guess CLI flags — check `--help` or `nx_docs` first
- See `AGENTS.md` for full Nx guidelines
