import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import packageJson from './package.json' with { type: 'json' };
import baseManifest from './manifest.json' with { type: 'json' };

const getChangelogSection = (version: string): string => {
  const raw = readFileSync('./CHANGELOG.md', 'utf-8');
  const verRegex = new RegExp(`^#{1,3}\\s+\\[?${version.replace(/\./g, '\\.')}\\]?`);
  const anyVerRegex = /^#{1,3}\s+[[\d]/;
  let capturing = false;
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    if (!capturing) {
      if (verRegex.test(line)) capturing = true;
    } else {
      if (anyVerRegex.test(line) && !verRegex.test(line)) break;
      lines.push(line);
    }
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
      __CHANGELOG__: JSON.stringify(getChangelogSection(packageJson.version)),
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

