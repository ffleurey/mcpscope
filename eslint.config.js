import js from '@eslint/js'
import ts from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import svelte from 'eslint-plugin-svelte'
import svelteParser from 'svelte-eslint-parser'
import globals from 'globals'

export default [
  // Base JS rules
  js.configs.recommended,

  // TypeScript files
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: './tsconfig.app.json', extraFileExtensions: ['.svelte'] },
      globals: { ...globals.browser },
    },
    plugins: { '@typescript-eslint': ts },
    rules: {
      // Correctness
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Turn off base rule in favour of TS-aware version
      'no-unused-vars': 'off',
    },
  },

  // Svelte files
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tsParser,
        project: './tsconfig.app.json',
        extraFileExtensions: ['.svelte'],
      },
      globals: { ...globals.browser },
    },
    plugins: { svelte, '@typescript-eslint': ts },
    rules: {
      ...svelte.configs.recommended.rules,

      // Correctness
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': 'off',

      // Svelte-specific: turn off overly noisy a11y rules for this dev tool
      'svelte/no-at-html-tags': 'warn',
    },
  },

  // Ignore build output and config files
  {
    ignores: ['dist/**', 'node_modules/**', 'vite.config.ts', 'svelte.config.js'],
  },
]
