// Flat config: sensors/fog/backend/integration-test are Node CommonJS; dashboard/src runs
// unbundled in the browser as ES modules while dashboard/tests + playwright config run in Node.
const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    ignores: [
      '**/node_modules/**',
      'infra/cdk.out/**',
      'dashboard/test-results/**',
      'dashboard/tests/**/*-snapshots/**'
    ]
  },
  {
    files: ['sensors/**/*.js', 'fog/**/*.js', 'backend/**/*.js', 'integration-test/**/*.js', 'load/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        performance: 'readonly'
      }
    }
  },
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js'],
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
        jest: 'readonly'
      }
    }
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
        console: 'readonly'
      }
    }
  },
  {
    files: ['dashboard/tests/**/*.js', 'dashboard/playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly'
      }
    }
  }
];
