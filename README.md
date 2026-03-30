# Hub

A minimalist Chrome extension dashboard with a backend API, built as a monorepo.

**Extension** replaces the new tab page with a dashboard showing time, weather, Google Calendar events, daily Stoic quotes, a countdown, and quick notes — all over a beautiful Unsplash background.

**API** is a Cloudflare Worker that fetches and caches background images from Unsplash.

## Repository structure

```
hub/
├── apps/
│   ├── api/        # Cloudflare Worker (Hono.js)
│   └── extension/  # Chrome extension (React + Vite)
├── packages/
│   └── shared/     # Shared TypeScript types
├── nx.json
├── package.json
└── pnpm-workspace.yaml
```

## Prerequisites

- Node.js >= 20
- pnpm >= 10

## Setup

```bash
pnpm install
```

## Development

Run each app from its own directory — see individual READMEs:

- [apps/api/README.md](apps/api/README.md)
- [apps/extension/README.md](apps/extension/README.md)

## Releases

Both apps version independently using git tags. Pushing a tag triggers the corresponding GitHub Actions deployment.

| App       | Tag pattern   | Example           |
| --------- | ------------- | ----------------- |
| API       | `api@*`       | `api@1.0.6`       |
| Extension | `extension@*` | `extension@2.0.1` |

```bash
git tag api@1.0.6 && git push origin api@1.0.6
git tag extension@2.0.1 && git push origin extension@2.0.1
```

Nx manages versioning with conventional commits and generates GitHub changelogs automatically.

## Commit conventions

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). Husky enforces this via commitlint on every commit.

```
feat(extension): add countdown widget
fix(api): handle empty Unsplash response
chore(release): publish
```

