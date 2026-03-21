import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import packageJson from './package.json' with { type: 'json' };
import baseManifest from './manifest.json' with { type: 'json' };

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

