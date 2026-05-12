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
# Root
pnpm typecheck          # TypeScript check across all packages
pnpm check              # Full typecheck + lint across all packages

# Extension (from root or apps/extension)
pnpm nx run extension:dev       # Vite dev server at localhost:5173
pnpm nx run extension:build     # TypeScript check + production build → dist/
pnpm nx run extension:pack      # Build + zip → extension-release.zip
pnpm nx run extension:lint      # ESLint
pnpm nx run extension:typecheck # TypeScript check only
pnpm nx run extension:preview   # Vite preview server

# API (from root or apps/api)
pnpm nx run api:dev             # Wrangler dev at localhost:8787
pnpm nx run api:deploy          # Deploy to Cloudflare Workers
pnpm nx run api:typecheck       # TypeScript check
```

No automated test suite — testing is done manually by loading the built extension in Chrome.

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

**Widgets** (`src/components/`): `Clock`, `WeatherWidget`, `CalendarWidget`, `QuoteWidget`, `CountdownWidget`, `QuickNote`, `BackgroundInfo` — each is self-contained and reads settings from Chrome Storage Sync.

**Hooks** (`src/hooks/`): Each widget has a corresponding data hook (`useBackground`, `useCalendar`, `useWeather`, `useQuote`, etc.) that handles fetching, caching, and Chrome Storage interaction.

**Settings** (`src/popup/`): Separate popup page (`popup.html`) rendered as a settings UI. Writes to Chrome Storage Sync; widgets react to storage changes.

**i18n**: `react-i18next` with locale files in `src/i18n/locales/`. ESLint is configured with `eslint-plugin-i18next` to catch JSX literal strings.

**External APIs consumed by the extension:**
- Hub API (this repo's `apps/api`) — background images
- Open-Meteo — weather (no key needed)
- BigDataCloud — reverse geocoding (no key needed)
- Google Calendar API — via OAuth identity permission
- `stoic.tekloon.net` — daily quotes

### API

Single `src/index.ts` (Hono app). `GET /api/background?tags=...` fetches 30 photos from Unsplash, caches the pool in Cloudflare KV for 3 days (TTL), and returns one random photo's metadata. Configured via `wrangler.toml`.

### Release Flow

1. Push to `main` → `release.yml` runs `pnpm nx release` → creates git tags using conventional commits
2. Tag matching `extension@*` triggers `deploy.yml` → builds and uploads to Chrome Web Store
3. Tag matching `api@*` triggers `deploy-api.yml` → deploys via Wrangler to Cloudflare

## Nx Guidelines

- Use `nx-workspace` skill to explore projects and targets
- Use `nx-generate` skill before any scaffolding task
- Never guess CLI flags — check `--help` or `nx_docs` first
- See `AGENTS.md` for full Nx guidelines
