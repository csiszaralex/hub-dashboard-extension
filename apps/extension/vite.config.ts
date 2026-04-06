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
    esbuild: {
      drop: ['console', 'debugger'],
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

