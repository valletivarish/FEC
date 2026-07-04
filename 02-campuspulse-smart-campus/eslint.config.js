'use strict';

const js = require('@eslint/js');

// Two module systems in this repo: dashboard is "type": "module" (browser ES modules),
// everything else is CommonJS Node — sourceType/globals differ per glob accordingly.
module.exports = [
  js.configs.recommended,
  {
    ignores: [
      '**/node_modules/**',
      '**/cdk.out/**',
      'infra/**',
      'dashboard/test-results/**',
      'dashboard/tests/playwright/**/*-snapshots/**',
    ],
  },
  {
    files: [
      'sensors/**/*.js',
      'fog/**/*.js',
      'backend/**/*.js',
      'integration-test/**/*.js',
      'config/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        process: 'readonly',
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: ['sensors/test/**/*.js', 'fog/test/**/*.js', 'backend/test/**/*.js', 'integration-test/test/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
  },
  {
    files: ['dashboard/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
  {
    // Runs under Node (the Playwright CLI/webServer config), not the browser.
    files: ['dashboard/playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
      },
    },
  },
  {
    // Test files run in Node, but page.evaluate() callbacks execute in-browser, hence both global sets.
    files: ['dashboard/tests/playwright/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        getComputedStyle: 'readonly',
      },
    },
  },
];
