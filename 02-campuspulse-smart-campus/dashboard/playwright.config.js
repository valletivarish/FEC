import { defineConfig, devices } from '@playwright/test';

// Snapshots stay small and stable on a fixed viewport, hence explicit desktop/mobile sizes.
export default defineConfig({
  testDir: 'tests/playwright',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8086',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run serve',
    port: 8086,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
});
