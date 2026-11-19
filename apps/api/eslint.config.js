import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['.wrangler', 'dist']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      // Workers run a service-worker-like global scope, not Node.
      globals: { ...globals.serviceworker, ...globals.browser },
      parserOptions: {
        // `vitest.config.ts` sits outside `tsconfig.json`'s `src/**/*`.
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // Not the whole `recommendedTypeChecked` preset: its `no-unsafe-*` family
    // is a separate cleanup. These are the rules that catch a promise nobody
    // waits for or handles.
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
    },
  },
  {
    // An `async` mock stands in for an async API without having to await
    // anything itself.
    files: ['**/*.test.ts', 'src/test/**'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
]);
