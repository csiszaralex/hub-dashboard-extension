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
    /**
     * Well above the 5s default, because the cost is transforming a module
     * graph rather than anything waiting.
     *
     * The first test in a file that renders a widget pulls in i18n with every
     * locale, `date-fns/locale` and `lucide-react`, and Vitest transforms all
     * of it before that test can run — locally the first test in such a file
     * takes seconds and the ones after it milliseconds, since the transform
     * cache outlives the `vi.resetModules()` between them. CI machines are
     * several times slower, so the first test is where the default runs out.
     *
     * Set once here rather than per file: two files had already hit it, and a
     * timeout copied into a third would be a workaround pretending to be a
     * property of that test. The whole suite runs in about five seconds, so a
     * test that genuinely hangs is still unmistakable at this limit.
     */
    testTimeout: 20_000,
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
