const js = require('@eslint/js');

// shared across every workspace via `eslint --config ../eslint.config.js`; flat config
// resolves file globs relative to CWD (the workspace being linted), not this file's own
// dir, so patterns below are workspace-relative rather than prefixed with a folder name.
const commonJsGlobals = {
  process: 'readonly',
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  fetch: 'readonly',
};

const jestGlobals = {
  describe: 'readonly',
  test: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  jest: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  globalThis: 'readonly',
  URLSearchParams: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

module.exports = [
  { ignores: ['**/node_modules/**', '**/cdk.out/**', '**/test-results/**', '**/playwright-report/**'] },
  js.configs.recommended,
  {
    // generator functions share one call signature (value, previousValue) even when a
    // given generator doesn't need previous state; leading underscore marks that on purpose.
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    // dashboard's browser ESM bundle (src/) is the one workspace-relative dir this
    // portfolio's dashboard uses for <script type="module">; everything else is CommonJS.
    files: ['src/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: browserGlobals,
    },
  },
  {
    files: ['**/*.js'],
    ignores: ['src/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: commonJsGlobals,
    },
  },
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js', 'tests/**/*.js'],
    languageOptions: {
      globals: jestGlobals,
    },
  },
];
