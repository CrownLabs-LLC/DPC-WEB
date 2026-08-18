import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.CHECKOUT_E2E_BASE_URL || 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 12'] } },
  ],
  webServer: process.env.CHECKOUT_E2E_BASE_URL
    ? undefined
    : {
        command: 'node scripts/serve-e2e.mjs',
        url: 'http://127.0.0.1:4173/join',
        reuseExistingServer: !process.env.CI,
      },
});
