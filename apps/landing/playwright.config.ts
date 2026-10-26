import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, timeout: 30_000, reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3300', launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {} },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /responsive/ },
  ],
  webServer: { command: 'npx serve out -l 3300 --no-clipboard', url: 'http://127.0.0.1:3300', reuseExistingServer: false, timeout: 30_000 },
});
