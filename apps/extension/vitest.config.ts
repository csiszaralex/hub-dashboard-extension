import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Deliberately does not load the CRXJS plugin — it rewrites the manifest and
// expects a browser extension host, neither of which exist under Vitest.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __CHANGELOG__: JSON.stringify(''),
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
