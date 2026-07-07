import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import globals from "globals";

export default [
  // Base JS rules
  js.configs.recommended,

  // TypeScript files
  {
    files: ["backend/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./backend/tsconfig.json" },
      globals: { ...globals.node },
    },
    plugins: { "@typescript-eslint": ts },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      "no-console": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": "off",
    },
  },

  // Frontend TypeScript files
  {
    files: ["frontend/src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./frontend/tsconfig.json",
        extraFileExtensions: [".svelte"],
      },
      globals: { ...globals.browser },
    },
    plugins: { "@typescript-eslint": ts },
    rules: {
      // Correctness
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      "no-console": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],

      // Turn off base rule in favour of TS-aware version
      "no-unused-vars": "off",
    },
  },

  // Svelte files
  {
    files: ["frontend/src/**/*.svelte"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tsParser,
        project: "./frontend/tsconfig.json",
        extraFileExtensions: [".svelte"],
      },
      globals: { ...globals.browser },
    },
    plugins: { svelte, "@typescript-eslint": ts },
    rules: {
      ...svelte.configs.recommended.rules,

      // Correctness
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      "no-console": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": "off",

      // Svelte-specific: turn off overly noisy a11y rules for this dev tool
      "svelte/no-at-html-tags": "warn",
    },
  },

  // Trusted highlighted/rendered HTML sinks used by shared UI viewers
  {
    files: [
      "frontend/src/lib/components/ConnectionTestDialog.svelte",
      "frontend/src/lib/components/ErrorDialog.svelte",
      "frontend/src/lib/components/InlineAppError.svelte",
      "frontend/src/lib/components/JsonDialog.svelte",
      "frontend/src/lib/components/MarkdownPreviewDialog.svelte",
      "frontend/src/lib/components/NewSessionPanel.svelte",
      "frontend/src/lib/components/CompactRoundContent.svelte",
      "frontend/src/lib/components/PrimarySessionLaunchModal.svelte",
      "frontend/src/lib/components/SessionTurnBlock.svelte",
    ],
    rules: {
      "svelte/no-at-html-tags": "off",
    },
  },

  // Dev seed scripts intentionally print operational progress
  {
    files: ["backend/src/dev/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },

  // Electron main process (type-aware parsing; console is its only log sink)
  {
    files: ["electron/src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./electron/tsconfig.json" },
      globals: { ...globals.node },
    },
    plugins: { "@typescript-eslint": ts },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": "off",
    },
  },

  // CLI TypeScript files (non-test — type-aware parsing)
  {
    files: ["cli/src/**/*.ts"],
    ignores: ["cli/src/**/*.test.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./cli/tsconfig.json" },
      globals: { ...globals.node },
    },
    plugins: { "@typescript-eslint": ts },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      "no-console": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": "off",
    },
  },

  // CLI test files (syntax-only — not in tsconfig project)
  {
    files: ["cli/src/**/*.test.ts"],
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.node },
    },
    plugins: { "@typescript-eslint": ts },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
      "no-console": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": "off",
    },
  },

  // Ignore build output and config files
  {
    ignores: [
      "backend/dist/**",
      "cli/dist/**",
      "frontend/dist/**",
      "dist/**",
      "node_modules/**",
      "frontend/vite.config.ts",
      "frontend/svelte.config.js",
    ],
  },
];
