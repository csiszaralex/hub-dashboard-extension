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
    },
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

