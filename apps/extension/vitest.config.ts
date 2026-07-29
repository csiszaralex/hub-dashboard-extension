import react from '@vitejs/plugin-react';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const availableLanguages = readdirSync(join(__dirname, 'src/i18n/locales'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

// Deliberately does not load the CRXJS plugin — it rewrites the manifest and
// expects a browser extension host, neither of which exist under Vitest.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __CHANGELOG__: JSON.stringify(''),
    __AVAILABLE_LANGUAGES__: JSON.stringify(availableLanguages),
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
