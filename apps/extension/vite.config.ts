import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import packageJson from './package.json' with { type: 'json' };
import baseManifest from './manifest.json' with { type: 'json' };

/**
 * The most recent releases, headings included, for the What's New modal.
 *
 * This used to extract one version's section — the version being built — which
 * assumed users arrive one release at a time. They do not: the Chrome Web Store
 * ships whatever is current, so a user on 2.2.0 updating to 2.3.1 would have
 * been shown 2.3.1's few fixes and never told about the twenty-six changes in
 * 2.3.0 in between. The page picks the range it needs at runtime instead, from
 * the version it recorded on the last visit, so it needs the history here.
 *
 * Capped rather than shipped whole, because the file only ever grows and every
 * byte of it lands in the bundle. Ten releases is far more than the gap Chrome's
 * own auto-updating leaves; anyone further behind than that sees the ten most
 * recent, which is a better failure than an unbounded asset.
 */
const RELEASES_TO_BUNDLE = 10;

const getRecentChangelog = (): string => {
  const raw = readFileSync('./CHANGELOG.md', 'utf-8');
  // Level one or two and starting with a digit — `## 2.3.0`, or `# 2.0.0` for
  // the major. Level three is a section within a release, not a release.
  const versionHeading = /^#{1,2}\s+\[?\d+\.\d+\.\d+/;

  const lines: string[] = [];
  let seen = 0;
  for (const line of raw.split('\n')) {
    if (versionHeading.test(line) && ++seen > RELEASES_TO_BUNDLE) break;
    lines.push(line);
  }
  return lines.join('\n').trim();
};

const availableLanguages = readdirSync(join(__dirname, 'src/i18n/locales'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isProd = mode === 'production';

  const manifest = {
    ...baseManifest,
    version: packageJson.version,
    oauth2: {
      client_id: isProd
        ? '617448524668-9afd8s3r7bm0ckg2h50pc38hoq4cbar1.apps.googleusercontent.com'
        : env.VITE_DEV_CLIENT_ID,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    },
  };

  return {
    plugins: [react(), tailwindcss(), crx({ manifest })],
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __CHANGELOG__: JSON.stringify(getRecentChangelog()),
      __AVAILABLE_LANGUAGES__: JSON.stringify(availableLanguages),
    },
    build: {
      // Vite emits `<link rel="modulepreload" crossorigin>` for every chunk.
      // On a `chrome-extension://` page that `crossorigin` puts the preload in a
      // different world from the import that follows, so Chrome discards every
      // one of them — "cross-world extension resource mismatch" — and then warns
      // again that the preloaded resource went unused. The requests are paid for
      // and thrown away, four console warnings deep, on every new tab.
      //
      // Preloading buys almost nothing here anyway: these are local files read
      // off disk, with no network round trip to hide.
      modulePreload: false,
    },
    esbuild: {
      // `drop: ['console']` used to sit here, and it took `console.error` and
      // `console.warn` with it: every defensive path in `imageCache`,
      // `prefetch`, `useBackground`, `useQuote`, `useWeather` and the service
      // worker went silent in exactly the build where a fault is hardest to
      // reproduce. A user reporting a blank background could not tell us why,
      // and neither could their console.
      //
      // `pure` expresses the distinction `drop` cannot. It marks these calls as
      // free of side effects, so the minifier removes every one whose result is
      // unused — which is all of them — while `console.error` and
      // `console.warn`, deliberately absent from the list, survive into the
      // shipped bundle. This does lean on minification: it is on for
      // `vite build` (`build.minify` defaults to esbuild) and off for
      // `vite serve`, where every level should be logging anyway.
      drop: ['debugger'],
      pure: [
        'console.log',
        'console.debug',
        'console.info',
        'console.trace',
        'console.dir',
        'console.table',
        'console.group',
        'console.groupCollapsed',
        'console.groupEnd',
        'console.time',
        'console.timeEnd',
        'console.timeLog',
        'console.count',
      ],
    },
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
        clientPort: 5173,
      },
      cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
      },
    },
  };
});

