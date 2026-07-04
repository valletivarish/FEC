'use strict';

// Flat config shared across workspaces — sensors/fog/backend/integration-test are CommonJS,
// dashboard is ESM (browser type="module"), so sourceType/globals are split per directory glob.
const js = require('@eslint/js');
const globals = require('globals');

const ignores = [
  '**/node_modules/**',
  '**/coverage/**',
  'infra/cdk.out/**',
  'infra/**/*.ts',
  'dashboard/test-results/**',
  'dashboard/playwright-report/**',
];

module.exports = [
  { ignores },
  js.configs.recommended,
  {
    files: ['sensors/**/*.js', 'fog/**/*.js', 'backend/**/*.js', 'integration-test/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.jest },
    },
  },
  {
    files: ['dashboard/src/**/*.js', 'dashboard/tests/**/*.js', 'dashboard/playwright.config.js'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
  },
];
