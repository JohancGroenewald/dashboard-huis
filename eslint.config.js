import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'public/vendor/**', 'data/**'] },
  js.configs.recommended,
  {
    // Node-side code (server, validation, agent) + tooling.
    files: ['src/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.mjs', '*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // Browser-side code (the dashboard UI).
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, GridStack: 'readonly' },
    },
  },
  {
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
