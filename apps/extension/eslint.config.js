import js from '@eslint/js';
import i18nPlugin from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        // Finds `tsconfig.app.json` or `tsconfig.node.json` per file through
        // the references in `tsconfig.json`.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // Not the whole `recommendedTypeChecked` preset: its `no-unsafe-*` family
    // is a separate cleanup. These are the rules that catch a promise nobody
    // waits for or handles — in a codebase built on async `chrome.*` calls.
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      // `checksVoidReturn` stays fully on, JSX attributes included: a handler
      // starts async work as `onClick={() => void run()}`, with `run` handling
      // its own failure, rather than handing React a promise it will drop.
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
    },
  },
  {
    // An `async` mock or stub stands in for an async API without having to
    // await anything itself.
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  {
    files: ['**/*.tsx'],
    plugins: { i18next: i18nPlugin },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': {
            exclude: [
              'className',
              'class',
              'style',
              'href',
              'src',
              'action',
              'method',
              'type',
              'name',
              'id',
              'htmlFor',
              'key',
              'rel',
              'target',
              'tabIndex',
              'tabindex',
              'role',
              'viewBox',
              'd',
              'fill',
              'stroke',
              'strokeWidth',
              'strokeLinecap',
              'strokeLinejoin',
              'xmlns',
              'state',
            ],
          },
          callees: {
            // `showWidget` is App.tsx's `isWidgetVisible` wrapper — its argument is
            // a typed WidgetId, not user-facing text, so it isn't a translation gap.
            exclude: ['t', 'format', 'padStart', 'split', 'showWidget'],
          },
          words: {
            // Separators and brand names that must not be translated.
            exclude: ['^[•°%:/]$', '^"$', 'km\\/h', '^Unsplash$'],
          },
        },
      ],
    },
  },
]);

