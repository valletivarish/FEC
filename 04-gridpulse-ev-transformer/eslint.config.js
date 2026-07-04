'use strict';

const js = require('@eslint/js');

// sensors/fog/backend/integration-test are CommonJS (require); dashboard is ESM (package.json "type": "module")
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
};

// all four Jest workspaces call test files "*.test.js", so one glob covers them without per-workspace repetition
const jestGlobals = {
  describe: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  jest: 'readonly',
};

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'infra/cdk.out/**',
      'infra/**/*.ts',
    ],
  },
  {
    files: ['sensors/**/*.js', 'fog/**/*.js', 'backend/**/*.js', 'integration-test/**/*.js', 'load/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 2022,
      globals: {
        ...nodeGlobals,
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
      },
    },
  },
  {
    files: ['**/*.test.js', '**/__tests__/**/*.js'],
    languageOptions: {
      globals: jestGlobals,
    },
  },
  {
    files: ['dashboard/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022,
      globals: {
        ...nodeGlobals,
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
      },
    },
  },
];
